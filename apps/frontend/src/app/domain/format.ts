/**
 * Number and date formatting.
 *
 * The handoff asks for `87.40 €` — symbol after the amount, separated by a
 * non-breaking space — rather than the React app's `€87.40`, so the amount is
 * formatted as a decimal and the symbol appended. That part is kept.
 *
 * The locale is not. The handoff's examples are en-GB, which put an English
 * decimal point and thousands comma next to entirely German copy: "1,234.56 €"
 * and "13 SEPTEMBER 2026" under a heading that reads "Wofür war das?". Every
 * user of this instance reads German, so the separators follow.
 */

// Two locales on purpose. de-AT groups thousands with a no-break space
// ("1 234,50"), which is correct Austrian typography but reads as a rendering
// fault in a dense list, so numbers use the dot everyone here writes by hand.
// Dates stay de-AT for "Jänner" and "Feber".
const NUMBER_LOCALE = "de-DE";
const DATE_LOCALE = "de-AT";
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
    return new Intl.NumberFormat(NUMBER_LOCALE, {
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
    return new Intl.DateTimeFormat(DATE_LOCALE, {
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
    return new Intl.DateTimeFormat(DATE_LOCALE, {
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

/**
 * `1 Mitglied` / `3 Mitglieder`.
 *
 * German has no bare-plural escape hatch the way "1 member(s)" is tolerated in
 * English, and the app was showing "1 Mitglieder", "1 Personen", "1 Tage mit
 * Ausgaben" and "1 Zahlungen" — all in the most common case of all, a group of
 * one or a settlement with a single payment.
 */
export function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}
