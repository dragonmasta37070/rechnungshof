import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { Router } from "@angular/router";

import type { Group, Transaction } from "../../api/api";
import { formatDateLong, plural } from "../../domain/format";
import { Store } from "../../domain/store";
import { effectOf, shareOf } from "../../domain/share";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icon";

interface FeedRow {
    group: Group;
    transaction: Transaction;
    payer: string;
    /**
     * What this expense does to the signed-in user's balance — positive if they
     * get money back from it. Null when they have no part in it.
     */
    effect: number | null;
    /** Their own share of it. Not shown on the row; the header total sums it. */
    ownShare: number | null;
}

interface DateSection {
    label: string;
    rows: FeedRow[];
}

/**
 * Everything the user is involved in, across all groups, newest first.
 *
 * The post-login landing route. Group membership is per-group, so each row has
 * to name its group — without that, two identically-named expenses in
 * different groups are indistinguishable.
 */
@Component({
    selector: "app-expenses",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Icon, Amount],
    templateUrl: "./expenses.html",
    styleUrls: ["../../ui/ui.css", "./expenses.css"],
})
export class Expenses {
    private readonly router = inject(Router);
    protected readonly store = inject(Store);

    protected readonly sections = computed<DateSection[]>(() => {
        const byDate = new Map<string, FeedRow[]>();

        for (const { group, transaction } of this.store.allTransactions()) {
            const accounts = this.store.accountsOf(group.id);
            const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
            const creditorId = Number(Object.keys(transaction.creditor_shares)[0]);
            const own = group.owned_account_id ?? null;

            const rows = byDate.get(transaction.billed_at) ?? [];
            rows.push({
                group,
                transaction,
                payer: nameOf.get(creditorId) ?? "Unbekannt",
                effect: own == null ? null : effectOf(transaction, own),
                ownShare: own == null ? null : shareOf(transaction, own),
            });
            byDate.set(transaction.billed_at, rows);
        }

        return [...byDate.entries()].map(([date, rows]) => ({
            label: formatDateLong(date),
            rows,
        }));
    });

    protected readonly stats = computed(() => {
        let ownShare = 0;
        let paidByUser = 0;

        for (const section of this.sections()) {
            for (const row of section.rows) {
                ownShare += row.ownShare ?? 0;
                const own = row.group.owned_account_id;
                if (own != null && row.transaction.creditor_shares[own] != null) {
                    // `value` is in the expense's own currency; the tile shows group
                    // currency, which is what `ownShare` above already reports.
                    paidByUser += row.transaction.value * row.transaction.currency_conversion_rate;
                }
            }
        }

        return {
            ownShare,
            paidByUser,
            count: this.store.allTransactions().length,
            subtitle:
                `${plural(this.store.groups().length, "Gruppe", "Gruppen")} · ` +
                `${plural(this.store.allTransactions().length, "Ausgabe", "Ausgaben")}`,
        };
    });

    openExpense(row: FeedRow): void {
        // Opening an expense from the global feed also switches the active group,
        // so the FAB and the sidebar follow the user where they just went.
        this.store.activeGroupId.set(row.group.id);
        void this.router.navigate(["/groups", row.group.id, "expenses", row.transaction.id]);
    }

    newGroup(): void {
        void this.router.navigate(["/groups"]);
    }

    newExpense(): void {
        // An expense belongs to exactly one group, and this screen spans all of
        // them. Falling back to "the first group" silently books money against
        // whichever one happened to load first; with more than one, ask.
        const groups = this.store.groups();
        const groupId = this.store.activeGroupId() ?? (groups.length === 1 ? groups[0].id : null);
        void this.router.navigate(groupId == null ? ["/groups"] : ["/groups", groupId, "expenses", "new"]);
    }
}
