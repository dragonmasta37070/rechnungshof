import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    input,
    OnInit,
    signal,
    viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { of, switchMap } from "rxjs";

import { Api, apiMessage, type GroupInvite, type GroupMember } from "../../api/api";
import { Store } from "../../domain/store";
import { Icon } from "../../ui/icon";
import { OwnAccountPicker } from "../../ui/own-account-picker";

/**
 * Everything about *who* is in a group, away from the expense list.
 *
 * The group page only shows money. Membership, the link between the signed-in
 * user and their account, placeholder people and invites all live here — the
 * group page was carrying two unrelated jobs, and the one that matters when a
 * balance reads 0,00 € was the harder one to find.
 */
@Component({
    selector: "app-group-settings",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, Icon, OwnAccountPicker],
    templateUrl: "./group-settings.html",
    styleUrls: ["../../ui/ui.css", "./group-settings.css"],
})
export class GroupSettings implements OnInit {
    /** From the route, via `withComponentInputBinding`. */
    readonly id = input.required<string>();

    private readonly api = inject(Api);
    private readonly router = inject(Router);
    protected readonly store = inject(Store);

    protected readonly groupId = computed(() => Number(this.id()));
    protected readonly group = computed(() => this.store.groups().find((g) => g.id === this.groupId()) ?? null);

    protected readonly members = signal<GroupMember[]>([]);
    protected readonly invites = signal<GroupInvite[]>([]);

    /** The account picker is always open while nothing is linked. */
    protected readonly chooserOpen = signal(false);

    protected readonly username = signal("");
    protected readonly inviting = signal(false);
    protected readonly inviteError = signal<string | null>(null);

    protected readonly addPersonOpen = signal(false);
    protected readonly newPersonName = signal("");
    protected readonly addingPerson = signal(false);

    protected readonly linkOpen = signal(false);
    protected readonly inviteLink = signal<string | null>(null);
    protected readonly copied = signal(false);
    /** Not on every platform — iOS and Android have it, desktop browsers mostly do not. */
    protected readonly canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    private readonly personField = viewChild<ElementRef<HTMLInputElement>>("personField");
    private readonly linkField = viewChild<ElementRef<HTMLElement>>("linkField");

    private readonly accounts = computed(() =>
        this.store.accountsOf(this.groupId()).filter((a) => !a.deleted && a.type === "personal")
    );

    /** Accounts no member has claimed — the placeholder people of this group. */
    protected readonly freeAccounts = computed(() => {
        const owned = new Set(this.members().map((m) => m.owned_account_id));
        return this.accounts().filter((a) => !owned.has(a.id));
    });

    protected readonly ownAccountName = computed(() => {
        const own = this.group()?.owned_account_id;
        return own == null ? null : (this.accounts().find((a) => a.id === own)?.name ?? null);
    });

    protected readonly memberRows = computed(() => {
        const me = this.store.profile()?.id;
        const nameOf = new Map(this.accounts().map((a) => [a.id, a.name]));
        return (
            this.members()
                .map((member) => ({
                    member,
                    isMe: member.user_id === me,
                    role: member.is_owner ? "Besitzer" : member.can_write ? "kann bearbeiten" : "nur lesen",
                    accountName: member.owned_account_id == null ? null : (nameOf.get(member.owned_account_id) ?? null),
                }))
                // Your own row first — it is the one the user came for.
                .toSorted((a, b) => Number(b.isMe) - Number(a.isMe))
        );
    });

    /** Invites addressed to a person, as opposed to a shareable link. */
    protected readonly pendingInvites = computed(() => this.invites().filter((i) => i.invited_username));

    ngOnInit(): void {
        this.reload();
    }

    private reload(): void {
        this.api.members(this.groupId()).subscribe({
            next: (members) => this.members.set(members),
            error: () => this.store.notice.set("Mitglieder konnten nicht geladen werden."),
        });
        this.api.invites(this.groupId()).subscribe({
            next: (invites) => this.invites.set(invites),
            error: () => undefined,
        });
    }

    back(): void {
        void this.router.navigate(["/groups", this.groupId()]);
    }

    /** The picker has linked the user and reloaded the store; catch up the members. */
    onLinked(): void {
        this.chooserOpen.set(false);
        this.reload();
    }

    /** Invites someone who has their own login, by username. */
    invite(): void {
        const username = this.username().trim();
        if (!username || this.inviting()) {
            return;
        }
        this.inviting.set(true);
        this.inviteError.set(null);
        this.api.inviteUser(this.groupId(), username).subscribe({
            next: (invite) => {
                this.inviting.set(false);
                this.username.set("");
                this.invites.update((current) => [...current, invite]);
            },
            error: (error: unknown) => {
                this.inviting.set(false);
                this.inviteError.set(apiMessage(error) ?? "Einladung fehlgeschlagen.");
            },
        });
    }

    withdraw(inviteId: number): void {
        this.api.deleteInvite(this.groupId(), inviteId).subscribe({
            next: () => this.invites.update((current) => current.filter((i) => i.id !== inviteId)),
            error: () => this.store.notice.set("Einladung konnte nicht zurückgezogen werden."),
        });
    }

    /**
     * Adds a participant who has no account of their own.
     *
     * The common case for a shared-expenses app: you split with flatmates and
     * friends who will never log in.
     */
    addPerson(): void {
        const name = this.newPersonName().trim();
        if (!name || this.addingPerson()) {
            return;
        }
        this.addingPerson.set(true);
        this.store.notice.set(null);
        this.api.createAccount(this.groupId(), name).subscribe({
            next: () =>
                this.store.refreshGroup(this.groupId()).subscribe(() => {
                    this.addingPerson.set(false);
                    this.addPersonOpen.set(false);
                    this.newPersonName.set("");
                }),
            error: () => {
                this.addingPerson.set(false);
                this.store.notice.set("Person konnte nicht hinzugefügt werden.");
            },
        });
    }

    /**
     * Opens the invite sheet with a shareable link.
     *
     * The link is reusable and never expires, so an existing one is reused
     * rather than piling up a row per share. Only invites this user created
     * come back with a token, hence the `token` check.
     */
    openLink(): void {
        this.linkOpen.set(true);
        this.copied.set(false);
        if (this.inviteLink()) {
            return;
        }
        this.store.notice.set(null);

        this.api
            .invites(this.groupId())
            .pipe(
                switchMap((invites) => {
                    const usable = invites.find(
                        (i) =>
                            i.token &&
                            !i.single_use &&
                            (i.valid_until === null || Date.parse(i.valid_until) > Date.now())
                    );
                    return usable ? of(usable) : this.api.createInvite(this.groupId());
                })
            )
            .subscribe({
                next: (invite) => this.inviteLink.set(`${location.origin}/invite/${invite.token}`),
                error: (error: unknown) => {
                    this.linkOpen.set(false);
                    this.store.notice.set(apiMessage(error) ?? "Einladungslink konnte nicht erstellt werden.");
                },
            });
    }

    async copyLink(): Promise<void> {
        const link = this.inviteLink();
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
        const link = this.inviteLink();
        if (link) {
            // Rejects when the user dismisses the share sheet — not an error.
            void navigator.share({ title: this.group()?.name, url: link }).catch(() => undefined);
        }
    }

    openAddPerson(): void {
        this.addPersonOpen.set(true);
        // One field in the sheet, so focus it rather than costing a tap.
        setTimeout(() => this.personField()?.nativeElement.focus());
    }
}
