import { canonicalJson } from '../../shared/validation/compatKernel.ts';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { localFilePathFromUrl } from '../../shared/localMedia.ts';
import { projectRelativePathFromMediaUrl, type ResolveExecutionProjectFile } from './executionMediaSource.ts';

interface ExecutionIntentGraph {
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string }>;
}

/** Compare persisted intent without catalog lookup or opening source files. */
export function executionInputSignatures(input: ExecutionIntentGraph, selected?: ReadonlySet<string>): Record<string, string> {
  const intentData = (data: Record<string, unknown> = {}) => {
    const { executionStatus, executionError, taskId, status, probeStatus, isMissing, fileMissing,
      fileCorrupted, isOffline, ...intent } = data;
    return intent;
  };
  return Object.fromEntries(input.nodes.filter(node => !selected || selected.has(node.id)).map(node => [node.id, createHash('sha256').update(canonicalJson({
    type: node.type, data: intentData(node.data),
    incoming: input.edges.filter(edge => edge.target === node.id).map(edge => ({
      edge,
      source: input.nodes.filter(source => source.id === edge.source).map(source => ({
        id: source.id, type: source.type, data: intentData(source.data),
      })),
    })),
  })).digest('hex')]));
}

/** Restore only this target's previous draft, then check its original full signature. */
export function matchesWithPreviousNodePrompt(graph: ExecutionIntentGraph, nodeId: string, previousPrompt: unknown, savedSignature: string): boolean {
  const nodes = graph.nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, prompt: previousPrompt } } : node);
  return executionInputSignatures({ nodes, edges: graph.edges }, new Set([nodeId]))[nodeId] === savedSignature;
}

function fileDigest(path: string): string | undefined {
  const fd = openSync(path, 'r');
  try {
    if (!fstatSync(fd).isFile()) return;
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let length: number;
    while ((length = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, length));
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

export function lacksPriorProjectDigest(current: Record<string, string>, previous: Record<string, string> | undefined): boolean {
  return Object.keys(current).some(key => key.startsWith('project-file:') && !previous?.[key]);
}

/** Project identities survive a workspace move. A file that disappeared after acceptance can still be collected. */
export function executionSourceIdentities(input: ExecutionIntentGraph, selected?: ReadonlySet<string>,
  project?: { workspaceId: string; resolveProjectFile?: ResolveExecutionProjectFile }): Record<string, Record<string, string>> {
  const digests = new Map<string, string | undefined>();
  const sourceIdentities = (value: unknown, field = '', identities: Record<string, string> = {}): Record<string, string> => {
    if (typeof value === 'string') {
      let relativePath: string | undefined;
      if (project && field === 'relativePath') relativePath = value.trim() || undefined;
      else if (project && (field === 'mediaUrl' || field === 'url')) {
        try { relativePath = projectRelativePathFromMediaUrl(value, project.workspaceId); }
        catch { return identities; } // Foreign project URLs are never local paths.
      }
      const path = relativePath === undefined
        ? localFilePathFromUrl(value) || ((field === 'path' || field === 'url') && isAbsolute(value) ? value : null)
        : null;
      const key = relativePath !== undefined ? 'project-file:' + relativePath : path;
      if (!key) return identities;
      if (!digests.has(key)) {
        let digest: string | undefined;
        try {
          const file = relativePath !== undefined ? project?.resolveProjectFile?.(project.workspaceId, relativePath) : path;
          if (file) digest = fileDigest(file);
        } catch {
          // Source material may be gone by the time an accepted task is collected.
        }
        digests.set(key, digest);
      }
      const digest = digests.get(key);
      // Retain the project identity even when its file is gone, so older ledgers
      // without any original evidence cannot claim a verified draft-only match.
      if (digest || relativePath !== undefined) identities[key] = digest ?? '';
    } else if (Array.isArray(value)) value.forEach(item => sourceIdentities(item, field, identities));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => sourceIdentities(item, key, identities));
    return identities;
  };
  return Object.fromEntries(input.nodes.filter(node => !selected || selected.has(node.id)).map(node => [node.id, sourceIdentities({
    own: node.data,
    sources: input.edges.filter(edge => edge.target === node.id).flatMap(edge => input.nodes.filter(source => source.id === edge.source).map(source => source.data)),
  })]));
}
