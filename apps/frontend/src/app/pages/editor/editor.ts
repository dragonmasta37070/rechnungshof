import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { Api, type NewTransaction, type SplitMode } from '../../api/api';
import { currencySymbol, formatDateShort, toIsoDate } from '../../domain/format';
import { respread, splitEvenly, sumShares, validateSplit } from '../../domain/split';
import { Store } from '../../domain/store';
import { Amount } from '../../ui/amount';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, Amount],
  templateUrl: './editor.html',
  styleUrls: ['../../ui/ui.css', './editor.css'],
})
export class Editor {
  readonly groupId = input.required<string>();
  /** `new`, or the id of an existing expense. */
  readonly expenseId = input.required<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly store = inject(Store);

  protected readonly value = signal(0);
  protected readonly name = signal('');
  protected readonly billedAt = signal(toIsoDate(new Date()));
  protected readonly creditorId = signal<number | null>(null);
  protected readonly splitMode = signal<SplitMode>('shares');
  protected readonly shares = signal<Record<number, number>>({});
  protected readonly showErrors = signal(false);
  protected readonly saving = signal(false);
  protected readonly payerPickerOpen = signal(false);

  protected readonly gid = computed(() => Number(this.groupId()));
  protected readonly isNew = computed(() => this.expenseId() === 'new');
  protected readonly group = computed(
    () => this.store.groups().find((g) => g.id === this.gid()) ?? null,
  );
  protected readonly currency = computed(() => this.group()?.currency_identifier ?? 'EUR');
  protected readonly symbol = computed(() => currencySymbol(this.currency()));

  protected readonly people = computed(() =>
    this.store.accountsOf(this.gid()).filter((a) => a.type === 'personal'),
  );

  protected readonly creditorName = computed(() => {
    const id = this.creditorId();
    const own = this.group()?.owned_account_id;
    const account = this.people().find((p) => p.id === id);
    if (!account) {
      return 'Auswählen';
    }
    return account.id === own ? `${account.name} (du)` : account.name;
  });

  protected readonly dateLabel = computed(() => formatDateShort(this.billedAt()));

  protected readonly participants = computed(() =>
    Object.keys(this.shares())
      .map(Number)
      .sort((a, b) => a - b),
  );

  protected readonly validation = computed(() =>
    validateSplit(this.splitMode(), this.shares(), this.value()),
  );

  protected readonly nameError = computed(() =>
    this.showErrors() && !this.name().trim() ? 'Pflichtfeld' : null,
  );
  protected readonly valueError = computed(() =>
    this.showErrors() && this.value() <= 0 ? 'Betrag muss größer als 0 sein' : null,
  );

  protected readonly summaryLabel = computed(() => {
    switch (this.splitMode()) {
      case 'shares':
        return 'Anteile insgesamt';
      case 'percent':
        return 'Prozent insgesamt';
      case 'absolute':
        return 'Summe der Beträge';
    }
  });

  protected readonly summaryValue = computed(() => {
    const total = this.validation().total;
    return this.splitMode() === 'absolute'
      ? `${total.toFixed(2)} von ${this.value().toFixed(2)}`
      : total.toFixed(2);
  });

  constructor() {
    // Load the expense being edited once the store has its data. An effect
    // rather than a resolver, because the store may still be loading when the
    // route activates after a hard refresh.
    effect(() => {
      const group = this.group();
      if (!group || !this.isNew()) {
        const existing = this.store
          .transactionsOf(this.gid())
          .find((t) => t.id === Number(this.expenseId()));
        if (existing && this.name() === '') {
          this.value.set(existing.value);
          this.name.set(existing.name);
          this.billedAt.set(existing.billed_at);
          this.creditorId.set(Number(Object.keys(existing.creditor_shares)[0]));
          this.splitMode.set(existing.split_mode);
          this.shares.set(
            Object.fromEntries(
              Object.entries(existing.debitor_shares).map(([id, share]) => [Number(id), share]),
            ),
          );
        }
        return;
      }

      // New expense: default to the user paying, everyone participating.
      if (this.creditorId() === null) {
        this.creditorId.set(group.owned_account_id ?? this.people()[0]?.id ?? null);
        this.shares.set(Object.fromEntries(this.people().map((p) => [p.id, 1])));
      }
    });
  }

