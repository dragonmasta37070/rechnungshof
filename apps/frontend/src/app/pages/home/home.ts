import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { OidcSecurityService } from 'angular-auth-oidc-client';

import { ProviderStatusService } from '../../core/provider-status';

interface Profile {
  id: number;
  username: string;
  email: string;
  oidc_subject: string | null;
}

/**
 * Placeholder landing route. Its only job today is to prove the whole chain
 * works end to end: token attached, backend accepted it, user provisioned.
 * The global expense feed from the design handoff replaces this.
 */
@Component({
  selector: 'app-home',
  template: `
    <main class="home">
      @if (providerStatus.isUnavailable()) {
        <p class="banner">
          Authentik ist gerade nicht erreichbar. Du bleibst angemeldet, manche Daten fehlen
          eventuell.
        </p>
      }

      @if (profile(); as p) {
        <h1>Angemeldet</h1>
        <dl>
          <dt>Benutzer</dt>
          <dd>{{ p.username }}</dd>
          <dt>E-Mail</dt>
          <dd>{{ p.email }}</dd>
          <dt>Authentik-Subject</dt>
          <dd>{{ p.oidc_subject }}</dd>
        </dl>
      } @else if (error(); as e) {
        <p class="error">{{ e }}</p>
      } @else {
        <p>Profil wird geladen …</p>
      }

      <button type="button" (click)="signOut()">Abmelden</button>
    </main>
  `,
  styleUrl: './home.css',
})
export class Home {
  private readonly http = inject(HttpClient);
  private readonly oidc = inject(OidcSecurityService);
  protected readonly providerStatus = inject(ProviderStatusService);

  protected readonly profile = signal<Profile | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // This is the call that provisions the account on first sign-in.
    this.http.get<Profile>('/api/v1/profile').subscribe({
      next: (p) => this.profile.set(p),
      error: () => this.error.set('Profil konnte nicht geladen werden.'),
    });
  }

  signOut(): void {
    // Discards the local token and calls Authentik's end-session endpoint —
    // the backend has no sessions to end.
    this.oidc.logoff().subscribe();
  }
}
