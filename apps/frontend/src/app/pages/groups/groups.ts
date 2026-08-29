import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Api } from '../../api/api';
import { balancesFor } from '../../domain/balances';
import { Store } from '../../domain/store';
import { Amount } from '../../ui/amount';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-groups',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, Amount],
  templateUrl: './groups.html',
  styleUrls: ['../../ui/ui.css', './groups.css'],
})
export class Groups {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly store = inject(Store);

  protected readonly sheetOpen = signal(false);
  protected readonly newName = signal('');
  protected readonly saving = signal(false);

  protected readonly rows = computed(() =>
    this.store.groups().map((group) => {
      const own = group.owned_account_id;
      const balance =
        own == null
          ? 0
          : (balancesFor(this.store.accountsOf(group.id), this.store.transactionsOf(group.id)).find(
              (b) => b.accountId === own,
            )?.balance ?? 0);

      return {
        group,
        balance,
        members: this.store.accountsOf(group.id).filter((a) => a.type === 'personal').length,
        expenses: this.store.transactionsOf(group.id).filter((t) => !t.deleted).length,
        tone: Math.abs(balance) < 0.005 ? 'muted' : balance > 0 ? 'success' : 'error',
        note:
          Math.abs(balance) < 0.005
            ? 'ausgeglichen'
            : balance > 0
              ? 'bekommst du zurück'
              : 'schuldest du',
      };
    }),
  );

  open(): void {
    this.newName.set('');
    this.sheetOpen.set(true);
  }

  create(): void {
    const name = this.newName().trim();
    if (!name || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.api.createGroup({ name, currency_identifier: 'EUR' }).subscribe({
      next: (group) => {
        this.saving.set(false);
        this.sheetOpen.set(false);
        // Reload so the new group arrives with its auto-created account, then
        // go straight into it — creating a group is always followed by wanting
        // to be in it.
        this.store.load().subscribe(() => this.router.navigate(['/groups', group.id]));
      },
      error: () => this.saving.set(false),
    });
  }
}
