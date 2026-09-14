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
import { Router, RouterLink } from "@angular/router";

import { Api, apiMessage } from "../../api/api";
import { balancesFor } from "../../domain/balances";
import { plural } from "../../domain/format";
import { Store } from "../../domain/store";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icon";

@Component({
    selector: "app-groups",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, FormsModule, Icon, Amount],
    templateUrl: "./groups.html",
    styleUrls: ["../../ui/ui.css", "./groups.css"],
})
export class Groups {
    private readonly api = inject(Api);
    private readonly router = inject(Router);
    protected readonly store = inject(Store);

    protected readonly sheetOpen = signal(false);
    private readonly nameField = viewChild<ElementRef<HTMLInputElement>>("nameField");

    constructor() {
        // The sheet has exactly one field. Making the user click it first is a
        // wasted interaction, and on a phone it costs a tap plus the keyboard.
        effect(() => this.nameField()?.nativeElement.focus());
    }

    protected readonly newName = signal("");
    protected readonly saving = signal(false);

    protected readonly subtitle = computed(() => plural(this.store.groups().length, "Gruppe", "Gruppen"));

    protected readonly rows = computed(() =>
        this.store.groups().map((group) => {
            const own = group.owned_account_id;
            const balance =
                own == null
                    ? 0
                    : (balancesFor(this.store.accountsOf(group.id), this.store.transactionsOf(group.id)).find(
                          (b) => b.accountId === own
                      )?.balance ?? 0);

            return {
                group,
                balance,
                // Without an account link there is no balance to show — a 0,00 €
                // here read as "you are square" to someone who had paid for all of it.
                linked: own != null,
                members: plural(
                    this.store.accountsOf(group.id).filter((a) => a.type === "personal").length,
                    "Mitglied",
                    "Mitglieder"
                ),
                expenses: plural(
                    this.store.transactionsOf(group.id).filter((t) => !t.deleted).length,
                    "Ausgabe",
                    "Ausgaben"
                ),
                tone: Math.abs(balance) < 0.005 ? "muted" : balance > 0 ? "success" : "error",
                note: Math.abs(balance) < 0.005 ? "ausgeglichen" : balance > 0 ? "bekommst du zurück" : "schuldest du",
            };
        })
    );

    protected readonly answering = signal<number | null>(null);

    open(): void {
        this.newName.set("");
        this.sheetOpen.set(true);
    }

    /** Accepts an invite addressed to this user and drops them into the group. */
    accept(inviteId: number, token: string): void {
        if (this.answering() !== null) {
            return;
        }
        this.answering.set(inviteId);
        this.store.notice.set(null);
        this.api.joinGroup(token).subscribe({
            next: (group) =>
                this.store.load().subscribe(() => {
                    this.answering.set(null);
                    void this.router.navigate(["/groups", group.id]);
                }),
            error: (error: unknown) => {
                this.answering.set(null);
                this.store.notice.set(apiMessage(error) ?? "Beitreten fehlgeschlagen.");
            },
        });
    }

    decline(inviteId: number): void {
        if (this.answering() !== null) {
            return;
        }
        this.answering.set(inviteId);
        this.api.declineInvite(inviteId).subscribe({
            next: () => this.store.refreshInvites().subscribe(() => this.answering.set(null)),
            error: () => {
                this.answering.set(null);
                this.store.notice.set("Einladung konnte nicht abgelehnt werden.");
            },
        });
    }

    create(): void {
        const name = this.newName().trim();
        if (!name || this.saving()) {
            return;
        }
        this.saving.set(true);
        this.store.notice.set(null);
        this.api
            .createGroup({
                name,
                currency_identifier: "EUR",
                // The backend defaults this to false, which creates a group with no
                // accounts at all — nothing to split across and nobody to pick as
                // payer. The creator is obviously a participant.
                add_user_account_on_join: true,
            })
            .subscribe({
                next: (group) => {
                    this.saving.set(false);
                    this.sheetOpen.set(false);
                    // Reload so the new group arrives with its auto-created account, then
                    // go straight into it — creating a group is always followed by wanting
                    // to be in it.
                    this.store.load().subscribe(() => this.router.navigate(["/groups", group.id]));
                },
                error: () => {
                    this.saving.set(false);
                    this.store.notice.set("Gruppe konnte nicht angelegt werden.");
                },
            });
    }
}
