#!/usr/bin/env node
/**
 * Runner registration for the Issue #68 replicate-CTA suites.
 *
 * The real suites live next to the implementation so `pnpm --filter
 * omnimux-inspiration test` collects them automatically. This wrapper keeps the
 * repository-level regression list explicit (see governance-manifest.json).
 */
import '../plugins/omnimux-inspiration/src/client/new-session-click.test.js';
import '../plugins/omnimux-inspiration/src/client/attach-to-current-session.test.js';
import '../plugins/omnimux-inspiration/src/client/replicate-to-chat.test.js';
import '../plugins/omnimux-inspiration/src/client/replicate-cta-toast.test.js';
