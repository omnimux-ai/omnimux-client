import type {
  SocialCardArchetype,
  SocialCardOutlierBadge,
  SocialCardPlatform,
  SocialPostCardItem,
} from "./types.ts";

const KNOWN_PLATFORMS = new Set<SocialCardPlatform>([
  "x",
  "tiktok",
  "instagram",
  "youtube",
  "bilibili",
  "xiaohongshu",
  "douyin",
  "threads",
  "linkedin",
  "substack",
  "web",
]);

const VALID_ARCHETYPES = new Set<SocialCardArchetype>([
  "article",
  "social-post",
  "short-video",
  "photo-feed",
  "landscape-video",
  "web-link",
  "raw-media",
]);

/** Extract a clean lowercase hostname (stripping leading `www.`) from an HTTP URL. */
export function extractHostname(url: string | undefined): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/** Normalize raw platform slugs or URL hostnames into canonical platform identifiers. */
export function normalizeSocialPlatform(
  rawPlatform: string | undefined,
  sourceUrl?: string | undefined,
): SocialCardPlatform {
  const slug = String(rawPlatform ?? "").trim().toLowerCase();
  if (slug === "twitter") return "x";
  if (slug === "xhs") return "xiaohongshu";
  if (KNOWN_PLATFORMS.has(slug as SocialCardPlatform)) {
    return slug as SocialCardPlatform;
  }
  const host = extractHostname(sourceUrl);
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
  if (host.includes("bilibili.com") || host === "b23.tv") return "bilibili";
  if (host.includes("xiaohongshu.com") || host === "xhslink.com") return "xiaohongshu";
  if (host.includes("douyin.com")) return "douyin";
  if (host.includes("threads.net") || host.includes("threads.com")) return "threads";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("substack.com")) return "substack";
  return "web";
}

function isVerticalVideoRatio(ratio: number | undefined): boolean {
  return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 && ratio < 0.85;
}

function isYouTubeShortsUrl(url: string | undefined): boolean {
  const raw = String(url ?? "").toLowerCase();
  return raw.includes("youtube.com/shorts/") || raw.includes("/shorts/");
}

function hasArticleStructure(item: SocialPostCardItem, platform: SocialCardPlatform): boolean {
  if (item.contentShape === "article" || item.isArticle === true) return true;
  const title = String(item.title ?? "").trim();
  const excerpt = String(item.excerpt ?? "").trim();
  const body = String(item.body ?? "").trim();
  if (platform === "substack") return title.length > 0;
  if (platform === "x" && title.length > 0 && excerpt.length > 0 && title !== body) {
    return true;
  }
  return false;
}

/**
 * Resolve one of the 6 semantic content archetypes (plus raw-media) from structured metadata.
 * Relies solely on protocol/store fields; never guesses archetypes from arbitrary body text regexes.
 */
export function resolveSocialCardArchetype(item: SocialPostCardItem): SocialCardArchetype {
  if (item.archetype && VALID_ARCHETYPES.has(item.archetype)) {
    return item.archetype;
  }

  const platform = normalizeSocialPlatform(item.platform, item.sourceUrl);
  const hasUrl = Boolean(String(item.sourceUrl ?? "").trim());
  const ratio = item.coverAspectRatio;

  if (!hasUrl && platform === "web" && (item.mediaType === "image" || item.mediaType === "video" || Boolean(item.coverUrl))) {
    return "raw-media";
  }

  if (hasArticleStructure(item, platform)) {
    return "article";
  }

  if (platform === "tiktok" || platform === "douyin") {
    return "short-video";
  }

  if (platform === "youtube") {
    if (isYouTubeShortsUrl(item.sourceUrl) || (item.isVideo !== false && isVerticalVideoRatio(ratio))) {
      return "short-video";
    }
    const hasVideoMeta = Boolean(
      item.coverUrl ||
        (typeof item.durationSec === "number" && item.durationSec > 0) ||
        item.author?.name ||
        (typeof item.metrics?.views === "number" && item.metrics.views >= 0),
    );
    return hasVideoMeta ? "landscape-video" : "web-link";
  }

  if (platform === "bilibili") {
    const hasVideoMeta = Boolean(
      item.coverUrl && ((typeof item.durationSec === "number" && item.durationSec > 0) || item.author?.name),
    );
    return hasVideoMeta ? "landscape-video" : "web-link";
  }

  if (platform === "instagram" || platform === "xiaohongshu") {
    if (item.isVideo === true && (item.mediaCount ?? 1) <= 1 && isVerticalVideoRatio(ratio)) {
      return "short-video";
    }
    return "photo-feed";
  }

  if (platform === "x" || platform === "threads" || platform === "linkedin" || platform === "substack") {
    return "social-post";
  }

  return "web-link";
}

export interface OutlierVelocityInput {
  multiplier?: number | null | undefined;
  topPercent?: number | null | undefined;
  top_percent?: number | null | undefined;
  percentile?: number | null | undefined;
  label?: string | null | undefined;
}

/**
 * Derive outlier badges purely from backend-supplied velocity metrics.
 * Returns an empty array when data is absent so cards never display fabricated numbers.
 */
export function resolveOutlierBadges(
  velocity: OutlierVelocityInput | null | undefined,
): SocialCardOutlierBadge[] {
  if (!velocity || typeof velocity !== "object") return [];
  const badges: SocialCardOutlierBadge[] = [];

  const multiplier = Number(velocity.multiplier);
  if (Number.isFinite(multiplier) && multiplier >= 1.2) {
    const formatted = `${multiplier >= 10 ? multiplier.toFixed(1) : multiplier.toFixed(2).replace(/0$/, "")}\u00d7`;
    badges.push({
      label: formatted,
      tone: multiplier >= 5 ? "amber" : "blue",
    });
  }

  const rawTop = velocity.topPercent ?? velocity.top_percent ?? velocity.percentile;
  if (rawTop != null) {
    const pct = Number(rawTop);
    if (Number.isFinite(pct) && pct > 0 && pct <= 25) {
      badges.push({
        label: `Top ${pct % 1 === 0 ? pct : pct.toFixed(1)}%`,
        tone: "violet",
      });
    }
  }

  return badges;
}

/** Compact metric formatting (e.g. `5.7K`, `1.5M`) paired with `tabular-nums`. */
export function formatCompactCount(raw: number | undefined): string | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  if (raw >= 1_000_000) {
    const v = raw / 1_000_000;
    return `${(v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ""))}M`;
  }
  if (raw >= 1_000) {
    const v = raw / 1_000;
    return `${(v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ""))}K`;
  }
  return String(Math.round(raw));
}

/** Format duration in whole seconds as `m:ss` or `h:mm:ss`. */
export function formatDuration(seconds: number | undefined): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

const ARCHETYPE_WEIGHTS: Readonly<Record<SocialCardArchetype, number>> = {
  "short-video": 1.65,
  "photo-feed": 1.5,
  article: 1.45,
  "landscape-video": 1.15,
  "social-post": 1.1,
  "web-link": 1.0,
  "raw-media": 0.95,
};

/** Heuristic height weight for balanced initial masonry column assignment. */
export function estimateArchetypeWeight(item: SocialPostCardItem): number {
  const archetype = resolveSocialCardArchetype(item);
  let weight = ARCHETYPE_WEIGHTS[archetype];
  if (archetype === "social-post" && !item.coverUrl) {
    const len = String(item.body ?? "").length;
    weight = len > 200 ? 1.15 : 0.78;
  }
  return weight;
}
