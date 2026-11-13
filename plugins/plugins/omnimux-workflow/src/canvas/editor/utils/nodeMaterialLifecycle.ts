/**
 * Universal multimodal node lifecycle evaluator.
 *
 * Defines single-source-of-truth lifecycle states for text, media (image/video/audio),
 * and tabular documents across all canvas nodes.
 */

export type NodeLifecycleState =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'missing'
  | 'corrupted'
  | 'error'
  | 'deprecated';

export interface NodeLifecycleInput {
  type?: string;
  nodeType?: string;
  data?: Record<string, unknown>;
}

export function resolveNodeLifecycle(input: NodeLifecycleInput): NodeLifecycleState {
  const nodeType = input.type || input.nodeType || '';
  const data = input.data || {};

  // 1. Check explicit execution status
  const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  if (status === 'running' || status === 'pending' || status === 'loading') {
    return 'loading';
  }
  if (status === 'failed' || status === 'error') {
    return 'error';
  }
  if (status === 'missing' || data.isOffline === true || data.fileMissing === true || data.probeStatus === 'missing') {
    return 'missing';
  }
  if (status === 'corrupted' || data.fileCorrupted === true || data.probeStatus === 'corrupted') {
    return 'corrupted';
  }
  if (status === 'deprecated') {
    return 'deprecated';
  }

  // 2. Table Node
  if (nodeType === 'table') {
    const rowCount = typeof data.rowCount === 'number' ? data.rowCount : 0;
    const previewRows = Array.isArray(data.previewRows) ? data.previewRows : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rowCount > 0 || previewRows.length > 0 || rows.length > 0) {
      return 'ready';
    }
    return 'empty';
  }

  // 3. Text Node
  const materialType = typeof data.materialType === 'string' ? data.materialType : nodeType;
  if (materialType === 'text' || nodeType === 'text') {
    const content = typeof data.content === 'string' ? data.content : '';
    const generatedContent = typeof data.generatedContent === 'string' ? data.generatedContent : '';
    const wordCount = typeof data.wordCount === 'number' ? data.wordCount : 0;
    if (content.trim().length > 0 || generatedContent.trim().length > 0 || wordCount > 0) {
      return 'ready';
    }
    return 'empty';
  }

  // 4. Video Composition Node
  if (nodeType === 'video_composition') {
    if (typeof data.outputVideoUrl === 'string' && data.outputVideoUrl.trim().length > 0) {
      return 'ready';
    }
    return 'empty';
  }

  // 5. Group Node
  if (nodeType === 'group') {
    return 'ready';
  }

  // 6. Media Nodes (image / video / audio / import_asset)
  if (
    materialType === 'image' ||
    materialType === 'video' ||
    materialType === 'audio' ||
    nodeType === 'image' ||
    nodeType === 'video' ||
    nodeType === 'audio' ||
    nodeType === 'import_asset' ||
    data.nodeKind === 'import'
  ) {
    const previewUrl = typeof data.previewUrl === 'string' ? data.previewUrl : '';
    const mediaUrl = typeof data.mediaUrl === 'string' ? data.mediaUrl : '';
    const url = typeof data.url === 'string' ? data.url : '';
    const path = typeof data.path === 'string' ? data.path : '';
    const realPath = typeof data.realPath === 'string' ? data.realPath : '';
    const relativePath = typeof data.relativePath === 'string' ? data.relativePath : '';

    if (
      previewUrl.trim().length > 0 ||
      mediaUrl.trim().length > 0 ||
      url.trim().length > 0 ||
      path.trim().length > 0 ||
      realPath.trim().length > 0 ||
      (relativePath.trim().length > 0 && data.probeStatus !== 'missing' && data.probeStatus !== 'corrupted')
    ) {
      return 'ready';
    }
    return 'empty';
  }

  return 'empty';
}

export function isNodeReady(input: NodeLifecycleInput): boolean {
  return resolveNodeLifecycle(input) === 'ready';
}

export function isNodeEmpty(input: NodeLifecycleInput): boolean {
  return resolveNodeLifecycle(input) === 'empty';
}
