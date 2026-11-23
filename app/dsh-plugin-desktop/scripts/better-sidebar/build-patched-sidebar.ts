// Canonical implementation lives in app/scripts/better-sidebar/build-patched-sidebar.ts.
// Retained as a thin re-export while legacy dsh-plugin-desktop remains frozen.
export {
  BETTER_SIDEBAR_COMMIT,
  BETTER_SIDEBAR_LOCK_SHA256,
  BETTER_SIDEBAR_PNPM_VERSION,
  BETTER_SIDEBAR_REPOSITORY,
  BETTER_SIDEBAR_VERSION,
  buildPatchedBetterSidebar,
  verifyInstalledBetterSidebar,
  type BuiltBetterSidebar,
} from '../../../scripts/better-sidebar/build-patched-sidebar.ts'
