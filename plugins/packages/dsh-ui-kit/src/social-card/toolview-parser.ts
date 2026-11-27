import { extractHostname, normalizeSocialPlatform, resolveOutlierBadges, resolveSocialCardArchetype } from "./archetype.ts";
import type { OutlierVelocityInput } from "./archetype.ts";
import type { SocialCardPlatform, SocialPostCardItem, SocialPostCardMetrics } from "./types.ts";

export interface SocialToolBlockLike {
  readonly kind?: string | undefined;
  readonly phase?: string | undefined;
  readonly callId?: string | undefined;
  readonly name?: string | undefined;
  readonly argsRaw?: string | undefined;
  readonly isError?: boolean | undefined;
  readonly error?: { readonly code?: string | undefined; readonly message?: string | undefined } | undefined;
  readonly call?: { readonly name?: string | undefined; readonly argsRaw?: string | undefined } | undefined;
  readonly content?: unknown;
  readonly meta?: unknown;
}

export type SocialToolViewPhase = "running" | "ready" | "empty" | "error" | "passthrough";

export interface ParsedSocialToolView {
  phase: SocialToolViewPhase;
  toolName: string;
  platform?: SocialCardPlatform | undefined;
  capability?: string | undefined;
  querySummary?: string | undefined;
  items: SocialPostCardItem[];
  totalCount: number;
  errorMessage?: string | undefined;
  rawOutputText?: string | undefined;
}

const POST_CAPABILITIES = new Set([
  "search",
  "posts",
  "tweet",
  "post",
  "video",
  "creator_search_videos",
]);

const TOOL_PLATFORM_HINTS: Readonly<Record<string, SocialCardPlatform>> = {
  omnimux_x_search: "x",
  omnimux_x_posts: "x",
  omnimux_x_tweet: "x",
  omnimux_tiktok_search: "tiktok",
  omnimux_tiktok_posts: "tiktok",
  omnimux_tiktok_video: "tiktok",
  omnimux_instagram_search: "instagram",
  omnimux_instagram_posts: "instagram",
  omnimux_instagram_post: "instagram",
  omnimux_youtube_search: "youtube",
  omnimux_youtube_posts: "youtube",
  omnimux_youtube_video: "youtube",
};

const LIST_CONTAINERS = [
  "inspirations",
  "items",
  "posts",
  "aweme_list",
  "item_list",
  "timeline",
  "tweets",
  "videos",
  "contents",
  "results",
  "list",
  "edges",
  "data",
] as const;

const WRAPPER_CONTAINERS = ["data", "result", "feed", "payload", "aweme_data"] as const;

const SINGLE_POST_CONTAINERS = [
  "item",
  "post",
  "aweme_detail",
  "aweme_info",
  "tweet",
  "video",
] as const;

const SITE_MEDIA_PREFIXES = [
  "https://omnimux.ai/api/inspiration/v1/media/",
  "https://www.omnimux.ai/api/inspiration/v1/media/",
  "/api/inspiration/v1/media/",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNonEmptyString(values: readonly unknown[]): string {
  for (const val of values) {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed) return trimmed;
    } else if (typeof val === "number" && Number.isFinite(val)) {
      return String(val);
    }
  }
  return "";
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string") {
    const cleaned = value
      .trim()
      .replace(/,/g, "")
      .replace(/\s*(?:views?|plays?|次观看|次播放)\s*$/i, "");
    if (!cleaned) return undefined;
    // Handle compact counts like "1.4M", "32K"
    const compactMatch = /^(\d+(?:\.\d+)?)\s*([kmb])$/i.exec(cleaned);
    if (compactMatch && compactMatch[1] && compactMatch[2]) {
      const base = Number(compactMatch[1]);
      if (!Number.isFinite(base)) return undefined;
      const unit = compactMatch[2].toUpperCase();
      const mult = unit === "B" ? 1_000_000_000 : unit === "M" ? 1_000_000 : 1_000;
      return Math.round(base * mult);
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

/** Validate that an external post link strictly uses `http:` or `https:`. */
export function isSafeHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Validate media/image sources: public `http(s):` or safe same-origin `/omnimux/inspiration/` route. */
export function isSafeMediaSrc(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || trimmed.includes("..")) return false;
    return trimmed.startsWith("/omnimux/inspiration/");
  }
  return isSafeHttpUrl(trimmed);
}

