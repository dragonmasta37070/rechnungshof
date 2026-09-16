import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    signal,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import QRCode from "qrcode";
import { Observable } from "rxjs";

import { Api, apiMessage } from "../../api/api";
import { Store } from "../../domain/store";
import { Icon } from "../../ui/icon";

/**
 * Friends, so inviting someone into a group is one tap instead of typing a name.
 *
 * Every write here re-reads the overview rather than patching the three lists
 * by hand: accepting moves a row from "incoming" to "friends", and the server
 * already computes exactly that.
 */
@Component({
    selector: "app-friends",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, Icon],
    templateUrl: "./friends.html",
    styleUrls: ["../../ui/ui.css", "./friends.css"],
})
export class Friends {
    private readonly api = inject(Api);
    protected readonly store = inject(Store);

    protected readonly friends = computed(() => this.store.friends()?.friends ?? []);
    protected readonly incoming = computed(() => this.store.friends()?.incoming ?? []);
    protected readonly outgoing = computed(() => this.store.friends()?.outgoing ?? []);

    protected readonly username = signal("");
    protected readonly adding = signal(false);
    protected readonly addError = signal<string | null>(null);
    protected readonly busy = signal(false);
    /** The friend whose "Entfernen" is waiting for a yes — inline, not a dialog. */
    protected readonly removing = signal<number | null>(null);

    protected readonly qrOpen = signal(false);
    protected readonly quickLink = signal<string | null>(null);
    protected readonly copied = signal(false);
    /** Not on every platform — iOS and Android have it, desktop browsers mostly do not. */
    protected readonly canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>("qr");
    private readonly linkField = viewChild<ElementRef<HTMLElement>>("linkField");

    constructor() {
        // Both the canvas and the link arrive asynchronously (sheet open, then
        // the token), so drawing is tied to them rather than to the click.
        effect(() => {
            const canvas = this.canvas()?.nativeElement;
            const link = this.quickLink();
            if (canvas && link) {
                void QRCode.toCanvas(canvas, link, { width: 232, margin: 1 }).catch(() => undefined);
            }
        });
    }

    add(): void {
        const username = this.username().trim();
        if (!username || this.adding()) {
            return;
        }
        this.adding.set(true);
        this.addError.set(null);
        this.api.sendFriendRequest(username).subscribe({
            next: () =>
                this.store.refreshFriends().subscribe(() => {
                    this.adding.set(false);
                    this.username.set("");
                }),
            error: (error: unknown) => {
                this.adding.set(false);
                this.addError.set(apiMessage(error) ?? "Anfrage fehlgeschlagen.");
            },
        });
    }

    accept(requestId: number): void {
        this.write(this.api.acceptFriendRequest(requestId), "Anfrage konnte nicht angenommen werden.");
    }

    /** Declining one addressed to you, and withdrawing one you sent. */
    dismiss(requestId: number): void {
        this.write(this.api.deleteFriendRequest(requestId), "Anfrage konnte nicht entfernt werden.");
    }

    remove(userId: number): void {
        this.removing.set(null);
        this.write(this.api.removeFriend(userId), "Freund konnte nicht entfernt werden.");
    }

    private write(request: Observable<unknown>, failure: string): void {
        if (this.busy()) {
            return;
        }
        this.busy.set(true);
        request.subscribe({
            next: () => this.store.refreshFriends().subscribe({ next: () => this.busy.set(false) }),
            error: () => {
                this.busy.set(false);
                this.store.notice.set(failure);
            },
        });
    }

    openQr(): void {
        this.qrOpen.set(true);
        this.copied.set(false);
        if (this.quickLink()) {
            return;
        }
        this.api.friendQuickLink().subscribe({
            next: ({ token }) => this.quickLink.set(`${location.origin}/friends/add/${token}`),
            error: () => {
                this.qrOpen.set(false);
                this.store.notice.set("QR-Code konnte nicht geladen werden.");
            },
        });
    }

    async copyLink(): Promise<void> {
        const link = this.quickLink();
        if (!link) {
            return;
        }
        try {
            await navigator.clipboard.writeText(link);
            this.copied.set(true);
        } catch {
            // ponytail: no clipboard API outside a secure context, and the user can
            // deny it. Selecting the link is the fallback every browser has.
            const element = this.linkField()?.nativeElement;
            if (element) {
                getSelection()?.selectAllChildren(element);
            }
        }
    }

    shareLink(): void {
        const link = this.quickLink();
        if (link) {
            // Rejects when the user dismisses the share sheet — not an error.
            void navigator.share({ title: "Freund werden", url: link }).catch(() => undefined);
        }
    }
}
