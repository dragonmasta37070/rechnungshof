import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { formatAmount } from "../domain/format";

/**
 * A signed amount, coloured by direction.
 *
 * Zero is deliberately neutral: a settled balance is not a small win, and
 * colouring it green would read as one. `EPSILON` matches the netting
 * threshold, so a balance the balances screen hides is also shown as settled
 * here rather than as a fraction of a cent.
 */
@Component({
    selector: "app-amount",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<span [class]="tone()">{{ text() }}</span>`,
    styles: `
        .positive {
            color: var(--color-success);
        }
        .negative {
            color: var(--color-error);
        }
        .neutral {
            color: var(--text-3);
        }
    `,
})
export class Amount {
    readonly value = input.required<number>();
    readonly currency = input("EUR");
    /** Render the magnitude only — for pills that state the direction in words. */
    readonly absolute = input(false);
    /**
     * Drop the colour. For totals that are not a claim on anyone: "your share
     * overall" is money you spent, and painting it green read as a windfall.
     */
    readonly plain = input(false);

    protected readonly text = computed(() =>
        formatAmount(this.absolute() ? Math.abs(this.value()) : this.value(), this.currency())
    );

    protected readonly tone = computed(() => {
        const value = this.value();
        if (this.plain() || Math.abs(value) < 0.005) {
            return "neutral";
        }
        return value > 0 ? "positive" : "negative";
    });
}
