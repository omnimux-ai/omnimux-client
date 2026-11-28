import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * Subscribe to the OS/browser `(prefers-reduced-motion: reduce)` media query.
 * Safe in SSR and JSDOM environments lacking `matchMedia`.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(getPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}
