import { Component, inject, signal } from "@angular/core";
import { OidcSecurityService } from "angular-auth-oidc-client";
import { take } from "rxjs";

import { AppConfigService } from "../../core/app-config";
import { ProviderStatusService } from "../../core/provider-status";
import { Icon } from "../../ui/icon";

/**
 * Sign-in screen. Layout follows the design handoff (§Screens 1) loosely for
 * now — the styled version comes with the rest of the screens; this is the
 * working entry point for the auth flow.
 */
@Component({
    selector: "app-login",
    imports: [Icon],
    template: `
        <main class="login">
            <div class="mark" aria-hidden="true"><app-icon name="receipt" [size]="26" /></div>
            <h1>Rechnungshof</h1>
            <p>Geteilte Kosten, sauber abgerechnet. Die Anmeldung läuft ausschließlich über Authentik.</p>
            @if (unreachable()) {
                <p class="rejected" role="alert">
                    {{ issuer }} ist von hier aus nicht erreichbar. Meistens fehlt {{ origin }} als Redirect-URI im
                    Authentik-Provider — Authentik schickt CORS-Header nur an die dort eingetragenen Adressen. Sonst
                    stimmt der Issuer in der Backend-Konfiguration nicht.
                </p>
            }
            @if (providerStatus.isRejected()) {
                <p class="rejected" role="alert">
                    Die Anmeldung bei Authentik hat geklappt, der Server hat den Token aber abgelehnt. Das ist eine
                    Konfigurationssache: Audience, Issuer oder der fehlende E-Mail-Claim.
                </p>
            }
            <button type="button" (click)="signIn()">
                <app-icon name="key" [size]="16" />
                Mit Authentik anmelden
            </button>
            <small>
                Authorization Code Flow mit PKCE · Public Client, kein Secret im Browser. Kein Registrierungsschritt —
                das Konto entsteht beim ersten Profilabruf.
            </small>
        </main>
    `,
    styleUrl: "./login.css",
})
export class Login {
    private readonly oidc = inject(OidcSecurityService);
    private readonly config = inject(AppConfigService);
    protected readonly providerStatus = inject(ProviderStatusService);

    /** True once we know the provider's discovery document never arrived. */
    protected readonly unreachable = signal(false);

    protected readonly issuer = this.config.get().oidc.issuer;
    protected readonly origin = window.location.origin;

    signIn(): void {
        this.providerStatus.clearRejected();
        this.unreachable.set(false);

        // `authorize()` fetches the provider's discovery document itself, but
        // returns void and swallows the failure — leaving a button that does
        // nothing at all. Fetching it here first is the same request, with an
        // error we can put on the screen; `authorize()` then finds the endpoints
        // already stored and redirects.
        //
        // Not getAuthorizeUrl(): that only reads the stored document and never
        // fetches one, so before the first successful load it always fails.
        this.oidc
            .preloadAuthWellKnownDocument()
            .pipe(take(1))
            .subscribe({
                next: () => this.oidc.authorize(),
                error: () => this.unreachable.set(true),
            });
    }
}
