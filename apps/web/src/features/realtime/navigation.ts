/**
 * RealtimeProvider lives outside the router, so toasts cannot call `useNavigate`.
 * A component inside the router registers its `navigate` here; until then we fall back to a hard navigation.
 */
type Navigator = (to: string) => void;

let navigator: Navigator | null = null;

export function registerNavigator(fn: Navigator | null): void {
  navigator = fn;
}

export function navigateTo(to: string): void {
  if (navigator) navigator(to);
  else if (typeof window !== 'undefined') window.location.assign(to);
}

/** True when the current URL already shows the entity `link` points at (same path, same query values). */
export function isViewingLink(link: string): boolean {
  if (typeof window === 'undefined') return false;
  let target: URL;
  try {
    target = new URL(link, window.location.origin);
  } catch {
    return false;
  }
  if (target.pathname.replace(/\/$/, '') !== window.location.pathname.replace(/\/$/, '')) return false;
  const current = new URLSearchParams(window.location.search);
  for (const [key, value] of target.searchParams) {
    if (current.get(key) !== value) return false;
  }
  return true;
}
