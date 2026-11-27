import { HTMLAttributes, MouseEventHandler, ReactNode } from "react";
type SocialCardArchetype = "article" | "social-post" | "short-video" | "photo-feed" | "landscape-video" | "web-link" | "raw-media";
type SocialCardDensity = "default" | "compact";
type SocialCardPlatform = "x" | "tiktok" | "instagram" | "youtube" | "bilibili" | "xiaohongshu" | "douyin" | "threads" | "linkedin" | "substack" | "web";
type SocialCardOutlierTone = "blue" | "violet" | "amber" | "green";
interface SocialCardOutlierBadge {
  label: string;
  tone: SocialCardOutlierTone;
}
interface SocialPostCardAuthor {
  name?: string | undefined;
  handle?: string | undefined;
  avatarUrl?: string | undefined;
}
interface SocialPostCardMetrics {
  likes?: number | undefined;
  reposts?: number | undefined;
  views?: number | undefined;
  comments?: number | undefined;
}
interface SocialPostCardItem {
  id: string;
  platform?: SocialCardPlatform | string | undefined;
  archetype?: SocialCardArchetype | undefined;
  contentShape?: string | undefined;
  mediaType?: "video" | "image" | "text" | "link" | string | undefined;
  isArticle?: boolean | undefined;
  title?: string | undefined;
  excerpt?: string | undefined;
  body?: string | undefined;
  coverUrl?: string | undefined;
  coverAlt?: string | undefined;
  coverAspectRatio?: number | undefined;
  mediaCount?: number | undefined;
  isVideo?: boolean | undefined;
  durationSec?: number | undefined;
  author?: SocialPostCardAuthor | undefined;
  metrics?: SocialPostCardMetrics | undefined;
  outlierBadges?: readonly SocialCardOutlierBadge[] | undefined;
  publishedAt?: string | undefined;
  publishedLabel?: string | undefined;
  sourceUrl?: string | undefined;
  faviconUrl?: string | undefined;
  hostname?: string | undefined;
}
interface SocialPlatformMarkProps {
  platform?: string | undefined;
  variant?: "icon" | "circle-badge" | undefined;
  size?: number | undefined;
  className?: string | undefined;
  title?: string | undefined;
}
interface SocialPostCardProps extends Omit<HTMLAttributes<HTMLElement>, "onClick" | "onContextMenu" | "title"> {
  item: SocialPostCardItem;
  density?: SocialCardDensity | undefined;
  selected?: boolean | undefined;
  active?: boolean | undefined;
  loading?: boolean | undefined;
  menuOpen?: boolean | undefined;
  hasPinnedTopRight?: boolean | undefined;
  pinnedTopRightCount?: number | undefined;
  topLeftSlot?: ReactNode | undefined;
  topRightSlot?: ReactNode | undefined;
  hoverActions?: ReactNode | undefined;
  statusOverlay?: ReactNode | undefined;
  coverNode?: ReactNode | undefined;
  hideMedia?: boolean | undefined;
  dataAttributes?: Readonly<Record<string, string | number | boolean | undefined>> | undefined;
  onClick?: MouseEventHandler<HTMLElement> | undefined;
  onContextMenu?: MouseEventHandler<HTMLElement> | undefined;
}
interface MasonryGridProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, info: {
    index: number;
    column: number;
    columnCount: number;
  }) => ReactNode;
  estimateWeight?: ((item: T, index: number) => number) | undefined;
  minColumnWidth?: number | undefined;
  minColumns?: number | undefined;
  maxColumns?: number | undefined;
  gap?: number | undefined;
  defaultColumns?: number | undefined;
  resetKey?: string | number | undefined;
  className?: string | undefined;
  ariaLabel?: string | undefined;
}
/** Semantic 6-archetype card for social posts, articles, videos, web links, and local media. */
declare const SocialPostCard: import("react").ForwardRefExoticComponent<SocialPostCardProps & import("react").RefAttributes<HTMLElement>>;
interface SaveToInspirationResult {
  ok: boolean;
  alreadySaved?: boolean | undefined;
  error?: string | undefined;
}
interface SocialSearchToolViewProps {
  toolName: string;
  block: unknown;
  locale?: "zh" | "en" | undefined;
  inspect?: (() => void) | undefined;
  initialVisibleCount?: number | undefined;
  canSaveToInspiration?: boolean | undefined;
  onOpenPost?: ((item: SocialPostCardItem) => void) | undefined;
  onSaveToInspiration?: ((item: SocialPostCardItem) => Promise<SaveToInspirationResult>) | undefined;
  className?: string | undefined;
}
/**
 * Shared chat conversation view (`tool.call.toolview`) that renders social search,
 * creator feeds, single posts, and inspiration items as 2-column compact 6-archetype cards.
 */
declare function SocialSearchToolView({ toolName, block, locale, inspect, initialVisibleCount, canSaveToInspiration, onOpenPost, onSaveToInspiration, className }: SocialSearchToolViewProps): import("react").JSX.Element;
interface MasonryEntry<T> {
  item: T;
  index: number;
  column: number;
}
/** Calculate responsive column count from measured container width. */
declare function computeMasonryColumnCount(containerWidth: number, { minColumnWidth, minColumns, maxColumns, gap, defaultColumns }?: {
  minColumnWidth?: number | undefined;
  minColumns?: number | undefined;
  maxColumns?: number | undefined;
  gap?: number | undefined;
  defaultColumns?: number | undefined;
}): number;
/**
 * Distribute items across CSS flex columns while keeping prior assignments stable
 * when paginated batches append to the end of the list.
 */
