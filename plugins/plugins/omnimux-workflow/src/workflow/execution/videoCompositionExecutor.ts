/**
 * Host executor for `video_composition`.
 *
 * The NLE lives in omnimux-clip. This executor only forwards an already
 * exported video to downstream nodes. Missing output → fail fast with a
 * stable needs-clip-export message so the scheduler can surface it.
 */

import type { NodeExecutor, NodeOutput } from '../executors/registry';

export function createVideoCompositionExecutor(): NodeExecutor {
  return {
    key: 'video_composition',
    async execute(node): Promise<NodeOutput> {
      const data = node.data ?? {};
      const videoUrl =
        (typeof data.outputVideoUrl === 'string' && data.outputVideoUrl.trim()) ||
        (typeof data.outputVideoPath === 'string' && data.outputVideoPath.trim()) ||
        '';
      if (!videoUrl) {
        throw new Error('needs-clip-export: 请先在剪辑工坊导出成片');
      }
      const thumbnail =
        (typeof data.thumbnailUrl === 'string' && data.thumbnailUrl.trim()) ||
        (typeof data.outputThumbnailUrl === 'string' && data.outputThumbnailUrl.trim()) ||
        undefined;
      return {
        mediaAssets: [
          {
            type: 'video',
            url: videoUrl,
            thumbnail,
          },
        ],
      };
    },
  };
}
