import type { Transaction } from '../api/api';
import { toDomainTransaction } from './adapt';
import { computeTransactionBalanceEffect } from '@abrechnung/core';

/**
 * What one account's slice of a single expense costs them.
 *
 * Delegates to `computeTransactionBalanceEffect` rather than dividing the value
 * by the share count, because a share is not always a fraction: `absolute`
 * shares are amounts, `percent` shares are percentages, and positions bill
 * named items to specific people before the remainder is split. Doing this by
 * hand would quietly disagree with the balances on the very same screen.
 *
 * Returns null when the account has no part in the expense.
 */
export function shareOf(transaction: Transaction, accountId: number): number | null {
  const effect = computeTransactionBalanceEffect(toDomainTransaction(transaction));
  const entry = effect[accountId];
  if (!entry) {
    return null;
  }
  const share = entry.positions + entry.commonDebitors;
  return share === 0 ? null : share;
}
