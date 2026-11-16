/**
 * Compact graph snapshot for app execution.
 *
 * The canvas runtime stores large transient blobs on `node.data` (`__catalog`,
 * `compat`, slot reconciliation cache). They are useful while editing but are
 * not part of the publish contract and can push a manifest over the local HTTP
 * request limit. Only stable graph + execution seed fields survive.
 */

const SNAPSHOT_DATA_KEYS = [
  'materialType',
  'selectedTool',
  'outputCapabilityId',
  'capabilityInputs',
  'nodeKind',
  'label',
  'status',
  'content',
  'generatedContent',
  'prompt',
  'params',
  'mediaUrl',
  'previewUrl',
  'thumbnailUrl',
  'relativePath',
  'realPath',
  'assetId',
  'mimeType',
  'sizeBytes',
  'durationSec',
  'coverUrl',
  'documentText',
] as const;

function compactNodeData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const source = data as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  for (const key of SNAPSHOT_DATA_KEYS) {
    if (source[key] !== undefined) compact[key] = source[key];
  }
  return compact;
}

export function compactPublishSnapshotNode(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return {};
  const source = node as Record<string, unknown>;
  return {
    id: source.id,
    type: source.type,
    ...(source.position ? { position: source.position } : {}),
    ...(source.parentId ? { parentId: source.parentId } : {}),
    ...(source.extent ? { extent: source.extent } : {}),
    ...(source.width ? { width: source.width } : {}),
    ...(source.height ? { height: source.height } : {}),
    data: compactNodeData(source.data),
  };
}

export function compactPublishSnapshotNodes(nodes: readonly unknown[] | undefined): Array<Record<string, unknown>> {
  return (nodes ?? []).map(compactPublishSnapshotNode).filter((node) => typeof node.id === 'string');
}

export function compactPublishSnapshotEdges(edges: readonly unknown[] | undefined): Array<Record<string, unknown>> {
  return (edges ?? []).flatMap((edge) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return [];
    const source = edge as Record<string, unknown>;
    if (typeof source.source !== 'string' || typeof source.target !== 'string') return [];
    return [{
      ...(source.id ? { id: source.id } : {}),
      source: source.source,
      target: source.target,
      ...(source.sourceHandle ? { sourceHandle: source.sourceHandle } : {}),
      ...(source.targetHandle ? { targetHandle: source.targetHandle } : {}),
      ...(source.type ? { type: source.type } : {}),
      ...(source.data ? { data: source.data } : {}),
    }];
  });
}

export function compactManifestForExecution<T extends {
  workflowBinding?: { snapshot?: { nodes?: unknown[]; edges?: unknown[] } };
}>(manifest: T): T {
  const snapshot = manifest.workflowBinding?.snapshot;
  if (!snapshot) return manifest;
  return {
    ...manifest,
    workflowBinding: {
      ...manifest.workflowBinding,
      snapshot: {
        nodes: compactPublishSnapshotNodes(snapshot.nodes),
        edges: compactPublishSnapshotEdges(snapshot.edges),
      },
    },
  };
}
