import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Observable, shareReplay } from 'rxjs';

/** The `oidc` block of `GET /api/config`. */
export interface OidcConfig {
  issuer: string;
  client_id: string;
}

/** `GET /api/config` — served unauthenticated by the backend. */
export interface AppConfig {
  messages: { type: string; title: string | null; body: string }[] | null;
  imprint_url: string | null;
  source_code_url: string;
  issue_tracker_url: string;
  oidc: OidcConfig;
}

/** Where Authentik sends the browser back to. Derived, never configured. */
export function redirectUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

let shared: Observable<AppConfig> | null = null;

/**
 * The single `GET /api/config` request, shared by every consumer.
 *
 * `shareReplay(1)` matters here: the OIDC library's config loader and
 * {@link AppConfigService} both need this during bootstrap, and without it the
 * app would fire two identical requests before it has even rendered.
 */
export function appConfig$(http: HttpClient): Observable<AppConfig> {
  shared ??= http.get<AppConfig>('/api/config').pipe(shareReplay(1));
  return shared;
}

/** Drops the cached request. Only needed so tests start from a clean slate. */
export function resetAppConfigCache(): void {
  shared = null;
}

/**
 * Runtime configuration, resolved before the app boots.
 *
 * An Angular build is static, so container environment variables never reach
 * the browser. The backend serves them instead: one built artifact runs against
 * dev, staging and production, and switching environments is an env var on the
 * API container rather than a rebuild here.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);
  private readonly config = signal<AppConfig | null>(null);

  async load(): Promise<void> {
    this.config.set(await firstValueFrom(appConfig$(this.http)));
  }

  /**
   * Throws if called before {@link load} resolved. Deliberate: every consumer
   * runs after the app initializer, so a null here is a wiring bug worth
   * failing loudly on rather than a state each caller has to handle.
   */
  get(): AppConfig {
    const config = this.config();
    if (!config) {
      throw new Error('AppConfigService.get() called before /api/config was loaded');
    }
    return config;
  }
}
