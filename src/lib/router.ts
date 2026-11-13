import { useCallback, useEffect, useState } from 'react';

export const ROUTES = ['dashboard', 'workspace', 'catalog', 'orders', 'activity', 'wholesaler'] as const;

export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = 'dashboard';

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

export function parseHash(hash: string): Route {
  const value = hash.replace(/^#\/?/, '').split(/[?/]/)[0] ?? '';
  return isRoute(value) ? value : DEFAULT_ROUTE;
}

export function hrefFor(route: Route): string {
  return `#${route}`;
}

/** Current view from the URL hash, updated on hashchange. */
export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = hrefFor(next);
  }, []);

  return [route, navigate];
}
