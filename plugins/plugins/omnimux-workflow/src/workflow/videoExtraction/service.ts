import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import { extractSocialVideoUrl } from '../../canvas/editor/utils/socialMediaVideoUrl.ts';
import type { WorkspaceStore } from '../workspace/WorkspaceStore.ts';
import type { ExtractVideoRequest, ExtractVideoResult } from './schema.ts';
import { VideoExtractionError } from './errors.ts';
import {
  DEFAULT_MAX_VIDEO_BYTES,
  assertSafeRemoteVideoUrl,
  fetchWithSafeRedirects,
  isAllowedVideoContentType,
  isSafeHttpUrlLexical,
  isTikTokHostname,
  type VideoUrlLookup,
} from './urlGuard.ts';

export interface VideoExtractionServiceDeps {
  store: Pick<WorkspaceStore, 'get'>;
  mediaDir: string;
  getSeam?: (name: string) => unknown;
  getTool?: (name: string) => unknown;
  fetcher?: typeof fetch;
  /** Optional DNS lookup override for deterministic SSRF testing. */
  lookup?: VideoUrlLookup;
  /** Maximum allowed downloaded video size in bytes. */
  maxVideoBytes?: number;
}

const MAX_FALLBACK_JSON_BYTES = 1024 * 1024;

/**
 * 探测 URL 对应扩展名，兜底 .mp4
 */
function detectVideoExt(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).toLowerCase();
    if (['.mp4', '.mov', '.webm', '.m4v'].includes(ext)) {
      return ext;
    }
  } catch {
    // fallback
  }
  return '.mp4';
}

