import { Injectable, signal } from "@angular/core";

/**
 * Whether the backend can currently reach Authentik.
 *
 * Exists so a 503 has somewhere to go other than a logout. The UI reads this to
 * show "temporarily unavailable" while keeping the user signed in, because the
 * token is probably still valid — we just cannot have it checked right now.
 */
@Injectable({ providedIn: "root" })
export class ProviderStatusService {
    private readonly unavailable = signal(false);
    private readonly rejected = signal(false);

    /** True while the backend is answering 503 for the identity provider. */
    readonly isUnavailable = this.unavailable.asReadonly();

    /**
     * True after the backend refused a token we believed was good.
     *
     * Without this the user is simply returned to the login screen, clicks the
     * only button on it, is signed in again by Authentik's still-valid session,
     * is refused again, and bounces forever with nothing on screen explaining
     * why. The cause is always a deployment one — audience, issuer, or a
     * missing email claim — so the screen says where to look.
     */
    readonly isRejected = this.rejected.asReadonly();

    reportRejected(): void {
        this.rejected.set(true);
    }

    clearRejected(): void {
        this.rejected.set(false);
    }

    reportUnavailable(): void {
        this.unavailable.set(true);
    }

    reportReachable(): void {
        // Any non-503 answer proves the provider is reachable again, so clear the
        // banner on the first successful call rather than polling for recovery.
        if (this.unavailable()) {
            this.unavailable.set(false);
        }
    }
}
