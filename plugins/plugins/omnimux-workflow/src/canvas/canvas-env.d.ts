/** Ambient declarations for the canvas island build (esbuild text loader). */

declare module '*.css' {
  const content: string;
  export default content;
}

/** Hub-injected quota gate seam (window.__omnimuxQuota, hub-owned). */
interface Window {
  __omnimuxQuota?: {
    notify?: (
      payload: { message: string; code?: string },
      context?: { capability?: string; correlationId?: string },
    ) => void;
    ensureQuota?: (context: {
      capability?: string;
      correlationId?: string;
    }) => Promise<{ ok?: boolean } | undefined> | { ok?: boolean } | undefined;
  };
}
