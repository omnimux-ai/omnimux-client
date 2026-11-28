# OmniMux Privacy Policy

[简体中文](docs/PRIVACY.zh-CN.md)

- **Version:** 2.0
- **Effective and last updated:** November 23, 2026

OmniMux is a local-first, open-source AI content commerce desktop workbench. This policy explains what information official OmniMux client distributions and official OmniMux services process, why they process it, who receives it, and what choices you have.

In this policy, "we" means the **OmniMux Project** maintaining and publishing official releases under the [`omnimux-ai`](https://github.com/omnimux-ai) GitHub organization and operating official services under `omnimux.ai` and `dl.omnimux.ai`. OmniMux is an independent open-source project and has no affiliation, partnership, authorization, or endorsement relationship with DeepSeek or Anywhere Labs.

For privacy questions, data inquiries, or rights requests, email [hello@omnimux.ai](mailto:hello@omnimux.ai). Do not post installation IDs, logs, API keys, credentials, or personal data in public GitHub issues.

---

## 1. Scope

This policy applies to:

- Official OmniMux desktop installers and client packages distributed through [`omnimux-ai/omnimux-client`](https://github.com/omnimux-ai/omnimux-client), `https://omnimux.ai`, and `https://dl.omnimux.ai`;
- Official OmniMux update-check, plugin-index, download, and signed-in official-route services operated under `omnimux.ai` and `dl.omnimux.ai`; and
- Privacy requests, support emails, or feedback you voluntarily send to `hello@omnimux.ai`.

This policy does not govern third-party forks, modified builds, third-party distributors, BYOK model providers, third-party plugins, external MCP servers, community market catalogs, or third-party social/e-commerce platforms you connect to. Those services process data under their own terms and privacy policies.

---

## 2. Summary

- **Local-first by default:** Your product library, local creative assets, inspiration collections, workflow canvases, clip timelines, profiles, settings, sessions, logs, and crash files stay on your device under `~/.omnimux` (and OS application data under `OmniMux`). OmniMux does not read or write your existing `~/.dsh` directory.
- **Version checks:** Packaged macOS and Windows builds check `https://dl.omnimux.ai/api/desktop/version-stable.json` for updates and send a locally generated, pseudonymous random installation UUID (`X-DSH-Desktop-Installation-Id`), the installed version (`X-DSH-Desktop-Version`), and the release channel (`X-DSH-Desktop-Channel`). Version checks require no account and do not attach prompts, files, workspace paths, sessions, or API keys.
- **Downloads:** Installer downloads from `https://dl.omnimux.ai` or GitHub Releases do not include the desktop installation UUID, though standard network metadata (such as IP address and request timestamp) is received by hosting/CDN infrastructure.
- **Diagnostic exports:** Diagnostic ZIP archives are generated locally only when you explicitly invoke **Export Diagnostics…** and are never uploaded automatically.
- **External AI & platform services:** Cloud model requests (Official Route or BYOK), built-in cloud asset fetches, browser companion capture, plugin installations, and international social publishing send data only to the services you sign in to, configure, or explicitly invoke.

---

## 3. Official Version Checks and Downloads

### 3.1 When version checks occur

Packaged macOS and Windows builds request the stable release metadata endpoint about 60 seconds after startup and about every 6 hours after each completed check, or when you manually select **Check for Updates…**:

```text
GET https://dl.omnimux.ai/api/desktop/version-stable.json
```

Development runs, unpackaged launches, and Linux builds do not run this packaged automatic-update check.

### 3.2 What the request contains

The client explicitly sets:

- `Accept: application/json`
- `X-DSH-Desktop-Installation-Id: <random UUID v4>`
- `X-DSH-Desktop-Version: <canonical installed stable version>`
- `X-DSH-Desktop-Channel: <release channel, e.g. stable>`

No query parameters or request body are added. As with any HTTPS request, the distribution CDN and network infrastructure also receive standard connection metadata (IP address, request time, TLS metadata, and standard request headers). The version checker does not intentionally send prompts, model responses, file contents, workspace paths, profile names, session history, credentials, MAC addresses, or hardware serial numbers.

### 3.3 Installation UUID lifecycle

The installation UUID:

- Is generated locally as a cryptographically random UUID v4 when no valid persistent value exists in Electron's user-data directory;
- Is stored in `identity/installation-id` under the application user-data directory:
  - macOS: `~/Library/Application Support/OmniMux/identity/installation-id`
  - Windows: `%APPDATA%\OmniMux\identity\installation-id`
- Does not encode a username, hostname, MAC address, disk serial number, or hardware identifier;
- Identifies one application user-data directory rather than a physical machine; and
- Persists until removed or corrupted. Deleting the file causes a fresh UUID to be generated on the next launch and does not disable future update checks.

Version-check data is used solely to serve update notices, produce deduplicated aggregate version/update reliability metrics, protect service availability, and comply with legal obligations. We do not sell this identifier or use it for cross-service advertising profiles.

### 3.4 Installer downloads and website visits

When you download installers from `https://dl.omnimux.ai` or visit `https://omnimux.ai`, hosting and CDN providers receive ordinary network metadata (IP address, request time, requested path, and standard browser/client headers) to deliver files, prevent abuse, and maintain reliability. Installer download requests do not attach `X-DSH-Desktop-Installation-Id`.

---

## 4. Local Data, Logs, and Diagnostic Exports

- **Local workspace and state:** By default, OmniMux stores runtime profiles, credentials, sessions, products, assets, workflows, and clip projects locally under `~/.omnimux` and window/desktop state under the OS `OmniMux` user-data directory.
- **Logs and crash dumps:** Local application logs and Crashpad `.dmp` files remain on your machine and are not uploaded automatically.
- **Manual diagnostic export:** When you choose **Export Diagnostics…** (or run `--export-diagnostics`), OmniMux creates a local `diagnostics-*.zip` containing recent logs, Crashpad dumps, active-run metadata, and `system-info.txt`. Recognized credentials are masked in logs, but local paths, workspace/session IDs, and crash-time memory fragments may still appear. Always review an archive before sharing it and never attach raw dumps to public issues.

---

## 5. Online Services, AI Models, and Optional Features

### 5.1 OmniMux Official Route and built-in cloud assets

- **Official Route:** If you sign in to an OmniMux account and use the Official Route, the Execution Hub sends your account authentication token, selected model/channel parameters, and the prompts, media inputs, or tool payloads required for that generation request to the OmniMux gateway and upstream model providers fulfilling the request.
- **Built-in cloud assets:** Browsing, auditioning, or saving assets from the built-in cloud asset library sends catalog queries and media download requests to the configured cloud asset delivery endpoints. Downloaded assets are saved into your local workspace.

### 5.2 BYOK model endpoints and external providers

If you configure your own API keys or custom endpoints (BYOK), model credentials are stored locally and requests go directly to the endpoints you configure under those providers' own terms and privacy policies.

Upstream DeepSeek Harness also maintains a separate `.anonymous-user-id` in its data directory. When you invoke the upstream default DeepSeek adapter, it may send that identifier in the `x-deepseek-harness-user-id` header to your configured DeepSeek or compatible `baseURL`. It is separate from `X-DSH-Desktop-Installation-Id`.

### 5.3 Browser companion, capture, MCP connectors, and social publishing

- **Browser companion & inspiration import:** Capturing product pages, reference posts, or media runs through your local host and Chrome extension only when you initiate a capture or import.
- **MCP connectors & international social publishing:** External MCP servers and international social platform integrations (such as TikTok, Instagram, Facebook, or YouTube) are contacted only when you explicitly authorize accounts or run actions targeting them, and are governed by those platforms' own policies.

### 5.4 Plugin market and package services

- Opening the plugin market or checking updates may fetch the official plugin catalog index (`https://dl.omnimux.ai/plugins/dsh-index.json`), the built-in community fallback index (`https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json`), and any additional catalog sources you explicitly add or select.
- Previewing or installing plugins after your explicit confirmation may contact `registry.npmjs.org`, GitHub, or your configured package registry to retrieve package manifests and tarballs.
- Installed third-party plugins execute locally with your user permissions; catalog listing is not a privacy or security audit.

### 5.5 Optional desktop analytics and upstream telemetry

- **Optional OmniMux desktop analytics:** Only when both `OMNIMUX_ANALYTICS_ENDPOINT` and `OMNIMUX_ANALYTICS_WEBSITE_ID` are configured in the launch environment, OmniMux Desktop sends launch events (`desktop_app_launch`: first-launch flag, app version, OS, and OS version) to the configured Umami site using a local pseudonymous installation UUID. Set `OMNIMUX_ANALYTICS_DISABLED=1` (or `true`) to disable these events.
- **Optional upstream DSH telemetry:** Upstream DeepSeek Harness session telemetry keeps its default `FEEDBACK_ONLY` mode — ordinary usage uploads no session content; a session log is sent to the configured upstream telemetry endpoint only if you explicitly submit session feedback. Set `DSH_TELEMETRY_DISABLED=1` to disable it completely. Upstream desktop product analytics (`product-analytics` and `desktop-product-telemetry`) are turned off at startup.

---

## 6. Browser and LAN Access

Opening OmniMux in a local browser accesses your local Host over `127.0.0.1` by default and does not upload session contents to OmniMux servers. If you explicitly enable LAN access (available only in compatibility mode), devices on your local network can reach the local Host and execute tools with your local permissions; LAN HTTP is not end-to-end encrypted. Enable LAN access only temporarily on a fully trusted network and turn it off afterwards.

---

## 7. Sharing, Retention, Security, and Your Rights

- **No sale of personal data:** We do not sell personal data or provide installation identifiers to third parties for advertising profiles.
- **Service providers and cross-border routing:** Infrastructure, CDN, hosting, and model providers (such as Cloudflare, GitHub, npm, or third-party AI providers you choose) may process data in different jurisdictions according to routing and your configuration.
- **Retention:** Local files remain under your control on your device. Server-side request logs (including IP addresses and update-check metadata) are retained only for the shortest period reasonably necessary to deliver updates, protect service security, prevent abuse, and diagnose failures, after which they are deleted or irreversibly aggregated unless law requires otherwise.
- **Security:** Official endpoints use HTTPS, local installation-ID storage uses restricted file permissions (`0700`/`0600` on POSIX), and diagnostic exports require explicit confirmation. No security measure is absolute; third-party plugins, shared diagnostic archives, and unauthenticated LAN access can cross local boundaries.
- **Your choices and rights:** Depending on applicable law, you may request access, correction, deletion, or restriction of personal data held by official OmniMux services by contacting [hello@omnimux.ai](mailto:hello@omnimux.ai). We cannot remotely delete files stored on your device; you may remove `~/.omnimux` or the OS `OmniMux` user-data directory locally while the application is closed.
- **Children:** OmniMux is designed for adult creators, commerce operators, and developers, and is not directed to children. Minors should use it only under a guardian's supervision.
- **Changes to this policy:** Material changes to data categories, purposes, official endpoints, or user choices will be published in this repository with an updated effective date.

Both the English and Simplified Chinese versions of this policy carry equal authority. If any discrepancy is found, please notify [hello@omnimux.ai](mailto:hello@omnimux.ai).
