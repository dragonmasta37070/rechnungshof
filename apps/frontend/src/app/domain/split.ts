import type { SplitMode } from '../api/api';

/** Sum of a share map. */
export function sumShares(shares: Record<number, number>): number {
  return Object.values(shares).reduce((a, b) => a + b, 0);
}

/**
 * Distributes `value` evenly, in whole cents, with the remainder on the last
 * participant.
 *
 * A naive `value / n` leaves a fraction of a cent per person, and three people
 * splitting 10.00 would each owe 3.3333…, summing to 9.9999. The absolute split
 * mode requires the shares to total the value exactly, so the rounding error has
 * to land somewhere; the handoff says the last row absorbs it.
 */
export function splitEvenly(value: number, accountIds: number[]): Record<number, number> {
  const result: Record<number, number> = {};
  if (accountIds.length === 0) {
    return result;
  }

  const cents = Math.round(value * 100);
  const base = Math.floor(cents / accountIds.length);
  let assigned = 0;

  accountIds.forEach((id, index) => {
    const isLast = index === accountIds.length - 1;
    const share = isLast ? cents - assigned : base;
    assigned += share;
    result[id] = share / 100;
  });

  return result;
}

export interface SplitValidation {
  valid: boolean;
  /** Message to show under the split control, or null when valid. */
  error: string | null;
  /** Current total, for the summary line. */
  total: number;
}

/** Tolerance from the handoff: percent and absolute must match within a cent. */
const TOLERANCE = 0.01;

export function validateSplit(
  mode: SplitMode,
  shares: Record<number, number>,
  value: number,
): SplitValidation {
  const total = sumShares(shares);
  const participants = Object.keys(shares).length;

  if (participants === 0) {
    return { valid: false, error: 'Mindestens eine Person auswählen.', total };
  }

  switch (mode) {
    case 'shares':
      return total > 0
        ? { valid: true, error: null, total }
        : { valid: false, error: 'Anteile müssen größer als 0 sein.', total };

    case 'percent':
      return Math.abs(total - 100) <= TOLERANCE
        ? { valid: true, error: null, total }
        : { valid: false, error: 'Die Prozente müssen zusammen 100 ergeben.', total };

    case 'absolute':
      return Math.abs(total - value) <= TOLERANCE
        ? { valid: true, error: null, total }
        : {
            valid: false,
            error: 'Die Beträge müssen zusammen dem Gesamtbetrag entsprechen.',
            total,
          };
  }
}

/**
 * Re-spreads the current selection when the split mode changes.
 *
 * Switching mode must not silently keep numbers that mean something different —
 * "1 share" and "1 percent" and "1 euro" are not the same claim on the money.
 */
export function respread(
  mode: SplitMode,
  accountIds: number[],
  value: number,
): Record<number, number> {
  if (accountIds.length === 0) {
    return {};
  }

  switch (mode) {
    case 'shares':
      return Object.fromEntries(accountIds.map((id) => [id, 1]));
    case 'percent': {
      const each = Math.floor((100 / accountIds.length) * 100) / 100;
      const shares = Object.fromEntries(accountIds.map((id) => [id, each]));
      const last = accountIds[accountIds.length - 1];
      // Same remainder rule as splitEvenly, so percent also totals exactly.
      shares[last] = Math.round((100 - each * (accountIds.length - 1)) * 100) / 100;
      return shares;
    }
    case 'absolute':
      return splitEvenly(value, accountIds);
  }
}
