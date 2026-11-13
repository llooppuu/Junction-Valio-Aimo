import { useCallback, useEffect, useState } from "react";

/** The selected tab, kept in the URL hash so a reload or a shared link opens the same view. */
export function useHashTab<T extends string>(tabs: readonly T[], fallback: T): [T, (tab: T) => void] {
  const read = useCallback((): T => {
    const hash = window.location.hash.slice(1) as T;
    return tabs.includes(hash) ? hash : fallback;
  }, [tabs, fallback]);

  const [tab, setTab] = useState<T>(read);

  useEffect(() => {
    const onChange = () => setTab(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, [read]);

  const select = useCallback((next: T) => {
    if (window.location.hash.slice(1) !== next) window.location.hash = next;
    setTab(next);
  }, []);

  return [tab, select];
}
