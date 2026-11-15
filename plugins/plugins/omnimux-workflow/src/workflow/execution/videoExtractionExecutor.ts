/**
 * Video extraction capability executor.
 *
 * A text node / video node can declare `outputCapabilityId: 'video-extraction'`.
 * The executor resolves the source URL from its own capability input or the
 * first upstream text output, re-runs the social video extraction service at
 * app execution time, and emits a real video artifact.
 */

import type { ExtractVideoResult } from '../videoExtraction/schema.ts';
import { extractSocialVideoUrl } from '../../canvas/editor/utils/socialMediaVideoUrl.ts';
import type { NodeExecutor, NodeOutput } from '../executors/registry';
import type { WorkspaceStore } from '../workspace/WorkspaceStore';

export interface VideoExtractionExecutorDeps {
  store: Pick<WorkspaceStore, 'get'>;
  getSeam?: (name: string) => unknown;
  getTool?: (name: string) => unknown;
  fetcher?: typeof fetch;
  /** Test/embedding injection; production lazily loads the video extraction service. */
  extractVideo?: (workspaceId: string, input: { url: string; nodeId: string }) => Promise<ExtractVideoResult>;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveInputUrl(
  data: Record<string, unknown>,
  upstreamOutputs: Map<string, NodeOutput>,
): string | undefined {
  const capabilityInputs = (data.capabilityInputs && typeof data.capabilityInputs === 'object')
    ? data.capabilityInputs as Record<string, unknown>
    : undefined;
  const direct = readString(capabilityInputs, 'url')
    ?? readString(data, 'content')
    ?? readString(data, 'prompt');
  if (direct) return direct;

  for (const output of upstreamOutputs.values()) {
    const text = typeof output.text === 'string' ? output.text.trim() : '';
    if (text) return text;
  }
  return undefined;
}

export function createVideoExtractionExecutor(deps: VideoExtractionExecutorDeps): NodeExecutor {
  return {
    key: 'capability:video-extraction',
    async execute(node, ctx): Promise<NodeOutput> {
      const workspaceId = ctx.workspaceId;
      if (!workspaceId) throw new Error('视频提取缺少工作区上下文');

      const inputUrl = resolveInputUrl(node.data ?? {}, ctx.upstreamOutputs);
      const detected = extractSocialVideoUrl(inputUrl ?? '');
      if (!detected?.url) {
        throw new Error('未检测到有效的社媒视频链接');
      }

      const extractVideo = deps.extractVideo ?? (await import('../videoExtraction/service.ts')).createVideoExtractionService({
        store: deps.store,
        mediaDir: ctx.mediaDir,
        getSeam: deps.getSeam,
        getTool: deps.getTool,
        fetcher: deps.fetcher,
      });
      const result = await extractVideo(workspaceId, { url: detected.url, nodeId: node.id });

      if (ctx.persistGenerated) {
        const persisted = await ctx.persistGenerated({
          nodeId: node.id,
          nodeType: node.type,
          tmpAbs: result.videoPath,
          materialType: 'video',
          modelId: 'video-extraction',
        });
        return {
          mediaAssets: [{
            type: 'video',
            url: persisted.url,
            relativePath: persisted.relativePath,
            assetId: persisted.assetId,
            mimeType: persisted.mimeType ?? undefined,
            sizeBytes: persisted.sizeBytes ?? undefined,
            durationSec: persisted.durationSec ?? result.duration,
          }],
          realPath: result.videoPath,
          relativePath: persisted.relativePath,
          assetId: persisted.assetId,
        };
      }

      const publicUrl = ctx.toPublicUrl?.(result.videoPath) ?? result.mediaUrl;
      return {
        mediaAssets: [{
          type: 'video',
          url: publicUrl,
          path: result.videoPath,
          mimeType: 'video/mp4',
          durationSec: result.duration,
        }],
        realPath: result.videoPath,
      };
    },
  };
}
