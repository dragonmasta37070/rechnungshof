import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    signal,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { of, switchMap } from "rxjs";

import { Api, apiMessage, type Transaction } from "../../api/api";
import { balancesFor, settlementFor } from "../../domain/balances";
import { formatDateLong, plural, toIsoDate } from "../../domain/format";
import { effectOf } from "../../domain/share";
import { Store } from "../../domain/store";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icon";

interface ExpenseRow {
    transaction: Transaction;
    payer: string;
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
    imports: [FormsModule, Icon, Amount],
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
    protected readonly addPersonOpen = signal(false);
    protected readonly newPersonName = signal("");
    protected readonly addingPerson = signal(false);
    protected readonly inviteOpen = signal(false);
    protected readonly inviteLink = signal<string | null>(null);
    protected readonly copied = signal(false);
    /** Not on every platform — iOS and Android have it, desktop browsers mostly do not. */
    protected readonly canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

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

    private readonly personField = viewChild<ElementRef<HTMLInputElement>>("personField");
    private readonly linkField = viewChild<ElementRef<HTMLElement>>("linkField");

    constructor() {
        effect(() => this.store.activeGroupId.set(this.groupId()));
        // Same reason as the group sheet: one field, so focus it.
        effect(() => this.personField()?.nativeElement.focus());
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
                peopleLabel: plural(Object.keys(transaction.debitor_shares).length, "Person", "Personen"),
                effect: own == null ? null : effectOf(transaction, own),
            });
            byDate.set(transaction.billed_at, rows);
        }

        return [...byDate.entries()].map(([date, rows]) => ({ label: formatDateLong(date), rows }));
    });

    /**
     * Adds a participant who has no account of their own.
     *
     * The common case for a shared-expenses app: you split with flatmates and
     * friends who will never log in. Without this a group only ever contains
     * its creator, and nothing can be split.
     */
    addPerson(): void {
        const name = this.newPersonName().trim();
        if (!name || this.addingPerson()) {
            return;
        }
        this.addingPerson.set(true);
        this.store.notice.set(null);
        this.api.createAccount(this.groupId(), name).subscribe({
            next: () =>
                this.store.refreshGroup(this.groupId()).subscribe(() => {
                    this.addingPerson.set(false);
                    this.addPersonOpen.set(false);
                    this.newPersonName.set("");
                }),
            error: () => {
                this.addingPerson.set(false);
                this.store.notice.set("Person konnte nicht hinzugefügt werden.");
            },
        });
    }

    /**
     * Opens the invite sheet with a shareable link.
     *
     * A group invite is what lets someone with their own login in; "Person
     * hinzufügen" only makes a placeholder account nobody can sign into. The
     * link is reusable and never expires, so an existing one is reused rather
     * than piling up a new row per share. Only invites this user created come
     * back with a token, hence the `token` check.
     */
    invite(): void {
        this.inviteOpen.set(true);
        this.copied.set(false);
        if (this.inviteLink()) {
            return;
        }
        this.store.notice.set(null);

        this.api
            .invites(this.groupId())
            .pipe(
                switchMap((invites) => {
                    const usable = invites.find(
                        (i) =>
                            i.token &&
                            !i.single_use &&
                            (i.valid_until === null || Date.parse(i.valid_until) > Date.now())
                    );
                    return usable ? of(usable) : this.api.createInvite(this.groupId());
                })
            )
            .subscribe({
                next: (invite) => this.inviteLink.set(`${location.origin}/invite/${invite.token}`),
                error: (error: unknown) => {
                    this.inviteOpen.set(false);
                    this.store.notice.set(apiMessage(error) ?? "Einladungslink konnte nicht erstellt werden.");
                },
            });
    }

    async copyLink(): Promise<void> {
        const link = this.inviteLink();
        if (!link) {
            return;
        }
        try {
            await navigator.clipboard.writeText(link);
            this.copied.set(true);
        } catch {
            // ponytail: no clipboard API outside a secure context, and the user can
            // deny it. Selecting the link is the fallback every browser has.
            const element = this.linkField()?.nativeElement;
            if (element) {
                getSelection()?.selectAllChildren(element);
            }
        }
    }

    shareLink(): void {
        const link = this.inviteLink();
        if (link) {
            // Rejects when the user dismisses the share sheet — not an error.
            void navigator.share({ title: this.group()?.name, url: link }).catch(() => undefined);
        }
    }

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
