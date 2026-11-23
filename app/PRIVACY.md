# OmniMux Desktop Privacy Policy

[中文](PRIVACY.zh.md)

- **Version:** 2.0
- **Effective and last updated:** November 23, 2026

> The canonical, full-repository privacy policy for OmniMux (covering the desktop shell, product plugins, built-in cloud assets, Official Route, and BYOK endpoints) lives in [`../PRIVACY.md`](../PRIVACY.md) ([简体中文](../docs/PRIVACY.zh-CN.md)).

This page summarizes the privacy boundaries specific to the `app/` desktop shell subtree maintained by the **OmniMux Project** (`https://omnimux.ai`, [`omnimux-ai/omnimux-client`](https://github.com/omnimux-ai/omnimux-client)). OmniMux is an independent open-source project and has no affiliation, partnership, authorization, or endorsement relationship with DeepSeek or Anywhere Labs.

For privacy questions or rights requests, email [hello@omnimux.ai](mailto:hello@omnimux.ai). Do not post installation IDs, logs, credentials, or personal data in public GitHub issues.

## Desktop Shell Data Boundaries

- **Local-first storage:** Profiles, settings, workspaces, sessions, logs, and crash dumps stay on your device by default under `~/.omnimux` (and Electron user data under `OmniMux`), isolated from any existing `~/.dsh` directory.
- **Official version checks:** Packaged macOS and Windows builds check `GET https://dl.omnimux.ai/api/desktop/version-stable.json` (~60 seconds after startup, every 6 hours thereafter, or via **Check for Updates…**). Requests explicitly attach `Accept: application/json`, `X-DSH-Desktop-Installation-Id` (a locally generated random UUID v4 stored under `identity/installation-id` in Electron's `OmniMux` user-data directory), `X-DSH-Desktop-Version`, and `X-DSH-Desktop-Channel` (e.g., `stable`). Version checks require no login and never intentionally send prompts, files, workspace paths, sessions, or API keys.
- **Installer downloads:** Official installers from `https://dl.omnimux.ai` and GitHub Releases do not include `X-DSH-Desktop-Installation-Id`, though hosting/CDN infrastructure receives standard network metadata (IP address, timestamp, requested path).
- **Diagnostic exports:** Diagnostic ZIP archives (`diagnostics-*.zip`) are created locally only when you explicitly select **Export Diagnostics…** (or run `--export-diagnostics`) and are never uploaded automatically. Review archives before sharing.
- **Optional desktop analytics:** Fires only when both `OMNIMUX_ANALYTICS_ENDPOINT` and `OMNIMUX_ANALYTICS_WEBSITE_ID` are set in the launch environment (sending launch events plus, in `dsh-plugin-desktop`, startup-stage diagnostics and hourly/clean-exit session lifecycle events to the configured Umami site); disable with `OMNIMUX_ANALYTICS_DISABLED=1` (or `true`).
- **Optional upstream DSH telemetry:** Upstream session telemetry keeps its default `FEEDBACK_ONLY` mode (nothing uploaded during ordinary use; disable fully with `DSH_TELEMETRY_DISABLED=1`). Upstream desktop product analytics (`product-analytics` and `desktop-product-telemetry`) are turned off at startup.
- **Third-party services & LAN access:** Model providers, plugin registries (`https://dl.omnimux.ai/plugins/dsh-index.json`, the built-in community fallback `https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json`, npm, GitHub, or optional third-party catalogs), and external services process data under their own terms. Browser access is restricted to `127.0.0.1` by default; enable LAN access only temporarily on trusted networks.

For complete details on online services, retention, security, and your rights, see the canonical [OmniMux Privacy Policy](../PRIVACY.md).
