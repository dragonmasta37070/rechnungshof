import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, switchMap, tap, throwError } from "rxjs";

import { ProviderStatusService } from "./provider-status";
import { rememberReturnUrl } from "./return-url";
import { OidcSecurityService } from "angular-auth-oidc-client";

/** Backend paths that are served without authentication. */
const UNAUTHENTICATED = new Set(["/api/config", "/api/version"]);

/**
 * Whether this request may carry our access token.
 *
 * An allowlist, not a denylist, and deliberately strict about the origin. The
 * OIDC library injects the same root `HttpClient` we do, so its calls to
 * Authentik — discovery, token exchange, userinfo, revocation — pass through
 * this interceptor too. Those are absolute URLs to another origin: attaching a
 * bearer to them is wrong (the token endpoint authenticates with the code
 * verifier, not a bearer), it forces a CORS preflight that can break silent
 * renew outright, and it hands our access token to an endpoint that never
 * asked for it.
 *
 * Matching on the parsed pathname rather than a raw `startsWith` also keeps
 * `/api/configuration` from being mistaken for the public `/api/config`.
 */
function mayCarryToken(rawUrl: string): boolean {
    let url: URL;
    try {
        url = new URL(rawUrl, window.location.origin);
    } catch {
        return false;
    }

    if (url.origin !== window.location.origin) {
        return false;
    }
    if (!url.pathname.startsWith("/api/")) {
        return false;
    }
    return !UNAUTHENTICATED.has(url.pathname);
}

/**
 * Attaches the access token and translates the two failure modes the backend
 * deliberately keeps apart.
 *
 * 401 means the credential is bad. 503 means the backend could not *reach*
 * Authentik to check it, so the token may well be fine — treating that as a
 * logout would throw every user out on a provider hiccup and disguise an outage
 * as a wave of bad credentials.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const oidc = inject(OidcSecurityService);
    const providerStatus = inject(ProviderStatusService);
    const router = inject(Router);

    if (!mayCarryToken(req.url)) {
        return next(req);
    }

    return oidc.getAccessToken().pipe(
        switchMap((token) => {
            const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

            return next(authed).pipe(
                // A successful call proves the provider is reachable again, so the
                // outage banner clears on the next good response rather than needing a
                // poll or a reload.
                tap(() => providerStatus.reportReachable()),
                catchError((error: unknown) => {
                    if (error instanceof HttpErrorResponse) {
                        if (error.status === 503) {
                            // Keep the token. The identity provider is down, not the session.
                            providerStatus.reportUnavailable();
                        } else if (error.status === 401) {
                            providerStatus.reportReachable();
                            // Send the user to the login screen — never straight into
                            // `authorize()`. A backend that answers 401 for a structurally
                            // valid token (unprovisioned user, missing email claim, clock
                            // skew) would otherwise loop: authorize -> Authentik's session
                            // cookie is still good -> silent consent -> back here -> 401.
                            // Concurrent 401s would also each start their own authorization
                            // with its own code verifier and race each other's state.
                            if (!router.url.startsWith("/login")) {
                                rememberReturnUrl(router.url);
                                void router.navigate(["/login"]);
                            }
                        } else {
                            providerStatus.reportReachable();
                        }
                    }
                    return throwError(() => error);
                })
            );
        })
    );
};