function sanitizeHttpUrl(values: readonly unknown[]): string | undefined {
  for (const val of values) {
    if (isSafeHttpUrl(val)) return String(val).trim();
  }
  return undefined;
}

function sanitizeMediaUrl(values: readonly unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val !== "string") continue;
    let candidate = val.trim();
    if (!candidate) continue;
    for (const prefix of SITE_MEDIA_PREFIXES) {
      if (candidate.startsWith(prefix)) {
        candidate = `/omnimux/inspiration/media/${candidate.slice(prefix.length)}`;
        break;
      }
    }
    if (isSafeMediaSrc(candidate)) return candidate;
  }
  return undefined;
}

/** Format an ISO timestamp or epoch seconds/ms into concise relative labels without middle dots. */
export function formatSocialRelativeTime(
  isoOrEpoch: unknown,
  locale: "zh" | "en" = "zh",
  nowMs: number = Date.now(),
): string | undefined {
  if (isoOrEpoch === null || isoOrEpoch === undefined || isoOrEpoch === "") return undefined;

  let ts: number | null = null;
  if (typeof isoOrEpoch === "number" && Number.isFinite(isoOrEpoch) && isoOrEpoch > 0) {
    ts = isoOrEpoch < 1e11 ? isoOrEpoch * 1000 : isoOrEpoch;
  } else if (typeof isoOrEpoch === "string") {
    const trimmed = isoOrEpoch.trim();
    if (!trimmed) return undefined;
    if (/^\d{9,16}$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0) ts = n < 1e11 ? n * 1000 : n;
    } else {
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        ts = parsed;
      } else {
        // Already human-readable short labels from YouTube (e.g. "3 days ago", "2h")
        if (trimmed.length <= 24) return trimmed;
        return undefined;
      }
    }
  }

  if (ts === null || !Number.isFinite(ts)) return undefined;
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return locale === "en" ? "just now" : "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return locale === "en" ? `${diffMin}m` : `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return locale === "en" ? `${diffHour}h` : `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return locale === "en" ? `${diffDay}d` : `${diffDay}天前`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return locale === "en" ? `${diffMonth}mo` : `${diffMonth}个月前`;
  const diffYear = Math.max(1, Math.floor(diffDay / 365));
  return locale === "en" ? `${diffYear}y` : `${diffYear}年前`;
}

function parseDurationText(raw: unknown): number | undefined {
  const direct = asFiniteNumber(raw);
  if (direct !== undefined) return direct > 0 ? direct : undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return undefined;
  }
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && parts[0] !== undefined && parts[1] !== undefined && parts[2] !== undefined) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

function parseArgsObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function extractQuerySummary(args: Record<string, unknown>, root?: Record<string, unknown> | null): string | undefined {
  const text = firstNonEmptyString([
    args.query,
    args.q,
    args.keyword,
    args.search_word,
    args.screen_name,
    args.username,
    args.unique_id,
    args.channel_id,
    args.handle,
    args.tag,
    args.url,
    args.tweet_id,
    args.video_id,
    args.aweme_id,
    args.media_id,
    args.post_id,
    args.id,
    root?.value,
    root?.query,
  ]);
  return text || undefined;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string" && part.trim()) {
      parts.push(part.trim());
      continue;
    }
    const rec = asRecord(part);
    if (rec && rec.type === "text" && typeof rec.text === "string" && rec.text.trim()) {
      parts.push(rec.text.trim());
    }
  }
  return parts.join("\n").trim();
}

function tryParseJson(raw: string): unknown {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function textFromRuns(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const rec = asRecord(value);
  if (!rec) return "";
  if (typeof rec.simpleText === "string") return rec.simpleText.trim();
  if (typeof rec.text === "string") return rec.text.trim();
  if (Array.isArray(rec.runs)) {
    return rec.runs
      .map((r) => (typeof asRecord(r)?.text === "string" ? String(asRecord(r)?.text) : ""))
      .join("")
      .trim();
  }
  return "";
}

function urlListFirst(value: unknown): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const clean = sanitizeMediaUrl([entry]);
        if (clean) return clean;
      } else {
        const rec = asRecord(entry);
        const clean = sanitizeMediaUrl([rec?.url, rec?.src]);
        if (clean) return clean;
      }
    }
    return undefined;
  }
  const rec = asRecord(value);
  if (rec && Array.isArray(rec.url_list)) {
    return urlListFirst(rec.url_list);
  }
  return sanitizeMediaUrl([rec?.url]);
}

