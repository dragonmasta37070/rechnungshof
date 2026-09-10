import { Component, inject, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { OidcSecurityService } from "angular-auth-oidc-client";
import { take } from "rxjs";

import { takeReturnUrl } from "../../core/return-url";

/**
 * Where Authentik returns to after the authorization code flow.
 *
 * The code exchange already happened during bootstrap, so this route only reads
 * the resulting state and forwards. Calling `checkAuth()` again here would be a
 * second attempt to redeem a single-use authorization code, and whichever call
 * lost the race would fail with `invalid_grant`.
 */
@Component({
    selector: "app-callback",
    template: `<p class="pending">Anmeldung wird abgeschlossen …</p>`,
    styles: `
        .pending {
            display: grid;
            place-items: center;
            min-height: 100dvh;
            margin: 0;
            color: var(--text-3);
            font-size: 15px;
        }
    `,
})
export class Callback implements OnInit {
    private readonly oidc = inject(OidcSecurityService);
    private readonly router = inject(Router);

    ngOnInit(): void {
        this.oidc.isAuthenticated$.pipe(take(1)).subscribe({
            next: ({ isAuthenticated }) => {
                // replaceUrl so the callback URL, code and state never end up in
                // history where a back navigation could replay them.
                this.router.navigateByUrl(isAuthenticated ? takeReturnUrl() : "/login", {
                    replaceUrl: true,
                });
            },
            error: () => this.router.navigate(["/login"], { replaceUrl: true }),
        });
    }
}
