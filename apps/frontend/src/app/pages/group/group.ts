import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";

import { Api, type Transaction } from "../../api/api";
import { balancesFor, settlementFor } from "../../domain/balances";
import { formatDateLong, toIsoDate } from "../../domain/format";
import { shareOf } from "../../domain/share";
import { Store } from "../../domain/store";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icon";

interface ExpenseRow {
    transaction: Transaction;
    payer: string;
    people: number;
    /** The signed-in user's own share, or null when they are not involved. */
    ownShare: number | null;
}

interface DateSection {
    label: string;
    rows: ExpenseRow[];
}

@Component({
    selector: "app-group",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Icon, Amount],
    templateUrl: "./group.html",
    styleUrls: ["../../ui/ui.css", "./group.css"],
})
export class GroupView {
    /** From the route, via `withComponentInputBinding`. */
    readonly id = input.required<string>();

    private readonly api = inject(Api);
    private readonly router = inject(Router);
    protected readonly store = inject(Store);

    protected readonly panelOpen = signal(false);
    protected readonly settling = signal<number | null>(null);

    protected readonly groupId = computed(() => Number(this.id()));
    protected readonly group = computed(() => this.store.groups().find((g) => g.id === this.groupId()) ?? null);

    constructor() {
        effect(() => this.store.activeGroupId.set(this.groupId()));
    }

    private readonly accounts = computed(() => this.store.accountsOf(this.groupId()));
    private readonly transactions = computed(() => this.store.transactionsOf(this.groupId()).filter((t) => !t.deleted));

    protected readonly members = computed(() => {
        const nameOf = new Map(this.accounts().map((a) => [a.id, a.name]));
        const balances = balancesFor(this.accounts(), this.transactions());
        const own = this.group()?.owned_account_id ?? null;
        const max = Math.max(...balances.map((b) => Math.abs(b.balance)), 1);

        return balances
            .filter((b) => nameOf.has(b.accountId))
            .map((b) => ({
                id: b.accountId,
                name: nameOf.get(b.accountId)!,
                isOwn: b.accountId === own,
                balance: b.balance,
                totalPaid: b.totalPaid,
                // Minimum 3% so a tiny balance is still a visible bar, not a hairline.
                width: Math.max(3, (Math.abs(b.balance) / max) * 100),
                tone: Math.abs(b.balance) < 0.005 ? "muted" : b.balance > 0 ? "success" : "error",
                detail:
                    Math.abs(b.balance) < 0.005
                        ? "ausgeglichen"
                        : b.balance > 0
                          ? "bekommt Geld zurück"
                          : "schuldet der Gruppe",
            }))
            .toSorted((a, b) => a.name.localeCompare(b.name));
    });

    protected readonly ownBalance = computed(() => {
        const own = this.group()?.owned_account_id;
        return own == null ? 0 : (this.members().find((m) => m.id === own)?.balance ?? 0);
    });

    protected readonly ownBalanceLabel = computed(() => {
        const balance = this.ownBalance();
        if (Math.abs(balance) < 0.005) {
            return "Dein Saldo";
        }
        return balance > 0 ? "Dein Saldo · du bekommst zurück" : "Dein Saldo · du schuldest";
    });

    protected readonly plan = computed(() => {
        const nameOf = new Map(this.accounts().map((a) => [a.id, a.name]));
        const own = this.group()?.owned_account_id ?? null;

        return settlementFor(this.accounts(), this.transactions()).map((edge, index) => ({
            index,
            edge,
            title: `${nameOf.get(edge.debitorId) ?? "?"} zahlt ${nameOf.get(edge.creditorId) ?? "?"} `,
            sub:
                edge.debitorId === own
                    ? "Deine Zahlung"
                    : edge.creditorId === own
                      ? "Du erhältst diesen Betrag"
                      : "Zahlung zwischen anderen",
        }));
    });

    protected readonly sections = computed<DateSection[]>(() => {
        const nameOf = new Map(this.accounts().map((a) => [a.id, a.name]));
        const own = this.group()?.owned_account_id ?? null;
        const byDate = new Map<string, ExpenseRow[]>();

        for (const transaction of this.transactions().toSorted((a, b) => b.billed_at.localeCompare(a.billed_at))) {
            const creditorId = Number(Object.keys(transaction.creditor_shares)[0]);
            const rows = byDate.get(transaction.billed_at) ?? [];
            rows.push({
                transaction,
                payer: nameOf.get(creditorId) ?? "Unbekannt",
                people: Object.keys(transaction.debitor_shares).length,
                ownShare: own == null ? null : shareOf(transaction, own),
            });
            byDate.set(transaction.billed_at, rows);
        }

        return [...byDate.entries()].map(([date, rows]) => ({ label: formatDateLong(date), rows }));
    });

    back(): void {
        void this.router.navigate(["/groups"]);
    }

    openExpense(transaction: Transaction): void {
        void this.router.navigate(["/groups", this.groupId(), "expenses", transaction.id]);
    }

    newExpense(): void {
        void this.router.navigate(["/groups", this.groupId(), "expenses", "new"]);
    }

    /**
     * Records a settlement as an expense with an absolute split and a single
     * share — the unified expense model from the handoff. Its balance effect is
     * identical to the old transfer type, so no backend change is involved.
     */
    settle(index: number): void {
        const item = this.plan()[index];
        const group = this.group();
        if (!item || !group || this.settling() !== null) {
            return;
        }

        this.settling.set(index);
        this.api
            .createTransaction(group.id, {
                type: "transfer",
                name: "Ausgleich",
                description: "",
                value: item.edge.amount,
                currency_identifier: group.currency_identifier,
                currency_conversion_rate: 1,
                billed_at: toIsoDate(new Date()),
                tags: [],
                creditor_shares: { [item.edge.debitorId]: 1 },
                debitor_shares: { [item.edge.creditorId]: item.edge.amount },
                split_mode: "absolute",
            })
            .subscribe({
                next: () => this.store.refreshGroup(group.id).subscribe(() => this.settling.set(null)),
                error: () => this.settling.set(null),
            });
    }
}
