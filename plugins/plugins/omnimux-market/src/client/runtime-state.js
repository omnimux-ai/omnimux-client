/**
 * Shared mutable runtime references injected by apply(ctx) and read across
 * omnimux-market client modules. Keeping these bindings on one plain state
 * object preserves live cross-module updates under standard ES modules and
 * breaks the legacy session-create <-> tool-views cycle.
 */
export const marketRuntime = {
  /** Module-level keep-alive flag; refreshed from config on plaza open. Default true. */
  plazaKeepAlive: true,
  plazaSessions: null,
  plazaUiWorkspace: null,
  plazaRemote: null,
  plazaWorkspaces: null,
};
