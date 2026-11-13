/**
 * Compatibility shim — the module moved to `src/shared/graph/materialNode.ts`
 * (PR1: graph core shared between the canvas island and the host agent
 * tools). Keep importing from the shared location; this file only preserves
 * existing import paths.
 */
export * from '../../shared/graph/materialNode.ts';
