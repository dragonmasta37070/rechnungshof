import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";

import { Api, type Transaction } from "../../api/api";
import { balancesFor, settlementFor } from "../../domain/balances";
import { formatDateLong, plural, toIsoDate } from "../../domain/format";
import { effectOf } from "../../domain/share";
import { Store } from "../../domain/store";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icon";
import { OwnAccountPicker } from "../../ui/own-account-picker";

interface ExpenseRow {
    transaction: Transaction;
    payer: string;
    /** The payer is the signed-in user — the row says "dir" instead of a name. */
    payerIsOwn: boolean;
    peopleLabel: string;
    /**
     * What this expense does to the signed-in user's balance — positive if they
     * get money back from it. Null when they have no part in it.
     */
    effect: number | null;
}

interface DateSection {
    label: string;
    rows: ExpenseRow[];
}

@Component({
    selector: "app-group",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Icon, Amount, OwnAccountPicker],
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

    protected readonly subtitle = computed(
        () =>
            `${plural(this.members().length, "Mitglied", "Mitglieder")} · ` +
            `${plural(this.sections().length, "Tag mit Ausgaben", "Tage mit Ausgaben")}`
    );

    protected readonly planIntro = computed(
        () =>
            `${plural(this.plan().length, "Zahlung gleicht", "Zahlungen gleichen")} diese Gruppe aus — der kürzeste Weg.`
    );

    protected readonly groupId = computed(() => Number(this.id()));
    protected readonly group = computed(() => this.store.groups().find((g) => g.id === this.groupId()) ?? null);

    /** Whether the user is tied to an account here; without it no balance exists. */
    protected readonly linked = computed(() => this.group()?.owned_account_id != null);

    constructor() {
        effect(() => this.store.activeGroupId.set(this.groupId()));
        // Only the membership list knows which people have a login. Not while
        // unlinked: the account picker shown instead of the panel loads it too.
        effect(() => {
            if (this.linked()) {
                this.store.loadMembers(this.groupId());
            }
        });
    }

    private readonly accounts = computed(() => this.store.accountsOf(this.groupId()));
    private readonly transactions = computed(() => this.store.transactionsOf(this.groupId()).filter((t) => !t.deleted));

    protected readonly members = computed(() => {
        const nameOf = new Map(this.accounts().map((a) => [a.id, a.name]));
        const balances = balancesFor(this.accounts(), this.transactions());
        const own = this.group()?.owned_account_id ?? null;
        const max = Math.max(...balances.map((b) => Math.abs(b.balance)), 1);

        return (
            balances
                .filter((b) => nameOf.has(b.accountId))
                .map((b) => ({
                    id: b.accountId,
                    name: nameOf.get(b.accountId)!,
                    isOwn: b.accountId === own,
                    noLogin: this.store.lacksLogin(this.groupId(), b.accountId),
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
                // Your own row first — it is the one the user came for.
                .toSorted((a, b) => Number(b.isOwn) - Number(a.isOwn) || a.name.localeCompare(b.name))
        );
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

        return (
            settlementFor(this.accounts(), this.transactions())
                .map((edge) => ({
                    edge,
                    // "Du zahlst Carol" / "test1 zahlt dir": the user reads their
                    // own line as a sentence about them, not as two strangers.
                    debitor: edge.debitorId === own ? "Du" : (nameOf.get(edge.debitorId) ?? "?"),
                    debitorIsOwn: edge.debitorId === own,
                    debitorNoLogin: this.store.lacksLogin(this.groupId(), edge.debitorId),
                    verb: edge.debitorId === own ? "zahlst" : "zahlt",
                    creditor: edge.creditorId === own ? "dir" : (nameOf.get(edge.creditorId) ?? "?"),
                    creditorIsOwn: edge.creditorId === own,
                    creditorNoLogin: this.store.lacksLogin(this.groupId(), edge.creditorId),
                    involvesOwn: edge.debitorId === own || edge.creditorId === own,
                    sub:
                        edge.debitorId === own
                            ? "Deine Zahlung"
                            : edge.creditorId === own
                              ? "Du erhältst diesen Betrag"
                              : "Zahlung zwischen anderen",
                }))
                // Rows you are part of first; `settle()` addresses this list by
                // position, so the template passes `$index` rather than a field.
                .toSorted((a, b) => Number(b.involvesOwn) - Number(a.involvesOwn))
        );
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
                payerIsOwn: creditorId === own,
                peopleLabel: plural(Object.keys(transaction.debitor_shares).length, "Person", "Personen"),
                effect: own == null ? null : effectOf(transaction, own),
            });
            byDate.set(transaction.billed_at, rows);
        }

        return [...byDate.entries()].map(([date, rows]) => ({ label: formatDateLong(date), rows }));
    });

    back(): void {
        void this.router.navigate(["/groups"]);
    }

    /** Members, invites and placeholder people all live on the settings page. */
    openSettings(): void {
        void this.router.navigate(["/groups", this.groupId(), "settings"]);
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
        this.store.notice.set(null);
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
                error: () => {
                    this.settling.set(null);
                    this.store.notice.set("Ausgleich konnte nicht gespeichert werden.");
                },
            });
    }
}
