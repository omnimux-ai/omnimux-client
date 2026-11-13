# Third-Party Notices and Licenses

This plugin (`omnimux-clip`) incorporates and vendorizes components from open-source projects under permissible licenses.

---

## 1. OpenReel Video

- **Upstream Project**: OpenReel Video (`Augani/openreel-video`)
- **License**: MIT License
- **Copyright**: (c) 2024-2026 Augustus Otu and Contributors
- **License Text**: See [`LICENSE.openreel.txt`](./LICENSE.openreel.txt)
- **Vendorized Location**: `src/client/openreel/`
- **Upstream SHA**: `2566c34e0f8ea22992a85f3ff16e048307b49365`
- **Scope & Modifications**:
  - Vendorized official GUI (`apps/web/src`) plus `@openreel/core` / `@openreel/ui` / `@openreel/agent` / `@openreel/creation-schema`.
  - In-memory router (no `window.location.hash`); theme class scoped to `.openreel-studio-root`.
  - Pruned cloud login / S3 / CapCut as unused entry paths; official EditorInterface remains the Tab body.
  - Host glue: `OpenReelStudioTab` + `betterSidebar.registerTab` (`omnimux-clip:studio`).
