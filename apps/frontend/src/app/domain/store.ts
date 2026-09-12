import { computed, inject, Injectable, signal } from "@angular/core";
import { forkJoin, of, switchMap, tap } from "rxjs";

import { Api, ClearingAccount, Group, PersonalAccount, Transaction, User } from "../api/api";
import type { GroupLedger } from "./balances";

type AccountLike = PersonalAccount | ClearingAccount;

interface GroupData {
    accounts: AccountLike[];
    transactions: Transaction[];
}

/**
 * Everything the screens read from, loaded once and shared.
 *
 * The global feed and the global balances screen both need every group's
 * transactions at the same time, so the store loads all groups eagerly rather
 * than per route. That is one request per group; for a self-hosted app with a
 * handful of groups this is cheaper than the machinery to avoid it.
 */
@Injectable({ providedIn: "root" })
export class Store {
    private readonly api = inject(Api);

    readonly profile = signal<User | null>(null);
    readonly groups = signal<Group[]>([]);
    readonly data = signal<Record<number, GroupData>>({});
    readonly loading = signal(false);

    /**
     * A one-line failure message for the user.
     *
     * Every write in this app used to fail silently — the spinner stopped and
     * nothing else happened, which is indistinguishable from success until the
     * expense is missing later. One shared signal, rendered once in the shell
     * and once in the editor, is cheaper than an error state per screen.
     */
    readonly notice = signal<string | null>(null);

    /** The group currently being viewed, for the desktop sidebar and the FAB. */
    readonly activeGroupId = signal<number | null>(null);

    readonly activeGroup = computed(() => this.groups().find((g) => g.id === this.activeGroupId()) ?? null);

    accountsOf(groupId: number): AccountLike[] {
        return this.data()[groupId]?.accounts ?? [];
    }

    transactionsOf(groupId: number): Transaction[] {
        return this.data()[groupId]?.transactions ?? [];
    }

    /**
     * The account representing the signed-in user in a group.
     *
     * `owned_account_id` on the group is the authoritative link. Falling back to
     * a name match would be guesswork, and wrong guesses here put money against
     * the wrong person.
     */
    ownAccountId(groupId: number): number | null {
        return this.groups().find((g) => g.id === groupId)?.owned_account_id ?? null;
    }

    readonly ledgers = computed<GroupLedger[]>(() =>
        this.groups().map((group) => ({
            group,
            accounts: this.accountsOf(group.id),
            transactions: this.transactionsOf(group.id),
            ownAccountId: group.owned_account_id ?? null,
        }))
    );

    /** Every expense across every group, newest first. */
    readonly allTransactions = computed(() =>
        this.groups()
            .flatMap((group) =>
                this.transactionsOf(group.id)
                    .filter((t) => !t.deleted)
                    .map((transaction) => ({ group, transaction }))
            )
            .sort((a, b) => b.transaction.billed_at.localeCompare(a.transaction.billed_at))
    );

    load() {
        this.loading.set(true);
        this.notice.set(null);

        return this.api.profile().pipe(
            tap((user) => this.profile.set(user)),
            switchMap(() => this.api.groups()),
            tap((groups) => this.groups.set(groups)),
            switchMap((groups) =>
                groups.length === 0
                    ? of([])
                    : forkJoin(
                          groups.map((group) =>
                              forkJoin({
                                  accounts: this.api.accounts(group.id),
                                  transactions: this.api.transactions(group.id),
                              }).pipe(tap((data) => this.mergeGroup(group.id, data)))
                          )
                      )
            ),
            tap({
                next: () => this.loading.set(false),
                error: () => {
                    this.loading.set(false);
                    this.notice.set("Daten konnten nicht geladen werden.");
                },
            })
        );
    }

    /** Re-reads one group after a write, without refetching everything. */
    refreshGroup(groupId: number) {
        return forkJoin({
            accounts: this.api.accounts(groupId),
            transactions: this.api.transactions(groupId),
        }).pipe(tap((data) => this.mergeGroup(groupId, data)));
    }

    private mergeGroup(groupId: number, data: GroupData): void {
        this.data.update((current) => ({ ...current, [groupId]: data }));
    }
}
