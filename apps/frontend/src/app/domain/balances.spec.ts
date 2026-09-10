import type { Group, PersonalAccount, Transaction } from "../api/api";
import { balancesFor, netByPerson, settlementFor, type GroupLedger } from "./balances";

let nextId = 1;

function account(name: string, id = nextId++): PersonalAccount {
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

function expense(
    value: number,
    creditor: number,
    debitorShares: Record<number, number>,
    overrides: Partial<Transaction> = {}
): Transaction {
    return {
        id: nextId++,
        group_id: 1,
        type: "purchase",
        name: "expense",
        description: "",
        value,
        currency_identifier: "EUR",
        currency_conversion_rate: 1,
        billed_at: "2026-01-01",
        tags: [],
        deleted: false,
        creditor_shares: { [creditor]: 1 },
        debitor_shares: debitorShares,
        split_mode: "shares",
        last_changed: "2026-01-01T00:00:00Z",
        positions: [],
        files: [],
        ...overrides,
    } as Transaction;
}

function group(id: number, name: string): Group {
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
        owned_account_id: null,
    };
}

describe("balancesFor", () => {
    it("splits an evenly shared expense", () => {
        // Alice pays 60, split three ways: she is owed 40, the others owe 20 each.
        const alice = account("Alice");
        const bob = account("Bob");
        const carol = account("Carol");
        const accounts = [alice, bob, carol];
        const transactions = [expense(60, alice.id, { [alice.id]: 1, [bob.id]: 1, [carol.id]: 1 })];

        const byId = new Map(balancesFor(accounts, transactions).map((b) => [b.accountId, b]));

        expect(byId.get(alice.id)!.balance).toBeCloseTo(40, 6);
        expect(byId.get(bob.id)!.balance).toBeCloseTo(-20, 6);
        expect(byId.get(carol.id)!.balance).toBeCloseTo(-20, 6);
    });

    it("balances always sum to zero", () => {
        // The invariant that matters: money is neither created nor destroyed.
        const a = account("A");
        const b = account("B");
        const c = account("C");
        const accounts = [a, b, c];
        const transactions = [
            expense(37.55, a.id, { [a.id]: 1, [b.id]: 1, [c.id]: 1 }),
            expense(12.4, b.id, { [a.id]: 2, [c.id]: 1 }),
            expense(99.99, c.id, { [a.id]: 1, [b.id]: 3 }),
        ];

        const total = balancesFor(accounts, transactions).reduce((sum, b) => sum + b.balance, 0);

        expect(total).toBeCloseTo(0, 6);
    });

    it("honours an absolute split", () => {
        // Absolute shares are amounts, not weights: Bob owes exactly 10.
        const alice = account("Alice");
        const bob = account("Bob");
        const transactions = [expense(30, alice.id, { [bob.id]: 10, [alice.id]: 20 }, { split_mode: "absolute" })];

        const byId = new Map(balancesFor([alice, bob], transactions).map((b) => [b.accountId, b]));

        expect(byId.get(bob.id)!.balance).toBeCloseTo(-10, 6);
        expect(byId.get(alice.id)!.balance).toBeCloseTo(10, 6);
    });
});

describe("settlementFor", () => {
    it("names the payer and the payee the right way round", () => {
        // Bob owes Alice 20. The edge must read "Bob pays Alice", not the reverse —
        // computeGroupSettlement's own field names are inverted relative to this.
        const alice = account("Alice");
        const bob = account("Bob");
        const transactions = [expense(40, alice.id, { [alice.id]: 1, [bob.id]: 1 })];

        const plan = settlementFor([alice, bob], transactions);

        expect(plan).toHaveLength(1);
        expect(plan[0].debitorId).toBe(bob.id);
        expect(plan[0].creditorId).toBe(alice.id);
        expect(plan[0].amount).toBeCloseTo(20, 6);
    });

    it("produces no payments for a settled group", () => {
        const alice = account("Alice");
        const bob = account("Bob");
        const transactions = [
            expense(20, alice.id, { [alice.id]: 1, [bob.id]: 1 }),
            expense(20, bob.id, { [alice.id]: 1, [bob.id]: 1 }),
        ];

        expect(settlementFor([alice, bob], transactions)).toHaveLength(0);
    });
});

describe("netByPerson", () => {
    function ledger(
        groupId: number,
        groupName: string,
        accounts: PersonalAccount[],
        transactions: Transaction[],
        ownAccountId: number
    ): GroupLedger {
        return { group: group(groupId, groupName), accounts, transactions, ownAccountId };
    }

    it("nets opposing debts across two groups down to the difference", () => {
        // This is the case per-group balances cannot express: the user owes Bob 20
        // in the flat, Bob owes the user 30 on the ski trip. Net: Bob owes 10.
        const meFlat = account("Me");
        const bobFlat = account("Bob");
        const flat = ledger(
            1,
            "Flat",
            [meFlat, bobFlat],
            [expense(40, bobFlat.id, { [meFlat.id]: 1, [bobFlat.id]: 1 })],
            meFlat.id
        );

        const meSki = account("Me");
        const bobSki = account("Bob");
        const ski = ledger(
            2,
            "Ski",
            [meSki, bobSki],
            [expense(60, meSki.id, { [meSki.id]: 1, [bobSki.id]: 1 })],
            meSki.id
        );

        const netted = netByPerson([flat, ski]);

        expect(netted).toHaveLength(1);
        expect(netted[0].accountName).toBe("Bob");
        // +20 owed by the user, -30 owed to them => -10, i.e. Bob owes 10.
        expect(netted[0].net).toBeCloseTo(-10, 6);
        expect(netted[0].groups.toSorted()).toEqual(["Flat", "Ski"]);
    });

    it("hides counterparties that cancel out exactly", () => {
        const meA = account("Me");
        const bobA = account("Bob");
        const a = ledger(1, "A", [meA, bobA], [expense(40, bobA.id, { [meA.id]: 1, [bobA.id]: 1 })], meA.id);

        const meB = account("Me");
        const bobB = account("Bob");
        const b = ledger(2, "B", [meB, bobB], [expense(40, meB.id, { [meB.id]: 1, [bobB.id]: 1 })], meB.id);

        expect(netByPerson([a, b])).toHaveLength(0);
    });

    it("ignores settlement edges the user is not part of", () => {
        // Bob owes Carol; that is none of the user's business and must not appear.
        const me = account("Me");
        const bob = account("Bob");
        const carol = account("Carol");
        const l = ledger(1, "Trip", [me, bob, carol], [expense(30, carol.id, { [bob.id]: 1, [carol.id]: 1 })], me.id);

        expect(netByPerson([l])).toHaveLength(0);
    });

    it("skips groups where the user has no account", () => {
        const alice = account("Alice");
        const bob = account("Bob");
        const l: GroupLedger = {
            group: group(1, "Observed"),
            accounts: [alice, bob],
            transactions: [expense(20, alice.id, { [alice.id]: 1, [bob.id]: 1 })],
            ownAccountId: null,
        };

        expect(netByPerson([l])).toHaveLength(0);
    });

    it("sorts by magnitude so the largest debt is first", () => {
        const me1 = account("Me");
        const small = account("Small");
        const g1 = ledger(1, "G1", [me1, small], [expense(10, small.id, { [me1.id]: 1, [small.id]: 1 })], me1.id);

        const me2 = account("Me");
        const big = account("Big");
        const g2 = ledger(2, "G2", [me2, big], [expense(200, big.id, { [me2.id]: 1, [big.id]: 1 })], me2.id);

        expect(netByPerson([g1, g2]).map((n) => n.accountName)).toEqual(["Big", "Small"]);
    });
});