function synthesizedPostUrl(platform: SocialCardPlatform, rawId: string): string | undefined {
  const id = rawId.trim();
  if (!id) return undefined;
  if (platform === "x" && /^\d{5,}$/.test(id)) return `https://x.com/i/status/${id}`;
  if (platform === "tiktok" && /^\d{15,25}$/.test(id)) return `https://www.tiktok.com/video/${id}`;
  if (platform === "youtube" && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  if (platform === "instagram" && /^[A-Za-z0-9_-]{5,}$/.test(id) && !/^\d+$/.test(id)) {
    return `https://www.instagram.com/p/${id}`;
  }
  return undefined;
}

function unwrapRendererEntry(entry: unknown): Record<string, unknown> | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  if (asRecord(rec.node)) return asRecord(rec.node);
  if (asRecord(rec.aweme_info)) return asRecord(rec.aweme_info);
  if (asRecord(rec.videoRenderer)) return asRecord(rec.videoRenderer);
  if (asRecord(rec.compactVideoRenderer)) return asRecord(rec.compactVideoRenderer);
  if (asRecord(rec.gridVideoRenderer)) return asRecord(rec.gridVideoRenderer);
  const richContent = asRecord(asRecord(rec.richItemRenderer)?.content);
  if (richContent && asRecord(richContent.videoRenderer)) {
    return asRecord(richContent.videoRenderer);
  }
  if (asRecord(rec.item) && !rec.id && !rec.aweme_id && !rec.id_str) {
    return asRecord(rec.item);
  }
  return rec;
}

function isPostListContainer(obj: Record<string, unknown>): boolean {
  if (obj.id_str || obj.aweme_id || obj.shortcode || obj.shortCode || obj.videoId) return false;
  return LIST_CONTAINERS.some((k) => Array.isArray(obj[k]));
}

function hasLooksLikePostRow(row: Record<string, unknown>): boolean {
  return Boolean(
    row.id ||
      row.id_str ||
      row.post_id ||
      row.aweme_id ||
      row.tweet_id ||
      row.rest_id ||
      row.shortcode ||
      row.shortCode ||
      row.videoId ||
      row.source_url ||
      row.article ||
      row.caption ||
      row.video ||
      row.mediaDetails ||
      row.image_versions2 ||
      row.text ||
      row.desc ||
      row.full_text ||
      row.title,
  );
}

function extractPostRows(
  payload: unknown,
): { rows: Record<string, unknown>[]; foundListContainer: boolean; containerAccount?: Record<string, unknown> | null } {
  if (Array.isArray(payload)) {
    const rows = payload.map(unwrapRendererEntry).filter((r): r is Record<string, unknown> => Boolean(r));
    return { rows, foundListContainer: true };
  }

  const root = asRecord(payload);
  if (!root) return { rows: [], foundListContainer: false };

  const containerAccount = asRecord(root.account);

  const probeContainer = (obj: Record<string, unknown>): { rows: Record<string, unknown>[]; foundListContainer: boolean } | null => {
    for (const listKey of LIST_CONTAINERS) {
      const candidate = obj[listKey];
      if (Array.isArray(candidate)) {
        const mapped = candidate.map(unwrapRendererEntry).filter((r): r is Record<string, unknown> => Boolean(r));
        if (mapped.length > 0) return { rows: mapped, foundListContainer: true };
        // Keep checking other keys in case another list key is populated; track empty list fallback
      }
      const nestedObj = asRecord(candidate);
      if (nestedObj && Array.isArray(nestedObj.edges)) {
        const mapped = nestedObj.edges.map(unwrapRendererEntry).filter((r): r is Record<string, unknown> => Boolean(r));
        if (mapped.length > 0) return { rows: mapped, foundListContainer: true };
      }
    }
    return null;
  };

  const direct = probeContainer(root);
  if (direct) return { ...direct, containerAccount };

  for (const wrapKey of WRAPPER_CONTAINERS) {
    const wrapped = asRecord(root[wrapKey]);
    if (!wrapped) continue;
    const nested = probeContainer(wrapped);
    if (nested) {
      return { ...nested, containerAccount: asRecord(wrapped.account) ?? containerAccount };
    }
  }

  const hasExplicitEmptyList =
    LIST_CONTAINERS.some((k) => Array.isArray(root[k]) && (root[k] as unknown[]).length === 0) ||
    WRAPPER_CONTAINERS.some((wk) => {
      const w = asRecord(root[wk]);
      return Boolean(w && LIST_CONTAINERS.some((k) => Array.isArray(w[k]) && (w[k] as unknown[]).length === 0));
    });
  if (hasExplicitEmptyList) {
    return { rows: [], foundListContainer: true, containerAccount };
  }

  // Non-post search responses such as instagram-search `{ users, hashtags, places }`
  if (
    (Array.isArray(root.users) || Array.isArray(root.hashtags) || Array.isArray(root.places)) &&
    !hasLooksLikePostRow(root)
  ) {
    return { rows: [], foundListContainer: false, containerAccount };
  }

  // Single post containers or direct single post payload
  for (const singleKey of SINGLE_POST_CONTAINERS) {
    const single = asRecord(root[singleKey]);
    if (single && hasLooksLikePostRow(single)) {
      return { rows: [single], foundListContainer: false, containerAccount };
    }
  }

  if (!isPostListContainer(root) && hasLooksLikePostRow(root)) {
    return { rows: [root], foundListContainer: false, containerAccount };
  }

  return { rows: [], foundListContainer: false, containerAccount };
}

