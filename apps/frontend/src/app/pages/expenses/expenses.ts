import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { Router } from "@angular/router";

import type { Group, Transaction } from "../../api/api";
import { formatDateLong } from "../../domain/format";
import { Store } from "../../domain/store";
import { shareOf } from "../../domain/share";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icon";

interface FeedRow {
    group: Group;
    transaction: Transaction;
    payer: string;
    /** The signed-in user's own share, or null when they are not involved. */
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
                    paidByUser += row.transaction.value;
                }
            }
        }

        return {
            ownShare,
            paidByUser,
            count: this.store.allTransactions().length,
            groups: this.store.groups().length,
        };
    });

    openExpense(row: FeedRow): void {
        // Opening an expense from the global feed also switches the active group,
        // so the FAB and the sidebar follow the user where they just went.
        this.store.activeGroupId.set(row.group.id);
        void this.router.navigate(["/groups", row.group.id, "expenses", row.transaction.id]);
    }

    newExpense(): void {
        const groupId = this.store.activeGroupId() ?? this.store.groups()[0]?.id;
        if (groupId != null) {
            void this.router.navigate(["/groups", groupId, "expenses", "new"]);
        }
    }
}
