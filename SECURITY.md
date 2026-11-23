# Security Policy

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues or discussions.

Instead, report security issues privately using one of the following channels:

1. **GitHub Security Advisories**: open a private report on [`omnimux-ai/omnimux-client`](https://github.com/omnimux-ai/omnimux-client/security/advisories/new).
2. **Email**: send details to [hello@omnimux.ai](mailto:hello@omnimux.ai) with `[Security]` in the subject line.

Please include:

- A clear description of the vulnerability and its potential impact.
- Affected OmniMux version, platform (macOS / Windows), and plugin or component name.
- Steps to reproduce or a minimal proof of concept.

## Trust Boundaries & Upstream Routing

- **Local-first workspace & credentials:** OmniMux stores profiles, local API keys, sessions, and creative assets locally under `~/.omnimux` and isolates its runtime data from any existing `~/.dsh` directory. Never commit or attach API keys, cookies, tokens, raw diagnostic dumps, or personal data in public issues or pull requests.
- **Third-party plugins & MCP servers:** Installed third-party plugins and MCP connectors execute with your local user permissions; listing in a catalog is not a security audit.
- **Unmodified upstream runtime:** OmniMux runs a pinned, unmodified [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) runtime (`app/deepseek-harness`). Vulnerabilities originating exclusively in upstream DeepSeek Harness should also be reported through the upstream project's security process.

## Response Process

We will acknowledge receipt of your report, investigate and verify the issue, work on a fix, and coordinate responsible disclosure once a patched release is available.
