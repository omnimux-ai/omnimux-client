#!/usr/bin/env node
/**
 * Runner registration for the #50 video-parameter normalization suite.
 *
 * The real suite lives next to the implementation so `pnpm --filter
 * omnimux-workflow test` collects it automatically. This wrapper keeps the
 * repository-level regression list explicit (see governance-manifest.json).
 */
import '../plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamNormalization.test.mjs';
