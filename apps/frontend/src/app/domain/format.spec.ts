import { formatAmount, formatDateLong, formatDateShort, formatNumber, toIsoDate } from './format';

describe('formatAmount', () => {
  it('puts the symbol after the amount, separated by a non-breaking space', () => {
    // The handoff is explicit about this: `87.40 €`, not `€87.40`.
    const formatted = formatAmount(87.4, 'EUR');
    expect(formatted).toBe('87.40 €');
    expect(formatted).not.toContain(' '); // a plain space would allow a line break
  });

  it('always shows two decimals', () => {
    expect(formatAmount(5, 'EUR')).toBe('5.00 €');
    expect(formatAmount(1234.5, 'EUR')).toBe('1,234.50 €');
  });

  it('rounds to cents rather than truncating', () => {
    expect(formatNumber(0.005)).toBe('0.01');
    expect(formatNumber(-2.345)).toBe('-2.35');
  });

  it('falls back to the identifier for a currency with no symbol', () => {
    expect(formatAmount(10, 'CHF')).toBe('10.00 CHF');
    expect(formatAmount(10, 'XYZ')).toBe('10.00 XYZ');
  });
});

describe('date formatting', () => {
  it('renders DD/MM/YYYY for fields', () => {
    expect(formatDateShort('2026-08-20')).toBe('20/08/2026');
  });

  it('renders DD Month YYYY for section headers', () => {
    expect(formatDateLong('2026-08-20')).toBe('20 August 2026');
  });

  it('does not shift the day in a negative UTC offset', () => {
    // new Date('2026-01-01') is UTC midnight; naive formatting renders it as
    // 31 December west of Greenwich, filing an expense under the wrong day.
    expect(formatDateShort('2026-01-01')).toBe('01/01/2026');
    expect(formatDateLong('2026-01-01')).toBe('1 January 2026');
  });

  it('returns empty string for missing input rather than "Invalid Date"', () => {
    expect(formatDateShort('')).toBe('');
    expect(formatDateLong('')).toBe('');
  });

  it('round-trips through toIsoDate', () => {
    const iso = '2026-08-20';
    expect(toIsoDate(new Date(2026, 7, 20))).toBe(iso);
    expect(formatDateShort(toIsoDate(new Date(2026, 7, 20)))).toBe('20/08/2026');
  });
});
