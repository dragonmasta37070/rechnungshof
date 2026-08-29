import { Component, inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';

import { Icon } from '../../ui/icon';

/**
 * Sign-in screen. Layout follows the design handoff (§Screens 1) loosely for
 * now — the styled version comes with the rest of the screens; this is the
 * working entry point for the auth flow.
 */
@Component({
  selector: 'app-login',
  imports: [Icon],
  template: `
    <main class="login">
      <div class="mark" aria-hidden="true"><app-icon name="receipt" [size]="26" /></div>
      <h1>Rechnungshof</h1>
      <p>Geteilte Kosten, sauber abgerechnet. Die Anmeldung läuft ausschließlich über Authentik.</p>
      <button type="button" (click)="signIn()">
        <app-icon name="key" [size]="16" />
        Mit Authentik anmelden
      </button>
      <small>
        Authorization Code Flow mit PKCE · Public Client, kein Secret im Browser. Kein
        Registrierungsschritt — das Konto entsteht beim ersten Profilabruf.
      </small>
    </main>
  `,
  styleUrl: './login.css',
})
export class Login {
  private readonly oidc = inject(OidcSecurityService);

  signIn(): void {
    this.oidc.authorize();
  }
}
