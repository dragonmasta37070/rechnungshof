import { Component, inject, input, OnInit, signal } from "@angular/core";
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
            @if (starting()) {
                <p class="pending" role="status">Anmeldung wird gestartet …</p>
            }
            @if (!starting() || fallback()) {
                <button type="button" (click)="signIn()">
                    <app-icon name="key" [size]="16" />
                    Mit Authentik anmelden
                </button>
            }
            <p class="register">
                Noch kein Konto? <a [href]="registerUrl">Registrieren</a>
                <small>Nach der Registrierung muss ein Admin dich freischalten, bevor du dich anmelden kannst.</small>
            </p>
            <small>
                Authorization Code Flow mit PKCE · Public Client, kein Secret im Browser. Das Konto in der App entsteht
                beim ersten Login.
            </small>
        </main>
    `,
    styleUrl: "./login.css",
})
export class Login implements OnInit {
    private readonly oidc = inject(OidcSecurityService);
    private readonly config = inject(AppConfigService);
    protected readonly providerStatus = inject(ProviderStatusService);

    /**
     * `?auto=1`, set only by the auth guard: no session, nobody refused
     * anything. Bound by withComponentInputBinding. Arrivals from the 401
     * interceptor, from a failed callback, or from a hand-typed /login carry no
     * marker and get the button, so a rejected token cannot start a loop.
     */
    readonly auto = input<string>();

    /** True once we know the provider's discovery document never arrived. */
    protected readonly unreachable = signal(false);

    /** Auto-start in progress: text instead of the button. */
    protected readonly starting = signal(false);

    /** Brings the button back if the redirect never happened. */
    protected readonly fallback = signal(false);

    private readonly oidcConfig = this.config.get().oidc;
    protected readonly issuer = this.oidcConfig.issuer;
    protected readonly origin = window.location.origin;

    /** Authentik's own enrollment flow; there is no registration in this app. */
    protected readonly registerUrl =
        `${new URL(this.oidcConfig.issuer).origin}/if/flow/${this.oidcConfig.register_flow}/` +
        `?next=${encodeURIComponent(`${window.location.origin}/`)}`;

    ngOnInit(): void {
        if (!this.auto() || this.providerStatus.isRejected() || this.unreachable()) {
            return;
        }
        this.starting.set(true);
        // ponytail: one timer, no state machine. A blocked redirect just puts the
        // button back under the text; the user clicks it.
        setTimeout(() => this.fallback.set(true), 2000);
        this.signIn();
    }

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
                error: () => {
                    this.unreachable.set(true);
                    this.starting.set(false);
                },
            });
    }
}
