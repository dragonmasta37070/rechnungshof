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
  provideAuth,
  StsConfigHttpLoader,
  StsConfigLoader,
} from 'angular-auth-oidc-client';
import { map } from 'rxjs';

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
        // 'code' + PKCE. There is no client secret in a browser, which is why
        // the Authentik provider is configured as a public client.
        responseType: 'code',
        scope: 'openid profile email offline_access',
        // The backend refuses to provision a user from a token without an email
        // claim, so a missing email scope must fail here, loudly, not later.
        silentRenew: true,
        useRefreshToken: true,
        renewTimeBeforeTokenExpiresInSeconds: 30,
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
    // Resolve runtime config before the first route renders, so nothing has to
    // handle a half-configured app.
    provideAppInitializer(() => inject(AppConfigService).load()),
  ],
};
