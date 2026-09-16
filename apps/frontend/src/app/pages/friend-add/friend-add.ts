import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { Api, type FriendUser } from "../../api/api";
import { Store } from "../../domain/store";
import { Icon } from "../../ui/icon";

/**
 * The landing page for `/friends/add/:token` — someone's personal quick link.
 *
 * Like the group invite page it sits outside the shell and behind `authGuard`,
 * which remembers the deep link before sending the user to Authentik, so a link
 * opened while logged out lands back here afterwards. One tap is the whole
 * flow: the owner handed the link out, so nothing needs accepting afterwards.
 */
@Component({
    selector: "app-friend-add",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Icon, RouterLink],
    template: `
        <div class="page-title"><h1>Freund hinzufügen</h1></div>
        <div class="page">
            @if (owner(); as friend) {
                <div class="card">
                    <p class="name">{{ friend.username }}</p>
                </div>
                <p class="hint">Möchtest du {{ friend.username }} als Freund hinzufügen?</p>
                <button type="button" class="primary" [disabled]="adding()" (click)="add()">
                    Als Freund hinzufügen
                </button>
            } @else if (error(); as e) {
                <div class="empty">
                    <app-icon name="users" [size]="32" />
                    <strong>Link nicht nutzbar</strong>
                    <span>{{ e }}</span>
                    <a class="back" routerLink="/friends">Zu den Freunden</a>
                </div>
            } @else {
                <p class="hint">Link wird geprüft …</p>
            }
        </div>
    `,
    styleUrls: ["../../ui/ui.css"],
    styles: `
        .name {
            margin: 0;
            font-size: 19px;
            font-weight: 600;
        }
        .hint {
            margin: var(--space-5) 0 var(--space-3);
            color: var(--text-3);
            font-size: 13px;
        }
        .primary {
            width: 100%;
            min-height: 48px;
            border: 0;
            border-radius: var(--radius-md);
            background: var(--accent);
            color: var(--on-accent);
            font: inherit;
            font-weight: 600;
            cursor: pointer;
        }
        .primary:disabled {
            opacity: 0.5;
            cursor: default;
        }
        .back {
            min-height: 44px;
            margin-top: var(--space-2);
            padding: var(--space-3) var(--space-5);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            color: var(--text-2);
            text-decoration: none;
        }
    `,
})
export class FriendAdd implements OnInit {
    /** From the route, via `withComponentInputBinding`. */
    readonly token = input.required<string>();

    private readonly api = inject(Api);
    private readonly store = inject(Store);
    private readonly router = inject(Router);

    protected readonly owner = signal<FriendUser | null>(null);
    protected readonly error = signal<string | null>(null);
    protected readonly adding = signal(false);

    ngOnInit(): void {
        this.api.previewFriendQuick(this.token()).subscribe({
            next: (owner) => this.owner.set(owner),
            // 400 is the one case the backend can describe: it is the user's own
            // link. Anything else — unknown token, malformed uuid — is just dead.
            error: (failure: { status?: number }) =>
                this.error.set(failure?.status === 400 ? "Das ist dein eigener Link." : "Dieser Link ist ungültig."),
        });
    }

    add(): void {
        if (this.adding()) {
            return;
        }
        this.adding.set(true);
        this.api.addFriendQuick(this.token()).subscribe({
            // ponytail: no success notice. `store.notice` is the red failure
            // banner in the shell, and the friends list showing the new name is
            // the confirmation. Give notices a tone and this can say so.
            next: () => this.store.refreshFriends().subscribe({ next: () => this.done(), error: () => this.done() }),
            error: () => {
                this.adding.set(false);
                this.error.set("Dieser Link ist ungültig.");
                this.owner.set(null);
            },
        });
    }

    private done(): void {
        void this.router.navigate(["/friends"]);
    }
}
