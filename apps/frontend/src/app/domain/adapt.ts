import type { Account as DomainAccount, Transaction as DomainTransaction } from "@abrechnung/types";

import type { ClearingAccount, PersonalAccount, Transaction } from "../api/api";

/**
 * Adapters between the API's wire shape and the shape `@abrechnung/core` expects.
 *
 * `libs/core` carries the balance, settlement and split maths this app must not
 * reinvent — it is plain TypeScript with no React in it, it has tests, and it
 * has been running in production in the React app. Its types turn out to be the
 * backend types plus a couple of frontend-only fields, so the gap is narrow:
 * `positions` is a map keyed by id with a separate `position_ids` order, and
 * every entity carries an `is_wip` editing flag we never set.
 */

export function toDomainAccount(account: PersonalAccount | ClearingAccount): DomainAccount {
    // is_wip marks a locally edited, unsaved entity in the React app's editor.
    // Nothing here is ever mid-edit, so it is always false.
    return { ...account, is_wip: false } as DomainAccount;
}

export function toDomainTransaction(transaction: Transaction): DomainTransaction {
    const positions: Record<number, unknown> = {};
    const positionIds: number[] = [];

    for (const position of transaction.positions ?? []) {
        positions[position.id] = { ...position, is_changed: false, only_local: false };
        positionIds.push(position.id);
    }

    return {
        ...transaction,
        is_wip: false,
        positions,
        position_ids: positionIds,
        files: {},
        file_ids: [],
    } as unknown as DomainTransaction;
}

export function toDomainAccounts(accounts: (PersonalAccount | ClearingAccount)[]): DomainAccount[] {
    return accounts.map(toDomainAccount);
}

export function toDomainTransactions(transactions: Transaction[]): DomainTransaction[] {
    return transactions.map(toDomainTransaction);
}
