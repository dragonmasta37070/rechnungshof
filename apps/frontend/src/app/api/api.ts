import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { Schemas } from './schema';

export type User = Schemas.User;
export type Group = Schemas.Group;
export type GroupMember = Schemas.GroupMember;
export type Transaction = Schemas.Transaction;
export type NewTransaction = Schemas.NewTransaction;
export type PersonalAccount = Schemas.PersonalAccount;
export type ClearingAccount = Schemas.ClearingAccount;
export type NewAccount = Schemas.NewAccount;
export type SplitMode = Schemas.SplitMode;

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
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  /**
   * The call that provisions the account. On a user's first ever request the
   * backend creates them from the token's `sub` claim, so this doubles as
   * "finish signing in".
   */
  profile(): Observable<User> {
    return this.http.get<User>('/api/v1/profile');
  }

  groups(): Observable<Group[]> {
    return this.http.get<Group[]>('/api/v1/groups');
  }

  group(groupId: number): Observable<Group> {
    return this.http.get<Group>(`/api/v1/groups/${groupId}`);
  }

  members(groupId: number): Observable<GroupMember[]> {
    return this.http.get<GroupMember[]>(`/api/v1/groups/${groupId}/members`);
  }

  accounts(groupId: number): Observable<(PersonalAccount | ClearingAccount)[]> {
    return this.http.get<(PersonalAccount | ClearingAccount)[]>(
      `/api/v1/groups/${groupId}/accounts`,
    );
  }

  transactions(groupId: number): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`/api/v1/groups/${groupId}/transactions`);
  }

  createTransaction(groupId: number, transaction: NewTransaction): Observable<Transaction> {
    return this.http.post<Transaction>(`/api/v1/groups/${groupId}/transactions`, transaction);
  }

  updateTransaction(
    groupId: number,
    transactionId: number,
    transaction: NewTransaction,
  ): Observable<Transaction> {
    return this.http.post<Transaction>(
      `/api/v1/groups/${groupId}/transactions/${transactionId}`,
      transaction,
    );
  }

  deleteTransaction(groupId: number, transactionId: number): Observable<unknown> {
    return this.http.delete(`/api/v1/groups/${groupId}/transactions/${transactionId}`);
  }

  createGroup(payload: Schemas.GroupCreatePayload): Observable<Group> {
    return this.http.post<Group>('/api/v1/groups', payload);
  }
}
