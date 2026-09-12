import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { OidcSecurityService } from "angular-auth-oidc-client";
import { of } from "rxjs";

import type { Group, PersonalAccount, Transaction, User } from "../api/api";
import { AppConfigService } from "../core/app-config";
import { Store } from "../domain/store";
import { Balances } from "./balances/balances";
import { Editor } from "./editor/editor";
import { Expenses } from "./expenses/expenses";
import { GroupView } from "./group/group";
import { Groups } from "./groups/groups";
import { Profile } from "./profile/profile";

/**
 * Smoke tests: every screen must render with realistic data.
 *
 * These exist because the app cannot be signed into in this environment — the
 * Authentik client id is not yet configured — so the authenticated screens
 * cannot be checked by looking at them. The compiler proves the templates are
 * type-correct; these prove they actually run, which is where null dereferences
 * and missing imports show up.
 */

const USER: User = {
    id: 1,
    username: "marco",
    email: "marco@example.org",
    registered_at: "2026-01-01T00:00:00Z",
    deleted: false,
    pending: false,
    is_guest_user: false,
    oidc_subject: "ak-abc",
};

function account(id: number, name: string): PersonalAccount {
    return {
        id,
        group_id: 1,
        type: "personal",
        name,
        description: "",
        deleted: false,
        last_changed: "2026-01-01T00:00:00Z",
    };
}

function group(id: number, name: string, ownAccountId: number | null): Group {
    return {
        id,
        name,
        description: "",
        currency_identifier: "EUR",
        terms: "",
        add_user_account_on_join: true,
        created_at: "2026-01-01T00:00:00Z",
        created_by: 1,
        last_changed: "2026-01-01T00:00:00Z",
        archived: false,
        is_owner: true,
        can_write: true,
        owned_account_id: ownAccountId,
    };
}

function expense(id: number, value: number, creditor: number, debitors: number[]): Transaction {
    return {
        id,
        group_id: 1,
        type: "purchase",
        name: `Ausgabe ${id}`,
        description: "",
        value,
        currency_identifier: "EUR",
        currency_conversion_rate: 1,
        billed_at: "2026-08-20",
        tags: [],
        deleted: false,
        creditor_shares: { [creditor]: 1 },
        debitor_shares: Object.fromEntries(debitors.map((d) => [d, 1])),
        split_mode: "shares",
        last_changed: "2026-08-20T00:00:00Z",
        positions: [],
        files: [],
    } as Transaction;
}

const ME = account(1, "Marco");
const BOB = account(2, "Bob");
const GROUP = group(1, "WG Sonnenweg", ME.id);

function configureStore(store: Store): void {
    store.profile.set(USER);
    store.groups.set([GROUP]);
    store.data.set({
        1: { accounts: [ME, BOB], transactions: [expense(10, 60, ME.id, [ME.id, BOB.id])] },
    });
    store.activeGroupId.set(1);
}

