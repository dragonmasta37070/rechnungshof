import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';

import { Store } from '../domain/store';
import { ProviderStatusService } from '../core/provider-status';
import { Icon } from './icon';

/**
 * The app frame: bottom tab bar on mobile, 248px sidebar on desktop.
 *
 * Both navigate the same routes; the breakpoint decides which is visible, so
 * there is one route table and no duplicated state. The editor and the login
 * screen sit outside this shell — the handoff hides the tab bar on both.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  private readonly oidc = inject(OidcSecurityService);
  protected readonly store = inject(Store);
  protected readonly providerStatus = inject(ProviderStatusService);

  constructor() {
    // Every screen under the shell reads from the store, so it is filled once
    // here rather than per route — which also stops a tab switch from
    // refetching data the previous tab already loaded.
    this.store.load().subscribe({ error: () => undefined });
  }

  signOut(): void {
    this.oidc.logoff().subscribe();
  }
}