function mapRawRowToSocialItem(
  row: Record<string, unknown>,
  index: number,
  options: {
    platformHint?: SocialCardPlatform | undefined;
    toolName: string;
    locale: "zh" | "en";
    nowMs: number;
    containerAccount?: Record<string, unknown> | null | undefined;
  },
): SocialPostCardItem | null {
  const { platformHint, toolName, locale, nowMs, containerAccount } = options;

  const explicitUrl = sanitizeHttpUrl([
    row.source_url,
    row.url,
    row.share_url,
    row.post_url,
    row.webVideoUrl,
    row.permalink,
    row.link,
    row.expanded_url,
    row.videoId ? `https://www.youtube.com/watch?v=${String(row.videoId)}` : undefined,
  ]);

  const rawPlatformSlug = firstNonEmptyString([
    row.source_platform,
    row.platform,
    containerAccount?.platform,
    platformHint,
  ]);
  const platform = normalizeSocialPlatform(rawPlatformSlug || undefined, explicitUrl);

  const shortcodeCandidate =
    firstNonEmptyString([row.shortcode, row.shortCode]) ||
    (typeof row.code === "string" && row.code.trim().length >= 5 ? row.code.trim() : "");

  const rawId = firstNonEmptyString([
    row.id_str,
    row.id,
    row.post_id,
    row.aweme_id,
    row.tweet_id,
    row.rest_id,
    row.videoId,
    shortcodeCandidate,
    row.pk,
  ]);

  const synthKey = platform === "instagram" && shortcodeCandidate ? shortcodeCandidate : rawId;
  const sourceUrl = explicitUrl || (synthKey ? synthesizedPostUrl(platform, synthKey) : undefined);

  // Extract nested X article / note_tweet
  const articleObj = asRecord(row.article);
  const articleResult = asRecord(asRecord(articleObj?.article_results)?.result) ?? articleObj;
  const noteTweetText = firstNonEmptyString([
    asRecord(asRecord(asRecord(row.note_tweet)?.note_tweet_results)?.result)?.text,
    asRecord(row.note_tweet)?.text,
  ]);

  // Extract Instagram / TikTok / X / YouTube / Inspiration text & titles
  const captionObj = asRecord(row.caption);
  const captionText = firstNonEmptyString([captionObj?.text, typeof row.caption === "string" ? row.caption : ""]);
  const ytTitle = textFromRuns(row.title);
  const rawTitle = firstNonEmptyString([
    articleResult?.title,
    typeof row.title === "string" ? row.title : ytTitle,
  ]);
  const rawExcerpt = firstNonEmptyString([
    articleResult?.preview_text,
    articleResult?.excerpt,
    articleResult?.description,
    row.excerpt,
    row.preview_text,
    row.hook_summary,
  ]);
  const rawBody = decodeBasicEntities(
    firstNonEmptyString([
      noteTweetText,
      articleResult?.plain_text,
      articleResult?.body,
      row.full_text,
      row.content,
      row.desc,
      row.text,
      captionText,
      textFromRuns(row.descriptionSnippet),
      row.description,
    ]),
  );

  const declaredShape = firstNonEmptyString([row.content_shape, row.contentShape]).toLowerCase();
  const isArticle =
    declaredShape === "article" ||
    row.is_article === true ||
    Boolean(articleResult && (articleResult.title || articleResult.preview_text || articleResult.plain_text));

  // Media resolution across platforms
  const videoObj = asRecord(row.video);
  const imagePostImages = Array.isArray(asRecord(row.image_post_info)?.images)
    ? (asRecord(row.image_post_info)?.images as unknown[])
    : [];
  const mediaDetails = Array.isArray(row.mediaDetails) ? row.mediaDetails : [];
  const entitiesMedia = Array.isArray(asRecord(row.entities)?.media) ? (asRecord(row.entities)?.media as unknown[]) : [];
  const extendedMedia = Array.isArray(asRecord(row.extended_entities)?.media)
    ? (asRecord(row.extended_entities)?.media as unknown[])
    : [];
  const mediaContainer = asRecord(row.media);
  const mediaVideoArr = Array.isArray(mediaContainer?.video) ? mediaContainer.video : [];
  const mediaPhotoArr = Array.isArray(mediaContainer?.photo)
    ? mediaContainer.photo
    : Array.isArray(mediaContainer?.photos)
      ? mediaContainer.photos
      : [];
  const carouselMedia = Array.isArray(row.carousel_media) ? row.carousel_media : [];
  const rowImages = Array.isArray(row.images) ? row.images : [];
  const igCandidates = Array.isArray(asRecord(row.image_versions2)?.candidates)
    ? (asRecord(row.image_versions2)?.candidates as unknown[])
    : [];
  const ytThumbnails = Array.isArray(asRecord(row.thumbnail)?.thumbnails)
    ? (asRecord(row.thumbnail)?.thumbnails as unknown[])
    : Array.isArray(row.thumbnails)
      ? (row.thumbnails as unknown[])
      : [];

  const collectedMediaEntries = [
    ...mediaDetails,
    ...extendedMedia,
    ...entitiesMedia,
    ...mediaVideoArr,
    ...mediaPhotoArr,
  ]
    .map((m) => asRecord(m))
    .filter((m): m is Record<string, unknown> => Boolean(m));

  const xCoverCandidate = sanitizeMediaUrl(
    collectedMediaEntries.map((m) => m.media_url_https ?? m.media_url ?? m.preview_image_url ?? m.display_url),
  );
  const igCarouselCover = sanitizeMediaUrl(
    carouselMedia.flatMap((c) => {
      const cr = asRecord(c);
      const cand = Array.isArray(asRecord(cr?.image_versions2)?.candidates)
        ? (asRecord(cr?.image_versions2)?.candidates as unknown[])
        : [];
      return [cr?.display_url, cr?.cover_url, ...cand.map((x) => asRecord(x)?.url)];
    }),
  );
  const igDirectCover = sanitizeMediaUrl([
    row.display_url,
    row.thumbnail_src,
    ...igCandidates.map((x) => asRecord(x)?.url),
  ]);
  const ytLastThumb = ytThumbnails.length > 0 ? asRecord(ytThumbnails[ytThumbnails.length - 1])?.url : undefined;
  const tiktokCover =
    urlListFirst(videoObj?.cover) ??
    urlListFirst(videoObj?.origin_cover) ??
    urlListFirst(videoObj?.dynamic_cover) ??
    sanitizeMediaUrl([videoObj?.poster]) ??
    (imagePostImages.length > 0
      ? urlListFirst(asRecord(imagePostImages[0])?.display_image) ?? urlListFirst(asRecord(imagePostImages[0])?.thumbnail)
      : undefined);

  const flatRowImages = rowImages
    .map((entry) =>
      typeof entry === "string"
        ? sanitizeMediaUrl([entry])
        : sanitizeMediaUrl([asRecord(entry)?.url, asRecord(entry)?.display_url]),
    )
    .filter((u): u is string => Boolean(u));
  const rowMediaUrls = Array.isArray(row.media_urls)
    ? row.media_urls.map((u) => sanitizeMediaUrl([u])).filter((u): u is string => Boolean(u))
    : [];

  const coverUrl =
    sanitizeMediaUrl([
      asRecord(asRecord(articleResult?.cover_media)?.media_info)?.original_img_url,
      asRecord(articleResult?.cover_media)?.original_img_url,
      articleResult?.cover_image_url,
      articleResult?.cover_url,
      row.cover_url,
      row.cover,
      row.thumbnail_url,
      row.thumbnail,
      row.origin_cover,
      row.image_url,
      ytLastThumb,
    ]) ??
    tiktokCover ??
    xCoverCandidate ??
    igCarouselCover ??
    igDirectCover ??
    flatRowImages[0] ??
    rowMediaUrls[0];

  const isVideo =
    String(row.type || "").toLowerCase() === "video" ||
    declaredShape === "video" ||
    row.is_video === true ||
    Boolean(row.video_url) ||
    Boolean(row.video_versions) ||
    Boolean(videoObj && (videoObj.play_addr || videoObj.playAddr || videoObj.download_addr || videoObj.duration)) ||
    mediaVideoArr.length > 0 ||
    collectedMediaEntries.some((m) => m.type === "video" || m.type === "animated_gif") ||
    platform === "tiktok" ||
    platform === "youtube";

  let durationSec = parseDurationText(
    row.duration ?? row.video_duration ?? row.duration_seconds ?? textFromRuns(row.lengthText),
  );
  if (durationSec === undefined && videoObj?.duration != null) {
    const vd = asFiniteNumber(videoObj.duration);
    if (vd !== undefined && vd > 0) {
      durationSec = platform === "tiktok" && vd > 500 ? Math.round(vd / 1000) : Math.round(vd);
    }
  }
  if (durationSec === undefined) {
    for (const m of collectedMediaEntries) {
      const ms = asFiniteNumber(asRecord(m.video_info)?.duration_millis);
      if (ms !== undefined && ms > 0) {
        durationSec = Math.round(ms / 1000);
        break;
      }
    }
  }

  let coverAspectRatio = asFiniteNumber(row.ratio);
  if (coverAspectRatio === undefined && videoObj) {
    const w = asFiniteNumber(videoObj.width);
    const h = asFiniteNumber(videoObj.height);
    if (w && h && w > 0 && h > 0) coverAspectRatio = w / h;
  }
  if (coverAspectRatio === undefined) {
    for (const m of collectedMediaEntries) {
      const info = asRecord(m.original_info);
      const w = asFiniteNumber(info?.width);
      const h = asFiniteNumber(info?.height);
      if (w && h && w > 0 && h > 0) {
        coverAspectRatio = w / h;
        break;
      }
    }
  }

  const explicitMediaCount = asFiniteNumber(row.media_count);
  const mediaCount =
    explicitMediaCount ??
    (carouselMedia.length > 1
      ? carouselMedia.length
      : imagePostImages.length > 1
        ? imagePostImages.length
        : flatRowImages.length > 1
          ? flatRowImages.length
          : collectedMediaEntries.length > 1
            ? collectedMediaEntries.length
            : undefined);

  // Author mapping (X user / core.user_results.result / TikTok author / IG user / YT ownerText / Inspiration author)
  const rawUser =
    asRecord(row.author) ??
    asRecord(asRecord(asRecord(asRecord(row.core)?.user_results)?.result)?.legacy) ??
    asRecord(row.user) ??
    asRecord(row.owner) ??
    containerAccount ??
    {};
  const userResult = asRecord(asRecord(asRecord(row.core)?.user_results)?.result);

  const authorName =
    firstNonEmptyString([
      rawUser.name,
      rawUser.nickname,
      asRecord(userResult?.core)?.name,
      row.author_name,
      row.channel_name,
      textFromRuns(row.ownerText),
      textFromRuns(row.longBylineText),
      textFromRuns(row.shortBylineText),
    ]) || undefined;

  const rawHandle = firstNonEmptyString([
    rawUser.handle,
    rawUser.screen_name,
    rawUser.username,
    rawUser.unique_id,
    asRecord(userResult?.core)?.screen_name,
    row.author_handle,
    row.screen_name,
  ]).replace(/^@+/, "");
  const authorHandle = rawHandle || undefined;

  const ytChannelThumbObj = asRecord(
    asRecord(asRecord(row.channelThumbnailSupportedRenderers)?.channelThumbnailWithLinkRenderer)?.thumbnail,
  );
  const ytChannelThumbs = Array.isArray(ytChannelThumbObj?.thumbnails)
    ? (ytChannelThumbObj.thumbnails as unknown[])
    : [];

  const avatarUrl = sanitizeMediaUrl([
    rawUser.avatar_url,
    rawUser.avatarUrl,
    rawUser.avatar,
    rawUser.profile_image_url_https,
    rawUser.profile_pic_url,
    asRecord(userResult?.avatar)?.image_url,
    urlListFirst(rawUser.avatar_thumb),
    urlListFirst(rawUser.avatar_larger),
    row.avatar_url,
    containerAccount?.avatar_url,
    containerAccount?.avatar_http_url,
    asRecord(ytChannelThumbs[0])?.url,
  ]);

  const author =
    authorName || authorHandle || avatarUrl
      ? { name: authorName, handle: authorHandle, avatarUrl }
      : undefined;

  // Metrics mapping (no fabrication)
  const stats = asRecord(row.stats) ?? asRecord(row.statistics) ?? asRecord(row.engagement) ?? row;
  const metrics: SocialPostCardMetrics = {
    likes: asFiniteNumber(stats.likes ?? stats.like_count ?? stats.favorite_count ?? stats.digg_count),
    reposts: asFiniteNumber(stats.shares ?? stats.reposts ?? stats.retweet_count ?? stats.repost_count ?? stats.share_count),
    views: asFiniteNumber(
      stats.views ??
        stats.view_count ??
        stats.play_count ??
        stats.video_view_count ??
        textFromRuns(row.viewCountText),
    ),
    comments: asFiniteNumber(stats.comments ?? stats.comment_count ?? stats.reply_count),
  };
  const hasAnyMetric = Object.values(metrics).some((v) => v !== undefined);

  const publishedAtRaw = firstNonEmptyString([
    row.published_at,
    row.posted_at,
    row.create_time,
    row.createTime,
    row.taken_at,
    row.created_at,
    textFromRuns(row.publishedTimeText),
  ]);
  const publishedLabel = formatSocialRelativeTime(publishedAtRaw || row.create_time || row.taken_at, locale, nowMs);

  const velocity = asRecord(row.velocity) as OutlierVelocityInput | null;
  const outlierBadges = resolveOutlierBadges(velocity);

  const hostname = extractHostname(sourceUrl) || undefined;
  const faviconUrl = sanitizeMediaUrl([row.favicon_url]);

  const title = isArticle ? rawTitle || undefined : rawTitle && rawTitle !== rawBody ? rawTitle : undefined;
  const excerpt = rawExcerpt || undefined;
  const body = rawBody || (!isArticle ? rawTitle : "") || undefined;

  if (!title && !body && !excerpt && !coverUrl && !sourceUrl) {
    return null;
  }

  const candidate: SocialPostCardItem = {
    id: rawId || `${toolName}-${index}`,
    platform,
    contentShape: declaredShape || (isArticle ? "article" : undefined),
    mediaType: !coverUrl ? (sourceUrl ? "link" : "text") : isVideo ? "video" : "image",
    isArticle: isArticle || undefined,
    title,
    excerpt,
    body,
    coverUrl,
    coverAlt: title || body || hostname || platform,
    coverAspectRatio,
    mediaCount,
    isVideo,
    durationSec,
    author,
    metrics: hasAnyMetric ? metrics : undefined,
    outlierBadges: outlierBadges.length > 0 ? outlierBadges : undefined,
    publishedAt: publishedAtRaw || undefined,
    publishedLabel,
    sourceUrl,
    faviconUrl,
    hostname,
  };

  return {
    ...candidate,
    archetype: resolveSocialCardArchetype(candidate),
  };
}

