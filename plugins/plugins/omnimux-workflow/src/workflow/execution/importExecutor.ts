/**
 * Import executor: handles pass-through for imported/static media nodes
 * (key: 'material:import').
 *
 * Structural invariant: This module MUST NOT import GenerationGateway or any
 * seam submission logic. It is architecturally impossible for an import node
 * to trigger model generation or overwrite user media assets.
 */

import { localFileMediaUrl, projectFileMediaUrl, readLocalTextFile } from '../../shared/localMedia.ts';
import { parseJsonDocumentText } from '../../shared/jsonDocument.ts';
import type {
  ExecutionContext,
  NodeExecutor,
  NodeOutput,
} from '../executors/registry';

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readMaterialType(nodeData: Record<string, unknown>): 'text' | 'image' | 'video' | 'audio' | 'document' {
  const value = nodeData.materialType;
  if (value === 'image' || value === 'video' || value === 'audio' || value === 'document') return value;
  return 'text';
}

function readDocumentText(data: Record<string, unknown>): string | undefined {
  if (typeof data.documentText === 'string') return data.documentText;
  const realPath = readString(data, 'realPath');
  if (realPath && /\.json$/i.test(realPath)) return readLocalTextFile(realPath);
  return undefined;
}

/** Document import keeps the raw JSON text plus its parsed prompt; parse errors surface as an explicit input error. */
function documentFields(data: Record<string, unknown>): Pick<NodeOutput, 'text' | 'documentText' | 'documentError'> {
  const documentText = readDocumentText(data);
  if (documentText === undefined) {
    const documentError = readString(data, 'documentError');
    return documentError ? { documentError } : {};
  }
  const parsed = parseJsonDocumentText(documentText);
  return {
    documentText,
    ...(parsed.ok && parsed.prompt !== undefined ? { text: parsed.prompt } : {}),
    ...(!parsed.ok ? { documentError: parsed.error ?? 'JSON 文件无法读取' } : {}),
  };
}

function collectUpstreamText(ctx: ExecutionContext): string | undefined {
  for (const output of ctx.upstreamOutputs.values()) {
    if (output.text && output.text.trim()) {
      return output.text;
    }
  }
  return undefined;
}

export function createImportExecutor(): NodeExecutor {
  return {
    key: 'material:import',
    async execute(node, ctx): Promise<NodeOutput> {
      const data = node.data ?? {};
      const materialType = readMaterialType(data);
      const type = materialType === 'video' ? 'video' : materialType === 'audio' ? 'audio' : materialType === 'document' ? 'document' : 'image';
      const document = materialType === 'document' ? documentFields(data) : {};
      const mimeType = readString(data, 'mimeType') ?? (materialType === 'document' ? 'application/json' : undefined);
      const mediaFields = mimeType ? { mimeType } : {};

      const relativePath = readString(data, 'relativePath');
      const assetId = readString(data, 'assetId');
      if (relativePath && ctx.workspaceId) {
        const url = projectFileMediaUrl(ctx.workspaceId, relativePath);
        return {
          relativePath,
          assetId,
          ...document,
          mediaAssets: [{ type, url, relativePath, assetId, ...mediaFields }],
        };
      }

      const realPath = readString(data, 'realPath');
      if (realPath) {
        return { realPath, ...document, mediaAssets: [{ type, url: localFileMediaUrl(realPath), path: realPath, ...mediaFields }] };
      }

      const nodeMediaUrl = readString(data, 'mediaUrl');
      if (nodeMediaUrl && !nodeMediaUrl.startsWith('blob:')) {
        return { ...document, mediaAssets: [{ type, url: nodeMediaUrl, ...mediaFields }] };
      }

      if (materialType === 'document') return document;

      const text = readString(data, 'content') ?? collectUpstreamText(ctx);
      return { text };
    },
  };
}