async function setup<T>(component: unknown, inputs: Record<string, unknown> = {}, fillStore = true) {
    await TestBed.configureTestingModule({
        providers: [
            provideRouter([]),
            provideHttpClient(),
            provideHttpClientTesting(),
            {
                provide: OidcSecurityService,
                useValue: { logoff: () => of(null), isAuthenticated$: of({ isAuthenticated: true }) },
            },
            {
                provide: AppConfigService,
                useValue: {
                    get: () => ({
                        messages: null,
                        imprint_url: null,
                        source_code_url: "",
                        issue_tracker_url: "",
                        oidc: { issuer: "https://auth.example.org/", client_id: "x" },
                    }),
                },
            },
        ],
    }).compileComponents();

    if (fillStore) {
        configureStore(TestBed.inject(Store));
    }

    const fixture = TestBed.createComponent(component as never) as ComponentFixture<T>;
    for (const [key, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(key, value);
    }
    await fixture.whenStable();
    return fixture;
}

function text(fixture: ComponentFixture<unknown>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? "";
}

describe("screens render", () => {
    afterEach(() => TestBed.resetTestingModule());

    it("expenses feed shows the expense, its group and the payer", async () => {
        const fixture = await setup(Expenses);
        const rendered = text(fixture);
        expect(rendered).toContain("Ausgabe 10");
        expect(rendered).toContain("WG Sonnenweg");
        expect(rendered).toContain("Marco");
        // 60 split two ways: the user's own share is 30.
        expect(rendered).toContain("30.00");
    });

    it("groups list shows members, expenses and the balance", async () => {
        const fixture = await setup(Groups);
        const rendered = text(fixture);
        expect(rendered).toContain("WG Sonnenweg");
        expect(rendered).toContain("2 Mitglieder");
        // The user paid 60 and owes 30, so they are owed 30.
        expect(rendered).toContain("30.00");
        expect(rendered).toContain("bekommst du zurück");
    });

    it("group view renders the balance toggle and the expense list", async () => {
        const fixture = await setup(GroupView, { id: "1" });
        const rendered = text(fixture);
        expect(rendered).toContain("WG Sonnenweg");
        expect(rendered).toContain("Dein Saldo");
        expect(rendered).toContain("Ausgabe 10");
    });

    it("group view balance panel lists members and the settlement", async () => {
        const fixture = await setup<GroupView>(GroupView, { id: "1" });
        (fixture.componentInstance as unknown as { panelOpen: { set(v: boolean): void } }).panelOpen.set(true);
        await fixture.whenStable();

        const rendered = text(fixture);
        expect(rendered).toContain("Bob");
        expect(rendered).toContain("Ausgleich");
        // Bob owes Marco 30 — the settlement must name the payer first.
        expect(rendered).toContain("Bob zahlt Marco");
    });

    it("balances screen nets by group and by person", async () => {
        const fixture = await setup(Balances);
        const rendered = text(fixture);
        expect(rendered).toContain("Nach Gruppe");
        expect(rendered).toContain("Nach Person");
        expect(rendered).toContain("Bob");
    });

    it("profile shows the account and the sign-out row", async () => {
        const fixture = await setup(Profile);
        const rendered = text(fixture);
        expect(rendered).toContain("marco");
        expect(rendered).toContain("ak-abc");
        expect(rendered).toContain("Abmelden");
    });

    it("editor opens an existing expense with its values loaded", async () => {
        const fixture = await setup(Editor, { groupId: "1", expenseId: "10" });
        const rendered = text(fixture);
        expect(rendered).toContain("Ausgabe bearbeiten");
        expect(rendered).toContain("Marco");
        expect(rendered).toContain("Bob");
        expect(rendered).toContain("Ausgabe löschen");
    });

    it("editor for a new expense defaults to the user paying and everyone splitting", async () => {
        const fixture = await setup(Editor, { groupId: "1", expenseId: "new" });
        const rendered = text(fixture);
        expect(rendered).toContain("Neue Ausgabe");
        // No delete row on something that does not exist yet.
        expect(rendered).not.toContain("Ausgabe löschen");
    });
});

describe("group creation", () => {
    afterEach(() => TestBed.resetTestingModule());

    it("asks the backend to create an account for the creator", async () => {
        // Without add_user_account_on_join the backend makes a group with no
        // accounts: nothing to split across and nobody selectable as payer.
        // It defaults to false, so omitting it is not harmless.
        const fixture = await setup(Groups);
        const http = TestBed.inject(HttpTestingController);

        const instance = fixture.componentInstance as unknown as {
            newName: { set(v: string): void };
            create(): void;
        };
        instance.newName.set("Neue Gruppe");
        instance.create();

        const req = http.expectOne("/api/v1/groups");
        expect(req.request.body.add_user_account_on_join).toBe(true);
        expect(req.request.body.name).toBe("Neue Gruppe");
        // No verify(): creating a group deliberately reloads the store, so a
        // follow-up GET /api/v1/profile is correct behaviour, not a leak.
        req.flush({ id: 99 });
    });
});

describe("expense editor", () => {
    afterEach(() => TestBed.resetTestingModule());

    interface EditorInternals {
        name: { set(v: string): void; (): string };
        value: { set(v: number): void; (): number };
        participants(): number[];
        creditorId(): number | null;
    }

    it("keeps what was typed when the name field is cleared", async () => {
        const fixture = await setup<Editor>(Editor, { groupId: "1", expenseId: "10" });
        const editor = fixture.componentInstance as unknown as EditorInternals;

        // The form used to be refilled whenever the name was empty, and reading
        // the name inside that effect made clearing the field re-read the stored
        // expense — silently reverting every other edit along with it.
        editor.value.set(99);
        editor.name.set("");
        await fixture.whenStable();

        expect(editor.value()).toBe(99);
        expect(editor.name()).toBe("");
    });

    it("preselects everyone when the accounts arrive after the group", async () => {
        const fixture = await setup<Editor>(Editor, { groupId: "1", expenseId: "new" }, false);
        const store = TestBed.inject(Store);
        const editor = fixture.componentInstance as unknown as EditorInternals;

        // The order the store actually fills in: the group list first, then each
        // group's accounts. Defaulting the split on the first of those two left
        // it permanently empty — no participants, no payer, nothing to split.
        store.groups.set([GROUP]);
        await fixture.whenStable();
        store.data.set({ 1: { accounts: [ME, BOB], transactions: [] } });
        await fixture.whenStable();

        expect(editor.participants()).toEqual([ME.id, BOB.id]);
        expect(editor.creditorId()).toBe(ME.id);
    });
});

describe("group view", () => {
    afterEach(() => TestBed.resetTestingModule());

    it("says a group it cannot find is missing rather than loading forever", async () => {
        const fixture = await setup<GroupView>(GroupView, { id: "999" });
        expect(text(fixture)).toContain("Gruppe nicht gefunden");
    });
});