declare function distributeMasonryColumns<T>(items: readonly T[], getKey: (item: T, index: number) => string, columnCount: number, previousAssignments: ReadonlyMap<string, number> | undefined, estimateWeight?: ((item: T, index: number) => number) | undefined): {
  columns: MasonryEntry<T>[][];
  assignments: Map<string, number>;
};
/**
 * Natural CSS flex-column masonry layout. Avoids pixel height estimation overlap
 * and preserves existing card column placements across pagination appends.
 */
declare function MasonryGrid<T>({ items, getKey, renderItem, estimateWeight, minColumnWidth, minColumns, maxColumns, gap, defaultColumns, resetKey, className, ariaLabel }: MasonryGridProps<T>): import("react").JSX.Element;
/** Source attribution mark for social platforms and generic web links. */
declare function SocialPlatformMark({ platform, variant, size, className, title }: SocialPlatformMarkProps): import("react").JSX.Element;
interface SocialToolBlockLike {
  readonly kind?: string | undefined;
  readonly phase?: string | undefined;
  readonly callId?: string | undefined;
  readonly name?: string | undefined;
  readonly argsRaw?: string | undefined;
  readonly isError?: boolean | undefined;
  readonly error?: {
    readonly name?: string | undefined;
    readonly code?: string | undefined;
    readonly reason?: string | undefined;
    readonly message?: string | undefined;
  } | undefined;
  readonly call?: {
    readonly name?: string | undefined;
    readonly argsRaw?: string | undefined;
  } | undefined;
  readonly content?: unknown;
  readonly meta?: unknown;
}
type SocialToolViewPhase = "running" | "ready" | "empty" | "error" | "passthrough";
interface ParsedSocialToolView {
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
/** Validate that an external post link strictly uses `http:` or `https:`. */
declare function isSafeHttpUrl(value: unknown): boolean;
/** Validate media/image sources: public `http(s):` or safe same-origin `/omnimux/inspiration/(local/)?media/*` route. */
declare function isSafeMediaSrc(value: unknown): boolean;
/** Format an ISO timestamp or epoch seconds/ms into concise relative labels without middle dots. */
declare function formatSocialRelativeTime(isoOrEpoch: unknown, locale?: "zh" | "en", nowMs?: number): string | undefined;
/**
 * Pure adapter transforming any chat `tool.call.toolview` block for social/inspiration
 * search, feed, or single-post tools into a render-ready model.
 */
declare function parseSocialToolBlock(block: unknown, toolName: string, options?: {
  locale?: "zh" | "en" | undefined;
  nowMs?: number | undefined;
}): ParsedSocialToolView;
/** Extract a clean lowercase hostname (stripping leading `www.`) from an HTTP URL. */
declare function extractHostname(url: string | undefined): string;
/** Normalize raw platform slugs or URL hostnames into canonical platform identifiers. */
declare function normalizeSocialPlatform(rawPlatform: string | undefined, sourceUrl?: string | undefined): SocialCardPlatform;
/**
 * Resolve one of the 6 semantic content archetypes (plus raw-media) from structured metadata.
 * Relies solely on protocol/store fields; never guesses archetypes from arbitrary body text regexes.
 */
declare function resolveSocialCardArchetype(item: SocialPostCardItem): SocialCardArchetype;
interface OutlierVelocityInput {
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
declare function resolveOutlierBadges(velocity: OutlierVelocityInput | null | undefined): SocialCardOutlierBadge[];
/** Compact metric formatting (e.g. `5.7K`, `1.5M`) paired with `tabular-nums`. */
declare function formatCompactCount(raw: number | undefined): string | undefined;
/** Format duration in whole seconds as `m:ss` or `h:mm:ss`. */
declare function formatDuration(seconds: number | undefined): string | undefined;
/** Heuristic height weight for balanced initial masonry column assignment. */
declare function estimateArchetypeWeight(item: SocialPostCardItem): number;
export { type MasonryEntry, MasonryGrid, type MasonryGridProps, type OutlierVelocityInput, type ParsedSocialToolView, type SaveToInspirationResult, type SocialCardArchetype, type SocialCardDensity, type SocialCardOutlierBadge, type SocialCardOutlierTone, type SocialCardPlatform, SocialPlatformMark, type SocialPlatformMarkProps, SocialPostCard, type SocialPostCardAuthor, type SocialPostCardItem, type SocialPostCardMetrics, type SocialPostCardProps, SocialSearchToolView, type SocialSearchToolViewProps, type SocialToolBlockLike, type SocialToolViewPhase, computeMasonryColumnCount, distributeMasonryColumns, estimateArchetypeWeight, extractHostname, formatCompactCount, formatDuration, formatSocialRelativeTime, isSafeHttpUrl, isSafeMediaSrc, normalizeSocialPlatform, parseSocialToolBlock, resolveOutlierBadges, resolveSocialCardArchetype };
//# sourceMappingURL=social-card.d.ts.map