export { SocialPostCard } from "./SocialPostCard.tsx";
export { MasonryGrid, computeMasonryColumnCount, distributeMasonryColumns } from "./MasonryGrid.tsx";
export { SocialPlatformMark } from "./PlatformMark.tsx";
export {
  estimateArchetypeWeight,
  extractHostname,
  formatCompactCount,
  formatDuration,
  normalizeSocialPlatform,
  resolveOutlierBadges,
  resolveSocialCardArchetype,
} from "./archetype.ts";
export type { OutlierVelocityInput } from "./archetype.ts";
export type { MasonryEntry } from "./MasonryGrid.tsx";
export type {
  MasonryGridProps,
  SocialCardArchetype,
  SocialCardDensity,
  SocialCardOutlierBadge,
  SocialCardOutlierTone,
  SocialCardPlatform,
  SocialPlatformMarkProps,
  SocialPostCardAuthor,
  SocialPostCardItem,
  SocialPostCardMetrics,
  SocialPostCardProps,
} from "./types.ts";
