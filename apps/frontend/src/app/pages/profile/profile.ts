import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';

import { AppConfigService } from '../../core/app-config';
import { Store } from '../../domain/store';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './profile.html',
  styleUrls: ['../../ui/ui.css', './profile.css'],
})
export class Profile {
  private readonly oidc = inject(OidcSecurityService);
  protected readonly store = inject(Store);
  protected readonly config = inject(AppConfigService);

  signOut(): void {
    // Discards the local token and calls Authentik's end-session endpoint.
    // The backend has no sessions to end — it never had any.
    this.oidc.logoff().subscribe();
  }
}
