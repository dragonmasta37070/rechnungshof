/**
 * Number and date formatting, per the design handoff's "Interactions & behavior".
 *
 * Note this deliberately differs from the React app's `useFormatCurrency`, which
 * uses `Intl` with `style: 'currency'` and so renders `€87.40`. The handoff asks
 * for `87.40 €` — symbol after the amount, separated by a non-breaking space —
 * so the amount is formatted as a decimal and the symbol appended.
 */

const LOCALE = "en-GB";
const NBSP = " ";

const SYMBOLS: Record<string, string> = {
    EUR: "€",
    CHF: "CHF",
    USD: "$",
    GBP: "£",
};

export function currencySymbol(identifier: string): string {
    return SYMBOLS[identifier] ?? identifier;
}

/** `87.40 €` — always two decimals, non-breaking space before the symbol. */
export function formatAmount(value: number, currencyIdentifier: string): string {
    return `${formatNumber(value)}${NBSP}${currencySymbol(currencyIdentifier)}`;
}

/** Bare number, two decimals. For inputs and sums where no symbol belongs. */
export function formatNumber(value: number): string {
    return new Intl.NumberFormat(LOCALE, {
        style: "decimal",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

/** `20/08/2026` — the form used inside date fields. */
export function formatDateShort(iso: string): string {
    const date = parseIso(iso);
    if (!date) {
        return "";
    }
    return new Intl.DateTimeFormat(LOCALE, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(date);
}

/** `20 August 2026` — the form used as a date-section header. */
export function formatDateLong(iso: string): string {
    const date = parseIso(iso);
    if (!date) {
        return "";
    }
    return new Intl.DateTimeFormat(LOCALE, {
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(date);
}

/**
 * Parses a `YYYY-MM-DD` billing date as local time.
 *
 * `new Date('2026-08-20')` is parsed as UTC midnight, which in any negative
 * offset renders as the previous day — an expense dated the 20th showing up
 * under the 19th. Splitting the parts avoids that entirely.
 */
function parseIso(iso: string): Date | null {
    if (!iso) {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD`, the shape the API expects for `billed_at`. */
export function toIsoDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