/**
 * Pure adapter transforming any chat `tool.call.toolview` block for social/inspiration
 * search, feed, or single-post tools into a render-ready model.
 */
export function parseSocialToolBlock(
  block: unknown,
  toolName: string,
  options: { locale?: "zh" | "en" | undefined; nowMs?: number | undefined } = {},
): ParsedSocialToolView {
  const locale = options.locale === "en" ? "en" : "zh";
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const blk = asRecord(block) as SocialToolBlockLike | null;
  const toolPlatform = TOOL_PLATFORM_HINTS[toolName];

  const settled = Boolean(blk && blk.kind === "tool-result");
  const args = parseArgsObject(settled ? blk?.call?.argsRaw ?? blk?.argsRaw : blk?.argsRaw);
  const initialQuery = extractQuerySummary(args);

  if (!blk || !settled) {
    return {
      phase: "running",
      toolName,
      platform: normalizeArgPlatform(args.platform) ?? toolPlatform,
      capability: typeof args.capability === "string" ? args.capability : undefined,
      querySummary: initialQuery,
      items: [],
      totalCount: 0,
    };
  }

  const rawOutputText = extractContentText(blk.content);

  if (blk.isError) {
    return {
      phase: "error",
      toolName,
      platform: normalizeArgPlatform(args.platform) ?? toolPlatform,
      capability: typeof args.capability === "string" ? args.capability : undefined,
      querySummary: initialQuery,
      items: [],
      totalCount: 0,
      errorMessage:
        rawOutputText ||
        firstNonEmptyString([blk.error?.message, blk.error?.code]) ||
        (locale === "en" ? "Tool execution failed" : "工具调用失败"),
      rawOutputText: rawOutputText || undefined,
    };
  }

  const parsedJson = tryParseJson(rawOutputText);
  if (parsedJson === undefined) {
    return {
      phase: "passthrough",
      toolName,
      platform: normalizeArgPlatform(args.platform) ?? toolPlatform,
      capability: typeof args.capability === "string" ? args.capability : undefined,
      querySummary: initialQuery,
      items: [],
      totalCount: 0,
      rawOutputText: rawOutputText || undefined,
    };
  }

  const root = asRecord(parsedJson);
  const resolvedCapability = firstNonEmptyString([root?.capability, args.capability]) || undefined;
  const resolvedPlatform =
    normalizeArgPlatform(root?.platform ?? args.platform) ?? toolPlatform;
  const querySummary = extractQuerySummary(args, root) ?? initialQuery;

  // `omnimux_social_data` also handles profiles and TikTok Shop entities: passthrough raw JSON.
  if (toolName === "omnimux_social_data" && resolvedCapability && !POST_CAPABILITIES.has(resolvedCapability)) {
    return {
      phase: "passthrough",
      toolName,
      platform: resolvedPlatform,
      capability: resolvedCapability,
      querySummary,
      items: [],
      totalCount: 0,
      rawOutputText: rawOutputText || undefined,
    };
  }

  // Unwrap `{ platform, capability, data }` or `{ code, data }`
  let payload: unknown = parsedJson;
  if (root) {
    const inner = root.data;
    if (Array.isArray(inner) || asRecord(inner)) {
      payload = inner;
      const innerRec = asRecord(inner);
      if (innerRec && (typeof innerRec.code === "number" || innerRec.status != null) && asRecord(innerRec.data)) {
        payload = innerRec.data;
      }
    }
  }

  const payloadRec = asRecord(payload);
  // Hub sentinel `{ text: null }` indicates upstream returned empty result.
  if (
    payloadRec &&
    Object.keys(payloadRec).length > 0 &&
    Object.keys(payloadRec).every((k) => ["text", "code", "message", "msg", "status"].includes(k)) &&
    (payloadRec.text === null || payloadRec.text === "")
  ) {
    return {
      phase: "empty",
      toolName,
      platform: resolvedPlatform,
      capability: resolvedCapability,
      querySummary,
      items: [],
      totalCount: 0,
      rawOutputText: rawOutputText || undefined,
    };
  }

  const { rows, foundListContainer, containerAccount } = extractPostRows(payload);
  const seenIds = new Set<string>();
  const items: SocialPostCardItem[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const mapped = mapRawRowToSocialItem(rows[i]!, i, {
      platformHint: resolvedPlatform,
      toolName,
      locale,
      nowMs,
      containerAccount: containerAccount ?? asRecord(root?.account),
    });
    if (!mapped) continue;
    if (seenIds.has(mapped.id)) continue;
    seenIds.add(mapped.id);
    items.push(mapped);
  }

  if (items.length === 0) {
    return {
      phase: foundListContainer ? "empty" : "passthrough",
      toolName,
      platform: resolvedPlatform,
      capability: resolvedCapability,
      querySummary,
      items: [],
      totalCount: 0,
      rawOutputText: rawOutputText || undefined,
    };
  }

  const distinctPlatforms = new Set(items.map((it) => it.platform).filter(Boolean));
  const summaryPlatform =
    resolvedPlatform ?? (distinctPlatforms.size === 1 ? (Array.from(distinctPlatforms)[0] as SocialCardPlatform) : undefined);

  return {
    phase: "ready",
    toolName,
    platform: summaryPlatform,
    capability: resolvedCapability,
    querySummary,
    items,
    totalCount: items.length,
    rawOutputText: rawOutputText || undefined,
  };
}

function normalizeArgPlatform(raw: unknown): SocialCardPlatform | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const p = normalizeSocialPlatform(raw);
  return p === "web" && raw.trim().toLowerCase() !== "web" ? undefined : p;
}
