# Third-Party Notices and Licenses

This plugin (`omnimux-clip`) incorporates and vendorizes components from open-source projects under permissible licenses.

---

## 1. OpenReel Video

- **Upstream Project**: OpenReel Video (`Augani/openreel-video`)
- **License**: MIT License
- **Copyright**: (c) 2024-2026 Augustus Otu and Contributors
- **License Text**: See [`LICENSE.openreel.txt`](./LICENSE.openreel.txt)
- **Vendorized Location**: `src/client/openreel/`
- **Upstream version and SHA**: [`v1.0.0`](https://github.com/Augani/openreel-video/tree/v1.0.0), `c8f33f212c8d39ff9cfabb3302a44423d8dad83d`
- **Scope and modifications**:
  - The web editor plus `@openreel/core`, `@openreel/ui`, `@openreel/agent` and `@openreel/creation-schema`.
  - In-memory editor routes, isolated styles and overlays, and host locale integration.
  - Canvas import and silent video export, positioned MP4 writes, and explicit approval for custom motion expressions.

## 2. Bundled editor assets

The editor icon, built-in template thumbnails and effect preview sample come from the pinned OpenReel distribution. The following assets retain their upstream licenses and notices.

- JetBrains Mono, SIL Open Font License 1.1. [License](src/client/openreel/assets/fonts/jetbrains-mono-OFL.txt)
- Inter, copyright 2016 The Inter Project Authors, SIL Open Font License 1.1. [License](src/client/openreel/assets/fonts/inter-OFL.txt)
- Twemoji artwork, copyright 2020 Twitter, Inc. and other contributors, used for editable emoji stickers. The SVG bytes are unchanged and embedded in the editor bundle. [Artwork notice](src/client/openreel/assets/emoji/LICENSE.txt) · [Source](https://github.com/jdecked/twemoji) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
