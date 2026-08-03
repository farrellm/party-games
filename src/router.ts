import { useEffect, useState } from 'react';

/**
 * Hash routing, so GitHub Pages needs no SPA rewrite rules (§7).
 *
 * Only entry points are routed. The session and its transport live above this
 * in App, because a connection must never be dropped by a navigation.
 */
export type Route =
  | { name: 'home' }
  | { name: 'host'; gameId: string }
  | { name: 'join' };

export function readRoute(): Route {
  const hash = globalThis.location.hash.replace(/^#\/?/, '');
  const [head, tail] = hash.split('/');

  if (head === 'host' && tail) return { name: 'host', gameId: tail };
  if (head === 'join') return { name: 'join' };
  return { name: 'home' };
}

export function go(path: string): void {
  globalThis.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const update = () => setRoute(readRoute());
    globalThis.addEventListener('hashchange', update);
    return () => globalThis.removeEventListener('hashchange', update);
  }, []);

  return route;
}

/** ?transport=broadcast swaps in the multi-tab dev transport (§12). */
export function useBroadcastMode(): boolean {
  return new URLSearchParams(globalThis.location.search).get('transport') === 'broadcast';
}

/** Keeps ?transport=broadcast attached across hash navigations. */
export function href(path: string): string {
  return `${globalThis.location.search}#${path}`;
}
