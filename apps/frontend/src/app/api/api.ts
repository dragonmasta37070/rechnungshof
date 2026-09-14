import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";

import { Schemas } from "./schema";

export type User = Schemas.User;
export type Group = Schemas.Group;
export type GroupMember = Schemas.GroupMember;
export type Transaction = Schemas.Transaction;
export type NewTransaction = Schemas.NewTransaction;
export type PersonalAccount = Schemas.PersonalAccount;
export type ClearingAccount = Schemas.ClearingAccount;
export type NewAccount = Schemas.NewAccount;
export type SplitMode = Schemas.SplitMode;
export type GroupInvite = Schemas.GroupInvite;
export type GroupPreview = Schemas.GroupPreview;
export type PendingInvite = Schemas.PendingInvite;

/** The backend's own explanation of a rejected request, when it sent one. */
export function apiMessage(error: unknown): string | null {
    const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof message === "string" && message ? message : null;
}

/**
 * Typed wrapper over the REST API.
 *
 * Deliberately built on Angular's `HttpClient` rather than the fetch-based
 * client a full OpenAPI generator would emit: only requests that go through
 * `HttpClient` pass the auth interceptor, so a generated client would silently
 * bypass both the bearer token and the 401/503 handling. The types are still
 * generated (`schema.ts`, from `api/openapi.json`) — only the transport is ours.
 *
 * Methods are added as screens need them, not one per endpoint up front.
 */
@Injectable({ providedIn: "root" })
export class Api {
    private readonly http = inject(HttpClient);

    /**
     * The call that provisions the account. On a user's first ever request the
     * backend creates them from the token's `sub` claim, so this doubles as
     * "finish signing in".
     */
    profile(): Observable<User> {
        return this.http.get<User>("/api/v1/profile");
    }

    groups(): Observable<Group[]> {
        return this.http.get<Group[]>("/api/v1/groups");
    }

    group(groupId: number): Observable<Group> {
        return this.http.get<Group>(`/api/v1/groups/${groupId}`);
    }

    members(groupId: number): Observable<GroupMember[]> {
        return this.http.get<GroupMember[]>(`/api/v1/groups/${groupId}/members`);
    }

    accounts(groupId: number): Observable<(PersonalAccount | ClearingAccount)[]> {
        return this.http.get<(PersonalAccount | ClearingAccount)[]>(`/api/v1/groups/${groupId}/accounts`);
    }

    transactions(groupId: number): Observable<Transaction[]> {
        return this.http.get<Transaction[]>(`/api/v1/groups/${groupId}/transactions`);
    }

    createTransaction(groupId: number, transaction: NewTransaction): Observable<Transaction> {
        return this.http.post<Transaction>(`/api/v1/groups/${groupId}/transactions`, transaction);
    }

    updateTransaction(groupId: number, transactionId: number, transaction: NewTransaction): Observable<Transaction> {
        return this.http.post<Transaction>(`/api/v1/groups/${groupId}/transactions/${transactionId}`, transaction);
    }

    deleteTransaction(groupId: number, transactionId: number): Observable<unknown> {
        return this.http.delete(`/api/v1/groups/${groupId}/transactions/${transactionId}`);
    }

    createAccount(groupId: number, name: string): Observable<PersonalAccount> {
        return this.http.post<PersonalAccount>(`/api/v1/groups/${groupId}/accounts`, {
            type: "personal",
            name,
        });
    }

    createGroup(payload: Schemas.GroupCreatePayload): Observable<Group> {
        return this.http.post<Group>("/api/v1/groups", payload);
    }

    /** Only invites the current user created carry a `token`; the rest come back null. */
    invites(groupId: number): Observable<GroupInvite[]> {
        return this.http.get<GroupInvite[]>(`/api/v1/groups/${groupId}/invites`);
    }

    createInvite(groupId: number): Observable<GroupInvite> {
        const payload: Schemas.CreateInvitePayload = {
            description: "Einladungslink",
            single_use: false,
            join_as_editor: true,
        };
        return this.http.post<GroupInvite>(`/api/v1/groups/${groupId}/invites`, payload);
    }

    /** Invites one named person; they only become a member once they accept. */
    inviteUser(groupId: number, username: string): Observable<GroupInvite> {
        return this.http.post<GroupInvite>(`/api/v1/groups/${groupId}/invites/user`, { username });
    }

    deleteInvite(groupId: number, inviteId: number): Observable<unknown> {
        return this.http.delete(`/api/v1/groups/${groupId}/invites/${inviteId}`);
    }

    /** The invites addressed to the signed-in user, across all groups. */
    pendingInvites(): Observable<PendingInvite[]> {
        return this.http.get<PendingInvite[]>("/api/v1/invites");
    }

    declineInvite(inviteId: number): Observable<unknown> {
        return this.http.post(`/api/v1/invites/${inviteId}/decline`, {});
    }

    /** Links a member to the account that represents them in the group. */
    setOwnedAccount(groupId: number, userId: number, accountId: number | null): Observable<GroupMember> {
        return this.http.post<GroupMember>(`/api/v1/groups/${groupId}/members/${userId}/owned-account`, {
            owned_account_id: accountId,
        });
    }

    previewGroup(inviteToken: string): Observable<GroupPreview> {
        return this.http.post<GroupPreview>("/api/v1/groups/preview", { invite_token: inviteToken });
    }

    joinGroup(inviteToken: string): Observable<Group> {
        return this.http.post<Group>("/api/v1/groups/join", { invite_token: inviteToken });
    }
}
