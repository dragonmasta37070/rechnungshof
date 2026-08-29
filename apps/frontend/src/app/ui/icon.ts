import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The icon set, as inline SVG.
 *
 * The prototype used Font Awesome; shipping a whole icon font for ~18 glyphs
 * would cost more than the rest of the bundle. These are drawn to the same
 * semantics (the handoff lists the fa- names it used) at a 24x24 grid, stroked
 * with `currentColor` so they take the surrounding text colour.
 */
export type IconName =
  | 'receipt'
  | 'groups'
  | 'balance'
  | 'user'
  | 'plus'
  | 'minus'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'calendar'
  | 'tag'
  | 'check'
  | 'check-circle'
  | 'trash'
  | 'key'
  | 'close'
  | 'sign-out';

const PATHS: Record<IconName, string> = {
  receipt: 'M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3H5Zm3 5h8M8 12h8M8 16h5',
  groups: 'M3 7h8v5H3zM13 7h8v5h-8zM3 14h8v5H3zM13 14h8v5h-8z',
  balance: 'M12 4v16M6 8h12M6 8 3 15h6L6 8Zm12 0-3 7h6l-3-7ZM8 20h8',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  'chevron-left': 'm15 5-7 7 7 7',
  'chevron-down': 'm5 9 7 7 7-7',
  'chevron-up': 'm5 15 7-7 7 7',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  tag: 'M3 3h8l10 10-8 8L3 11V3Zm4.5 4.5h.01',
  check: 'm4 12 6 6L20 6',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  key: 'M15 3a6 6 0 1 0-4.2 10.3L4 20v3h3l7-7A6 6 0 0 0 15 3Zm2 4h.01',
  close: 'M6 6l12 12M18 6 6 18',
  'sign-out': 'M14 4h5v16h-5M3 12h11m0 0-4-4m4 4-4 4',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path [attr.d]="path()" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);

  protected readonly path = computed(() => PATHS[this.name()]);
}
