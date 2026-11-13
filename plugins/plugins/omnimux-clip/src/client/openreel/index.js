/**
 * Official OpenReel micro-app entry (GUI + engine).
 * Glue code must import this module — vendor sources must not import DSH.
 */
export { default as OpenReelApp } from './web/App.tsx'
export { useProjectStore } from './web/stores/project-store.ts'
export { useEngineStore } from './web/stores/engine-store.ts'
export { useUIStore } from './web/stores/ui-store.ts'
export { applyOpenReelTheme } from './web/stores/theme-store.ts'
export { resetOpenReelRouter } from './web/hooks/use-router.ts'
