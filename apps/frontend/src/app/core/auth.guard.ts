import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map } from 'rxjs';

/**
 * Gate for everything behind the login.
 *
 * Sends unauthenticated visitors to the login screen rather than straight into
 * `authorize()`, so a bookmarked deep link does not bounce the browser to
 * Authentik before the user has seen anything.
 */
export const authGuard: CanActivateFn = () => {
  const oidc = inject(OidcSecurityService);
  const router = inject(Router);

  return oidc
    .checkAuth()
    .pipe(map(({ isAuthenticated }) => isAuthenticated || router.createUrlTree(['/login'])));
};
