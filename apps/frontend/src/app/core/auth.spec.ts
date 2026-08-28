import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { firstValueFrom, of } from 'rxjs';

import { oidcConfigLoader } from '../app.config';
import { AppConfig, appConfig$, resetAppConfigCache } from './app-config';
import { authInterceptor } from './auth.interceptor';
import { ProviderStatusService } from './provider-status';

const CONFIG: AppConfig = {
  messages: null,
  imprint_url: null,
  source_code_url: 'https://example.invalid/src',
  issue_tracker_url: 'https://example.invalid/issues',
  oidc: {
    issuer: 'https://auth.moretta.at/application/o/rechnungshof/',
    client_id: 'the-client-id',
  },
};

describe('runtime configuration', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    resetAppConfigCache();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('issues a single /api/config request no matter how many consumers subscribe', async () => {
    // The OIDC config loader and AppConfigService both need this during
    // bootstrap; without sharing, the app would fire duplicate requests before
    // it has rendered anything.
    const first = firstValueFrom(appConfig$(http));
    const second = firstValueFrom(appConfig$(http));

    controller.expectOne('/api/config').flush(CONFIG);

    expect((await first).oidc.client_id).toBe('the-client-id');
    expect((await second).oidc.client_id).toBe('the-client-id');
    // controller.verify() in afterEach fails if a second request was made.
  });

  it('maps the server config onto the OIDC library config', async () => {
    const loader = oidcConfigLoader(http);
    const configPromise = firstValueFrom(loader.loadConfigs());

    controller.expectOne('/api/config').flush(CONFIG);
    const config: any = await configPromise;
    const resolved = Array.isArray(config) ? config[0] : config;

    expect(resolved.authority).toBe(CONFIG.oidc.issuer);
    expect(resolved.clientId).toBe(CONFIG.oidc.client_id);
    // PKCE, not implicit: a browser cannot hold a client secret.
    expect(resolved.responseType).toBe('code');
    // The backend refuses to provision a user from a token with no email claim.
    expect(resolved.scope).toContain('email');
    // Derived from the app's own origin, never configured.
    expect(resolved.redirectUrl).toBe(`${window.location.origin}/auth/callback`);
  });
});

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let providerStatus: ProviderStatusService;
  let authorizeCalls: number;

  beforeEach(() => {
    resetAppConfigCache();
    authorizeCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: OidcSecurityService,
          useValue: {
            getAccessToken: () => of('a-token'),
            authorize: () => {
              authorizeCalls += 1;
            },
          },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    providerStatus = TestBed.inject(ProviderStatusService);
  });

  afterEach(() => controller.verify());

  it('attaches the bearer token to API calls', () => {
    http.get('/api/v1/profile').subscribe();
    const req = controller.expectOne('/api/v1/profile');
    expect(req.request.headers.get('Authorization')).toBe('Bearer a-token');
    req.flush({});
  });

  it('does not send a token to the unauthenticated config endpoint', () => {
    http.get('/api/config').subscribe();
    const req = controller.expectOne('/api/config');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(CONFIG);
  });

  it('treats 503 as a provider outage and does NOT re-authorize', async () => {
    // The whole point of the backend's 401/503 split: a 503 means the token
    // could not be checked, not that it is bad. Re-authorizing here would throw
    // every user out on any Authentik hiccup.
    const failed = new Promise<HttpErrorResponse>((resolve) => {
      http.get('/api/v1/profile').subscribe({ error: resolve });
    });
    controller
      .expectOne('/api/v1/profile')
      .flush('provider down', { status: 503, statusText: 'Service Unavailable' });

    expect((await failed).status).toBe(503);
    expect(providerStatus.isUnavailable()).toBe(true);
    expect(authorizeCalls).toBe(0);
  });

  it('treats 401 as a credential problem and re-authorizes', async () => {
    const failed = new Promise<HttpErrorResponse>((resolve) => {
      http.get('/api/v1/profile').subscribe({ error: resolve });
    });
    controller
      .expectOne('/api/v1/profile')
      .flush('nope', { status: 401, statusText: 'Unauthorized' });

    expect((await failed).status).toBe(401);
    expect(authorizeCalls).toBe(1);
    expect(providerStatus.isUnavailable()).toBe(false);
  });

  it('clears the outage flag once a call succeeds again', async () => {
    providerStatus.reportUnavailable();
    expect(providerStatus.isUnavailable()).toBe(true);

    const done = new Promise((resolve) => http.get('/api/v1/profile').subscribe(resolve));
    controller.expectOne('/api/v1/profile').flush({ id: 1 });
    await done;

    expect(providerStatus.isUnavailable()).toBe(false);
  });
});
