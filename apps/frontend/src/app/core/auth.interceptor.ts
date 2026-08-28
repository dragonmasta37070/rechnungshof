import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { catchError, switchMap, tap, throwError } from 'rxjs';

import { ProviderStatusService } from './provider-status';

/** Public endpoints: sending a token here would be pointless, not harmful. */
const UNAUTHENTICATED = ['/api/config', '/api/version'];

/**
 * Attaches the Authentik access token and translates the two failure modes the
 * backend deliberately keeps apart.
 *
 * 401 means the credential is bad — expired, tampered with, wrong audience.
 * 503 means the backend could not *reach* Authentik to check it, so the token
 * may well be fine. Treating 503 as a logout would throw every user out on any
 * provider hiccup and hide an outage behind what looks like bad credentials,
 * which is exactly why the backend distinguishes them in the first place.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const oidc = inject(OidcSecurityService);
  const providerStatus = inject(ProviderStatusService);

  if (UNAUTHENTICATED.some((path) => req.url.startsWith(path))) {
    return next(req);
  }

  return oidc.getAccessToken().pipe(
    switchMap((token) => {
      const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

      return next(authed).pipe(
        // A successful call is the proof that the provider is reachable again,
        // so the outage banner clears on the next good response rather than
        // needing a poll or a reload.
        tap(() => providerStatus.reportReachable()),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse) {
            if (error.status === 503) {
              // Keep the token. The identity provider is down, not the session.
              providerStatus.reportUnavailable();
            } else if (error.status === 401) {
              providerStatus.reportReachable();
              // Let the library decide between a silent renew and a fresh login
              // rather than hard-redirecting on every single 401.
              oidc.authorize();
            } else {
              providerStatus.reportReachable();
            }
          }
          return throwError(() => error);
        }),
      );
    }),
  );
};
