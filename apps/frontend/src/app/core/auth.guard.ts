import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { OidcSecurityService } from "angular-auth-oidc-client";
import { catchError, map, of, take } from "rxjs";

import { rememberReturnUrl } from "./return-url";

/**
 * Gate for everything behind the login.
 *
 * Reads authentication state; it does not drive the flow. `checkAuth()` is the
 * callback-processing entry point — it inspects the URL for `code`/`state` and
 * performs the token exchange — so calling it here would re-run the exchange
 * machinery on every navigation, and would race the callback route for a
 * single-use authorization code. It runs exactly once, at bootstrap.
 */
export const authGuard: CanActivateFn = (_route, state) => {
    const oidc = inject(OidcSecurityService);
    const router = inject(Router);

    const toLogin = () => {
        rememberReturnUrl(state.url);
        // `auto=1` says "nobody has been refused anything yet, this is just a
        // visit without a session" — the login page may then start the flow on
        // its own. The 401 interceptor and a failed callback navigate to /login
        // without it, so a backend that rejects a valid token cannot loop.
        return router.createUrlTree(["/login"], { queryParams: { auto: "1" } });
    };

    return oidc.isAuthenticated$.pipe(
        take(1),
        map(({ isAuthenticated }) => isAuthenticated || toLogin()),
        // Without this the navigation dies on a blank route when the provider is
        // unreachable — the exact outage the 503 handling exists to survive.
        catchError(() => of(toLogin()))
    );
};
