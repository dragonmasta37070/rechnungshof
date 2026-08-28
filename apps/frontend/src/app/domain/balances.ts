import { computeAccountBalances, computeGroupSettlement } from '@abrechnung/core';

import type { ClearingAccount, Group, PersonalAccount, Transaction } from '../api/api';
import { toDomainAccounts, toDomainTransactions } from './adapt';

export interface AccountBalance {
  accountId: number;
  /** Positive: the group owes them. Negative: they owe the group. */
  balance: number;
  totalPaid: number;
}

export interface SettlementEdge {
  /** Who pays. */
  debitorId: number;
  /** Who receives. */
  creditorId: number;
  amount: number;
}

/** One counterparty's net position with the signed-in user, across all groups. */
export interface PersonNetting {
  accountName: string;
  /** Positive: the user owes them. Negative: they owe the user. */
  net: number;
  /** Names of the groups that contributed to this figure. */
  groups: string[];
}

/** Amounts below this are rounding noise, not debt. */
const EPSILON = 0.005;

export function balancesFor(
  accounts: (PersonalAccount | ClearingAccount)[],
  transactions: Transaction[],
): AccountBalance[] {
  const raw = computeAccountBalances(
    toDomainAccounts(accounts),
    toDomainTransactions(transactions),
  );

  return Object.entries(raw).map(([accountId, balance]) => ({
    accountId: Number(accountId),
    balance: balance.balance,
    totalPaid: balance.totalPaidPurchases + balance.totalPaidTransfers,
  }));
}

export function settlementFor(
  accounts: (PersonalAccount | ClearingAccount)[],
  transactions: Transaction[],
): SettlementEdge[] {
  const raw = computeAccountBalances(
    toDomainAccounts(accounts),
    toDomainTransactions(transactions),
  );

  return computeGroupSettlement(raw).map((item) => ({
    // computeGroupSettlement names the payer `creditorId` and the payee
    // `debitorId` — the reverse of how the settlement reads in the UI
    // ("A pays B"). Renamed here so callers cannot get the direction wrong.
    debitorId: item.creditorId,
    creditorId: item.debitorId,
    amount: item.paymentAmount,
  }));
}

export interface GroupLedger {
  group: Group;
  accounts: (PersonalAccount | ClearingAccount)[];
  transactions: Transaction[];
  /** The account in this group that belongs to the signed-in user. */
  ownAccountId: number | null;
}

/**
 * Nets what the user owes and is owed per person, across group boundaries.
 *
 * Runs each group's settlement plan, keeps only the edges the user is part of,
 * and sums per counterparty. Two groups that point in opposite directions
 * cancel out — that is the whole point, and the reason this cannot be done by
 * summing per-group balances instead.
 *
 * Positive means the user owes that person; negative means they owe the user.
 */
export function netByPerson(ledgers: GroupLedger[]): PersonNetting[] {
  const byName = new Map<string, { net: number; groups: Set<string> }>();

  for (const ledger of ledgers) {
    if (ledger.ownAccountId == null) {
      continue;
    }
    const nameOf = new Map(ledger.accounts.map((a) => [a.id, a.name]));

    for (const edge of settlementFor(ledger.accounts, ledger.transactions)) {
      const userPays = edge.debitorId === ledger.ownAccountId;
      const userReceives = edge.creditorId === ledger.ownAccountId;
      if (!userPays && !userReceives) {
        continue;
      }

      const counterpartId = userPays ? edge.creditorId : edge.debitorId;
      const counterpart = nameOf.get(counterpartId);
      if (counterpart == null) {
        continue;
      }

      const entry = byName.get(counterpart) ?? { net: 0, groups: new Set<string>() };
      entry.net += userPays ? edge.amount : -edge.amount;
      entry.groups.add(ledger.group.name);
      byName.set(counterpart, entry);
    }
  }

  return (
    [...byName.entries()]
      .map(([accountName, { net, groups }]) => ({
        accountName,
        net,
        groups: [...groups],
      }))
      // Anything under half a cent is rounding, not a debt worth showing.
      .filter((entry) => Math.abs(entry.net) >= EPSILON)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  );
}
