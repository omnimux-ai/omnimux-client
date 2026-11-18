#!/usr/bin/env node
/**
 * Runner registration for the Epic #63 / Issue #62 input-capability suites.
 *
 * The real suites live next to the implementation so `pnpm --filter
 * omnimux-workflow test` collects them automatically. This wrapper keeps the
 * repository-level regression list explicit (see governance-manifest.json).
 */
import '../plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs';
import '../plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/inputCapabilityVideo.integration.test.mjs';
import '../plugins/omnimux-workflow/src/shared/graph/feedSlot/inputCapabilityExecution.test.mjs';