  isParticipant(accountId: number): boolean {
    return accountId in this.shares();
  }

  toggleParticipant(accountId: number): void {
    this.shares.update((current) => {
      const next = { ...current };
      if (accountId in next) {
        delete next[accountId];
      } else {
        next[accountId] = this.splitMode() === 'shares' ? 1 : 0;
      }
      return next;
    });
  }

  shareOf(accountId: number): number {
    return this.shares()[accountId] ?? 0;
  }

  setShare(accountId: number, raw: string | number): void {
    // Accept both separators: a German keyboard produces a comma, and the
    // handoff says the decimal separator is a dot but inputs accept both.
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (Number.isNaN(parsed)) {
      return;
    }
    this.shares.update((current) => ({ ...current, [accountId]: parsed }));
  }

  step(accountId: number, delta: number): void {
    // The handoff caps the stepper at 0-20 shares.
    const next = Math.min(20, Math.max(0, this.shareOf(accountId) + delta));
    this.setShare(accountId, next);
  }

  setMode(mode: SplitMode): void {
    if (mode === this.splitMode()) {
      return;
    }
    this.splitMode.set(mode);
    this.shares.set(respread(mode, this.participants(), this.value()));
  }

  splitEvenlyNow(): void {
    this.shares.set(
      this.splitMode() === 'shares'
        ? Object.fromEntries(this.participants().map((id) => [id, 1]))
        : respread(this.splitMode(), this.participants(), this.value()),
    );
  }

  setValue(raw: string): void {
    const parsed = Number(String(raw).replace(',', '.'));
    this.value.set(Number.isNaN(parsed) ? 0 : parsed);
    // Absolute shares are amounts, so a changed total invalidates them.
    if (this.splitMode() === 'absolute' && this.participants().length) {
      this.shares.set(splitEvenly(this.value(), this.participants()));
    }
  }

  pickPayer(accountId: number): void {
    this.creditorId.set(accountId);
    this.payerPickerOpen.set(false);
  }

  close(): void {
    void this.router.navigate(['/groups', this.gid()]);
  }

  save(): void {
    this.showErrors.set(true);
    const creditor = this.creditorId();

    if (
      !this.name().trim() ||
      this.value() <= 0 ||
      creditor === null ||
      !this.validation().valid ||
      this.saving()
    ) {
      return;
    }

    const payload: NewTransaction = {
      // One unified expense type in the UI. A settle-up is the same shape with
      // an absolute split and a single share, so nothing here special-cases it.
      type: 'purchase',
      name: this.name().trim(),
      description: '',
      value: this.value(),
      currency_identifier: this.currency(),
      currency_conversion_rate: 1,
      billed_at: this.billedAt(),
      tags: [],
      creditor_shares: { [creditor]: 1 },
      debitor_shares: this.shares(),
      split_mode: this.splitMode(),
    };

    this.saving.set(true);
    const request = this.isNew()
      ? this.api.createTransaction(this.gid(), payload)
      : this.api.updateTransaction(this.gid(), Number(this.expenseId()), payload);

    request.subscribe({
      next: () => this.store.refreshGroup(this.gid()).subscribe(() => this.close()),
      error: () => this.saving.set(false),
    });
  }

  remove(): void {
    if (this.isNew() || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.api.deleteTransaction(this.gid(), Number(this.expenseId())).subscribe({
      next: () => this.store.refreshGroup(this.gid()).subscribe(() => this.close()),
      error: () => this.saving.set(false),
    });
  }

  protected readonly sumShares = sumShares;
}
