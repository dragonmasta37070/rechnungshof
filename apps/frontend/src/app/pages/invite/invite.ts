import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { Api, apiMessage, type GroupPreview } from "../../api/api";
import { Icon } from "../../ui/icon";

/**
 * The landing page for `/invite/:token` — the only way a person with their own
 * login gets into a group.
 *
 * It sits outside the shell (like the editor): whoever follows the link is not
 * a member yet, so the tab bar would point at groups they cannot see. The route
 * is behind `authGuard`, which remembers the deep link before sending the user
 * to Authentik, so a link opened while logged out lands back here afterwards.
 */
@Component({
    selector: "app-invite",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Icon, RouterLink],
    template: `
        <div class="page-title"><h1>Einladung</h1></div>
        <div class="page">
            @if (preview(); as group) {
                <div class="card">
                    <p class="name">{{ group.name }}</p>
                    @if (group.description) {
                        <p class="desc">{{ group.description }}</p>
                    }
                    <div class="stat-row">
                        <span class="label">Währung</span>
                        <span class="value">{{ group.currency_identifier }}</span>
                    </div>
                </div>

                @if (error(); as e) {
                    <p class="notice" role="alert">{{ e }}</p>
                }

                @if (group.is_already_member) {
                    <p class="hint">Du bist bereits Mitglied.</p>
                    <button type="button" class="primary" (click)="open(group.id)">Zur Gruppe</button>
                } @else {
                    <p class="hint">Mit dem Beitritt kannst du Ausgaben dieser Gruppe sehen und erfassen.</p>
                    <button type="button" class="primary" [disabled]="joining()" (click)="join()">Beitreten</button>
                }
            } @else if (error(); as e) {
                <div class="empty">
                    <app-icon name="groups" [size]="32" />
                    <strong>Einladung ungültig</strong>
                    <span>{{ e }}</span>
                    <a class="back" routerLink="/groups">Zu den Gruppen</a>
                </div>
            } @else {
                <p class="hint">Einladung wird geprüft …</p>
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
        .desc {
            margin: var(--space-2) 0 var(--space-3);
            color: var(--text-3);
            font-size: 13px;
        }
        .hint {
            margin: var(--space-5) 0 var(--space-3);
            color: var(--text-3);
            font-size: 13px;
        }
        .notice {
            margin: var(--space-4) 0 0;
            padding: var(--space-3);
            border-radius: var(--radius-md);
            background: rgba(240, 92, 92, 0.16);
            color: var(--color-error);
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
export class Invite implements OnInit {
    /** From the route, via `withComponentInputBinding`. */
    readonly token = input.required<string>();

    private readonly api = inject(Api);
    private readonly router = inject(Router);

    protected readonly preview = signal<GroupPreview | null>(null);
    protected readonly error = signal<string | null>(null);
    protected readonly joining = signal(false);

    ngOnInit(): void {
        this.api.previewGroup(this.token()).subscribe({
            next: (preview) => this.preview.set(preview),
            // The backend's texts here are English and technical, and a malformed
            // token is refused before it can say anything at all.
            error: () => this.error.set("Dieser Einladungslink ist ungültig oder abgelaufen."),
        });
    }

    join(): void {
        if (this.joining()) {
            return;
        }
        this.joining.set(true);
        this.error.set(null);

        this.api.joinGroup(this.token()).subscribe({
            next: (group) => this.open(group.id),
            error: (error: unknown) => {
                this.joining.set(false);
                this.error.set(apiMessage(error) ?? "Beitreten fehlgeschlagen. Bitte nochmal versuchen.");
            },
        });
    }

    /**
     * ponytail: no `store.load()` here. This page lives outside the shell, so
     * navigating into it recreates the shell, whose constructor loads the store
     * — reloading here too would just fetch every group twice. If the shell ever
     * stops loading on construction, add it back.
     */
    open(groupId: number): void {
        void this.router.navigate(["/groups", groupId]);
    }
}