function createByteLimitTransform(maxBytes: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (received > maxBytes) {
        callback(
          new VideoExtractionError(
            'download-too-large',
            `视频文件超出最大允许体积限制（${Math.round(maxBytes / (1024 * 1024))} MB）`,
            413,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new VideoExtractionError('download-too-large', '解析响应体积超出限制', 413);
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new VideoExtractionError('download-too-large', '解析响应体积超出限制', 413);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new VideoExtractionError('download-too-large', '解析响应体积超出限制', 413);
    }
    return text;
  }
  return JSON.stringify(await response.json());
}

/**
 * 下载远程多媒体文件到指定目录（原子重命名防残缺、逐跳校验 SSRF 与体积上限）
 */
async function downloadVideoToDisk(
  url: string,
  destDir: string,
  options: {
    fetcher: typeof fetch;
    lookup?: VideoUrlLookup;
    skipDns: boolean;
    maxVideoBytes: number;
  },
): Promise<string> {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  const { response, finalUrl } = await fetchWithSafeRedirects(url, {
    fetcher: options.fetcher,
    lookup: options.lookup,
    skipDns: options.skipDns,
  });

  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new VideoExtractionError(
      'download-failed',
      `视频文件下载失败：HTTP ${response.status}`,
      502,
    );
  }

  const contentType = response.headers?.get?.('content-type');
  if (!isAllowedVideoContentType(contentType)) {
    await response.body?.cancel?.().catch(() => {});
    throw new VideoExtractionError(
      'unsafe-content-type',
      `拒绝非视频响应类型：${contentType ?? 'unknown'}`,
      415,
    );
  }

  const contentLengthHeader = response.headers?.get?.('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > options.maxVideoBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw new VideoExtractionError(
        'download-too-large',
        `视频文件超出最大允许体积限制（${Math.round(options.maxVideoBytes / (1024 * 1024))} MB）`,
        413,
      );
    }
  }

  const ext = detectVideoExt(finalUrl);
  const filename = `video_${randomUUID().slice(0, 8)}${ext}`;
  const targetPath = join(destDir, filename);
  const tempPath = `${targetPath}.${randomUUID().slice(0, 4)}.tmp`;

  try {
    if (response.body && typeof response.body.getReader === 'function') {
      const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      await pipeline(
        nodeStream,
        createByteLimitTransform(options.maxVideoBytes),
        createWriteStream(tempPath),
      );
    } else if (typeof response.arrayBuffer === 'function') {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > options.maxVideoBytes) {
        throw new VideoExtractionError(
          'download-too-large',
          `视频文件超出最大允许体积限制（${Math.round(options.maxVideoBytes / (1024 * 1024))} MB）`,
          413,
        );
      }
      writeFileSync(tempPath, buffer);
    } else {
      throw new VideoExtractionError('download-failed', '不支持的响应数据流格式', 502);
    }

    renameSync(tempPath, targetPath);
    return filename;
  } catch (err) {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
    if (err instanceof VideoExtractionError) throw err;
    throw new VideoExtractionError(
      'download-failed',
      `视频写入磁盘失败: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
}

/**
 * 创建社媒视频提取服务，适配执行中枢提供的社媒解析接口
 */
export function createVideoExtractionService(deps: VideoExtractionServiceDeps) {
  const fetcher = deps.fetcher ?? globalThis.fetch;
  // In production (`deps.fetcher` omitted), always enforce real DNS resolution.
  // When a unit test injects a mock `fetcher` without `lookup`, lexical/IP/redirect/size
  // guards still run while avoiding live DNS failures for RFC 2606 test domains.
  const skipDns = Boolean(deps.fetcher) && !deps.lookup;
  const maxVideoBytes = deps.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES;

  return async (workspaceId: string, input: Required<ExtractVideoRequest>): Promise<ExtractVideoResult> => {
    // 1. 校验工作区存在性
    deps.store.get(workspaceId);

    const targetUrl = input.url.trim();
    const parsedTarget = await assertSafeRemoteVideoUrl(targetUrl, {
      lookup: deps.lookup,
      skipDns,
    });
    const detected = extractSocialVideoUrl(targetUrl);
    const platform = detected?.platform || 'tiktok';

    let extractedVideoUrl = '';
    let title: string | undefined;
    let coverUrl: string | undefined;
    let duration: number | undefined;

    // 2. 适配执行中枢能力：优先消费官方 omnimux_social_data 工具或 socialData 接缝
    const socialTool = (deps.getTool?.('omnimux_social_data') ?? deps.getSeam?.('socialData')) as {
      execute?: (args: Record<string, unknown>) => Promise<any>;
    } | undefined;

    if (socialTool && typeof socialTool.execute === 'function') {
      try {
        const capability = platform === 'x' ? 'tweet' : platform === 'instagram' ? 'post' : 'video';
        const res = await socialTool.execute({
          platform,
          capability,
          url: targetUrl,
        });

        const data = res?.data;
        if (data && typeof data === 'object') {
          const videoCandidate =
            data.video_url ||
            data.play_url ||
            data.play ||
            data.download_url ||
            data.video ||
            (Array.isArray(data.videos) ? data.videos[0] : '') ||
            data.media?.video?.[0]?.variants?.[0]?.url ||
            data.entities?.media?.[0]?.video_info?.variants?.find((v: any) => v.content_type === 'video/mp4')?.url;

          if (typeof videoCandidate === 'string' && /^https?:\/\//i.test(videoCandidate)) {
            extractedVideoUrl = videoCandidate;
          }

          title = typeof data.title === 'string' ? data.title : typeof data.desc === 'string' ? data.desc : typeof data.text === 'string' ? data.text : undefined;
          coverUrl = typeof data.cover_url === 'string' ? data.cover_url : typeof data.thumbnail_url === 'string' ? data.thumbnail_url : typeof data.origin_cover === 'string' ? data.origin_cover : undefined;
          if (typeof data.duration === 'number') duration = data.duration;
        }
      } catch {
        // 工具调用抛错时（如限流或解析失败），继续尝试备用直连提取
      }
    }

    // 3. 弹性备用降级：仅针对真实 TikTok 域名的公开解析网关兜底
    if (!extractedVideoUrl && isTikTokHostname(parsedTarget.hostname)) {
      try {
        const { response: fallbackResp } = await fetchWithSafeRedirects(
          `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`,
          {
            fetcher,
            lookup: deps.lookup,
            skipDns,
            timeoutMs: 15_000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          },
        );
        if (fallbackResp.ok) {
          const rawText = await readBoundedText(fallbackResp, MAX_FALLBACK_JSON_BYTES);
          const json = JSON.parse(rawText) as any;
          if (json && json.data) {
            const d = json.data;
            const playUrl = d.play || d.wmplay || d.hdplay || (Array.isArray(d.videos) ? d.videos[0] : '');
            if (typeof playUrl === 'string' && /^https?:\/\//i.test(playUrl)) {
              extractedVideoUrl = playUrl;
              title = title || d.title;
              coverUrl = coverUrl || d.cover || d.origin_cover;
              duration = duration || (typeof d.duration === 'number' ? d.duration : undefined);
            }
          }
        }
      } catch {
        // Fallback ignore
      }
    }

    // 4. 若传入链接本身即为直链视频（如 .mp4 / .webm）
    if (!extractedVideoUrl && /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(targetUrl)) {
      extractedVideoUrl = targetUrl;
    }

    // 5. 无法提取出视频直链时阻断
    if (!extractedVideoUrl) {
      throw new VideoExtractionError(
        'no-video-found',
        '未能从此链接提取到有效视频，请检查该社媒链接是否有效且公开可见',
        422,
      );
    }

    // 6. 下载视频至工作区媒体目录（全链路 SSRF、重定向与体积校验）
    const videosDir = join(deps.mediaDir, 'videos');
    const savedFilename = await downloadVideoToDisk(extractedVideoUrl, videosDir, {
      fetcher,
      lookup: deps.lookup,
      skipDns,
      maxVideoBytes,
    });
    const targetVideoPath = join(videosDir, savedFilename);
    const relativeMediaUrl = `${WORKFLOW_ROUTE_PREFIX}/media/videos/${savedFilename}`;
    const safeCoverUrl = isSafeHttpUrlLexical(coverUrl) ? coverUrl.trim() : undefined;

    return {
      videoPath: targetVideoPath,
      mediaUrl: relativeMediaUrl,
      previewUrl: relativeMediaUrl,
      title: title || (detected?.platformName ? `${detected.platformName} 视频` : '提取视频'),
      duration,
      coverUrl: safeCoverUrl,
      platform,
    };
  };
}
