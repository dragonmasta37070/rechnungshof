import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { balancesFor, netByPerson } from '../../domain/balances';
import { Store } from '../../domain/store';
import { Amount } from '../../ui/amount';
import { Icon } from '../../ui/icon';

/**
 * What the user owes and is owed overall — never a single group.
 *
 * "By person" is the interesting half: it nets across group boundaries, so
 * owing someone in one group and being owed by them in another collapses to the
 * difference. Summing per-group balances cannot express that.
 */
@Component({
  selector: 'app-balances',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Amount],
  templateUrl: './balances.html',
  styleUrls: ['../../ui/ui.css', './balances.css'],
})
export class Balances {
  private readonly router = inject(Router);
  protected readonly store = inject(Store);

  protected readonly byGroup = computed(() =>
    this.store
      .groups()
      .map((group) => {
        const own = group.owned_account_id;
        const balance =
          own == null
            ? 0
            : (balancesFor(
                this.store.accountsOf(group.id),
                this.store.transactionsOf(group.id),
              ).find((b) => b.accountId === own)?.balance ?? 0);

        return {
          group,
          balance,
          tone: Math.abs(balance) < 0.005 ? 'muted' : balance > 0 ? 'success' : 'error',
          note:
            Math.abs(balance) < 0.005
              ? 'ausgeglichen'
              : balance > 0
                ? 'bekommst du zurück'
                : 'schuldest du der Gruppe',
        };
      })
      .filter((row) => Math.abs(row.balance) >= 0.005),
  );

  protected readonly byPerson = computed(() =>
    netByPerson(this.store.ledgers()).map((entry) => ({
      ...entry,
      // netByPerson is positive when the user owes; the UI colours "owed to
      // you" green, so the sign is flipped for display only.
      display: -entry.net,
      tone: entry.net > 0 ? 'error' : 'success',
      note:
        entry.net > 0
          ? `du schuldest · ${entry.groups.join(', ')}`
          : `du bekommst zurück · ${entry.groups.join(', ')}`,
    })),
  );

  protected readonly hero = computed(() => {
    let owed = 0;
    let owing = 0;
    for (const entry of this.byPerson()) {
      if (entry.net > 0) {
        owing += entry.net;
      } else {
        owed += -entry.net;
      }
    }
    return { net: owed - owing, owed, owing };
  });

  protected readonly heroLabel = computed(() => {
    const net = this.hero().net;
    if (Math.abs(net) < 0.005) {
      return 'Netto gesamt';
    }
    return net > 0 ? 'Netto bekommst du zurück' : 'Netto schuldest du';
  });

  openGroup(groupId: number): void {
    void this.router.navigate(['/groups', groupId]);
  }
}
