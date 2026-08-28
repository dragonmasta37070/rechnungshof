import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  LogLevel,
  OidcSecurityService,
  provideAuth,
  StsConfigHttpLoader,
  StsConfigLoader,
} from 'angular-auth-oidc-client';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { AppConfigService, appConfig$, redirectUrl } from './core/app-config';
import { authInterceptor } from './core/auth.interceptor';
import { routes } from './app.routes';

/**
 * Builds the OIDC config from `GET /api/config` instead of from the bundle.
 *
 * The issuer and client id are deployment values; baking them in would mean one
 * build per environment. The redirect URL is not configured at all — the app
 * derives it from its own origin, so it is correct by construction and only has
 * to match what is registered in Authentik.
 */
export function oidcConfigLoader(http: HttpClient): StsConfigHttpLoader {
  return new StsConfigHttpLoader(
    appConfig$(http).pipe(
      map((config) => ({
        authority: config.oidc.issuer,
        clientId: config.oidc.client_id,
        redirectUrl: redirectUrl(),
        postLogoutRedirectUri: window.location.origin,
        // Where the library lands after a successful login. The callback route
        // overrides this with the remembered deep link when there is one.
        postLoginRoute: '/',
        // 'code' + PKCE (the library always uses S256 for this response type).
        // There is no client secret in a browser, which is why the Authentik
        // provider is configured as a public client.
        responseType: 'code',
        // The backend refuses to provision a user from a token without an email
        // claim, so the email scope is not optional here.
        scope: 'openid profile email offline_access',
        // Renews via a background token request rather than a hidden iframe,
        // so no silentRenewUrl is needed.
        silentRenew: true,
        useRefreshToken: true,
        // Deliberately generous: a backgrounded tab has throttled timers, and
        // missing the renewal window lands the user in a 401 instead.
        renewTimeBeforeTokenExpiresInSeconds: 90,
        logLevel: LogLevel.Warn,
      })),
    ),
  );
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAuth({
      loader: {
        provide: StsConfigLoader,
        useFactory: oidcConfigLoader,
        deps: [HttpClient],
      },
    }),
    provideAppInitializer(async () => {
      // Runtime config first — the OIDC config loader derives from it.
      await inject(AppConfigService).load();

      // Exactly once, before routing. This both restores an existing session
      // and performs the code exchange when the browser has just come back from
      // Authentik, which is why neither the guard nor the callback route calls
      // it: an authorization code is single-use and two callers would race.
      // A failure here must not block bootstrap — the guard sends the user to
      // the login screen instead of leaving them on a blank page.
      await firstValueFrom(
        inject(OidcSecurityService)
          .checkAuth()
          .pipe(catchError(() => of(null))),
      );
    }),
  ],
};
