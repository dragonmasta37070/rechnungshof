const KEY = 'rechnungshof.returnUrl';

/**
 * Remembers where the user was headed before being sent to the login screen.
 *
 * Signing in is a full-page redirect to Authentik and back, so this cannot live
 * in memory. sessionStorage is the right scope: per tab, cleared when the tab
 * closes, and it holds nothing but an in-app path.
 */
export function rememberReturnUrl(url: string): void {
  // Only in-app paths. Storing an absolute URL here would turn a stored value
  // into an open-redirect primitive the moment it is used for navigation.
  if (url.startsWith('/') && !url.startsWith('//')) {
    sessionStorage.setItem(KEY, url);
  }
}

/** Returns and clears the remembered path, defaulting to the app root. */
export function takeReturnUrl(): string {
  const url = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}
