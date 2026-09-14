import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from "@angular/core";
import { switchMap } from "rxjs";

import { Api, apiMessage, type GroupMember } from "../api/api";
import { Store } from "../domain/store";

/**
 * Asks who the signed-in user is in a group, instead of labelling the gap.
 *
 * A membership without `owned_account_id` has no balance at all, and the group
 * used to say so — "Kein Konto zugeordnet" told the user their app was broken
 * without telling them what to do about it. The obvious case is linked by the
 * backend on its own; everything left over is a plain question with the answers
 * as buttons, asked wherever the missing link is in the way.
 */
@Component({
    selector: "app-own-account-picker",
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ["./ui.css"],
    styles: `
        h2 {
            margin: 0 0 var(--space-1);
            font-size: 17px;
            font-weight: 600;
        }

        .hint {
            margin: 0 0 var(--space-3);
            color: var(--text-3);
            font-size: 13px;
        }

        /* The account named like the login: almost certainly the user, so it is
           marked rather than left to be found among the flatmates. */
        .row.suggested {
            background: var(--elevated);
        }

        .row:disabled {
            opacity: 0.5;
            cursor: default;
        }

        .avatar {
            display: grid;
            place-items: center;
            flex: none;
            width: 34px;
            height: 34px;
            border: 1px solid var(--hairline);
            border-radius: var(--radius-pill);
            background: var(--elevated);
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
        }
    `,
    template: `
        <h2>Wer bist du in dieser Gruppe?</h2>
        <p class="hint">
            @if (alreadyLinked()) {
                Tippe auf den Namen, der du bist.
            } @else {
                Die Gruppe kennt dich noch nicht, deshalb kann sie deinen Saldo nicht berechnen. Tippe auf deinen Namen.
            }
        </p>
        <div class="list">
            @for (account of freeAccounts(); track account.id) {
                <button
                    class="row"
                    type="button"
                    [class.suggested]="account.id === suggestedAccountId()"
                    [disabled]="busy()"
                    (click)="claim(account.id)"
                >
                    <span class="avatar">{{ account.name.charAt(0) }}</span>
                    <span class="body">
                        <span class="title">{{ account.name }}</span>
                        @if (account.id === suggestedAccountId()) {
                            <span class="sub">Gleicher Name wie dein Login</span>
                        }
                    </span>
                    <span class="trail"><span class="note">Das bin ich</span></span>
                </button>
            }
            <button class="row" type="button" [disabled]="busy()" (click)="addSelf()">
                <span class="avatar">+</span>
                <span class="body"><span class="title">Ich bin noch nicht in der Liste</span></span>
                <span class="trail"
                    ><span class="note">{{ username() }}</span></span
                >
            </button>
        </div>
    `,
})
export class OwnAccountPicker implements OnInit {
    readonly groupId = input.required<number>();
    /** Fired once the link exists and the store has been reloaded. */
    readonly linked = output<void>();

    private readonly api = inject(Api);
    private readonly store = inject(Store);

    private readonly members = signal<GroupMember[]>([]);
    protected readonly busy = signal(false);

    protected readonly username = computed(() => this.store.profile()?.username ?? "");

    /** "ändern" on a linked membership asks the same question with less alarm. */
    protected readonly alreadyLinked = computed(
        () => this.store.groups().find((g) => g.id === this.groupId())?.owned_account_id != null
    );

    /** Accounts no member has claimed — the placeholder people of this group. */
    protected readonly freeAccounts = computed(() => {
        const owned = new Set(this.members().map((m) => m.owned_account_id));
        return this.store
            .accountsOf(this.groupId())
            .filter((a) => !a.deleted && a.type === "personal" && !owned.has(a.id));
    });

    protected readonly suggestedAccountId = computed(() => {
        const username = this.username().toLowerCase();
        return this.freeAccounts().find((a) => a.name.toLowerCase() === username)?.id ?? null;
    });

    ngOnInit(): void {
        // `owned_account_id` lives on the membership, not on the account, so the
        // free ones cannot be worked out from the store alone.
        this.api.members(this.groupId()).subscribe({
            next: (members) => this.members.set(members),
            error: () => this.store.notice.set("Mitglieder konnten nicht geladen werden."),
        });
    }

    claim(accountId: number): void {
        const me = this.store.profile()?.id;
        if (me == null || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.store.notice.set(null);
        this.api.setOwnedAccount(this.groupId(), me, accountId).subscribe({
            next: () => this.done(),
            error: (error: unknown) => this.fail(error, "Zuordnung fehlgeschlagen."),
        });
    }

    /** For the user who was never added as a person: create them, then claim it. */
    addSelf(): void {
        const me = this.store.profile()?.id;
        const username = this.username();
        if (me == null || !username || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.store.notice.set(null);
        this.api
            .createAccount(this.groupId(), username)
            .pipe(switchMap((account) => this.api.setOwnedAccount(this.groupId(), me, account.id)))
            .subscribe({
                next: () => this.done(),
                error: (error: unknown) => this.fail(error, "Anlegen fehlgeschlagen."),
            });
    }

    private done(): void {
        // The link is on the group, the new account is in the group's data:
        // everything on screen depends on the reload, so it comes before the event.
        this.store.load().subscribe(() => {
            this.busy.set(false);
            this.linked.emit();
        });
    }

    private fail(error: unknown, fallback: string): void {
        this.busy.set(false);
        this.store.notice.set(apiMessage(error) ?? fallback);
    }
}
