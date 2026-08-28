import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';

/**
 * Where Authentik returns to after the authorization code flow.
 *
 * `checkAuth()` performs the code-for-token exchange, so this route only exists
 * to host that call and then get out of the way.
 */
@Component({
  selector: 'app-callback',
  template: `<p class="pending">Anmeldung wird abgeschlossen …</p>`,
  styles: `
    .pending {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      margin: 0;
      color: var(--text-3);
      font-size: 15px;
    }
  `,
})
export class Callback implements OnInit {
  private readonly oidc = inject(OidcSecurityService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.oidc.checkAuth().subscribe(({ isAuthenticated }) => {
      this.router.navigate([isAuthenticated ? '/' : '/login'], { replaceUrl: true });
    });
  }
}
