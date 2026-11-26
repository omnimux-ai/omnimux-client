import type { HTMLAttributes, MouseEventHandler, ReactNode } from "react";

export type SocialCardArchetype =
  | "article"
  | "social-post"
  | "short-video"
  | "photo-feed"
  | "landscape-video"
  | "web-link"
  | "raw-media";

export type SocialCardDensity = "default" | "compact";

export type SocialCardPlatform =
  | "x"
  | "tiktok"
  | "instagram"
  | "youtube"
  | "bilibili"
  | "xiaohongshu"
  | "douyin"
  | "threads"
  | "linkedin"
  | "substack"
  | "web";

export type SocialCardOutlierTone = "blue" | "violet" | "amber" | "green";

export interface SocialCardOutlierBadge {
  label: string;
  tone: SocialCardOutlierTone;
}

export interface SocialPostCardAuthor {
  name?: string | undefined;
  handle?: string | undefined;
  avatarUrl?: string | undefined;
}

export interface SocialPostCardMetrics {
  likes?: number | undefined;
  reposts?: number | undefined;
  views?: number | undefined;
  comments?: number | undefined;
}

export interface SocialPostCardItem {
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

export interface SocialPlatformMarkProps {
  platform?: string | undefined;
  variant?: "icon" | "circle-badge" | undefined;
  size?: number | undefined;
  className?: string | undefined;
  title?: string | undefined;
}

export interface SocialPostCardProps
  extends Omit<HTMLAttributes<HTMLElement>, "onClick" | "onContextMenu" | "title"> {
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

export interface MasonryGridProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, info: { index: number; column: number; columnCount: number }) => ReactNode;
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
