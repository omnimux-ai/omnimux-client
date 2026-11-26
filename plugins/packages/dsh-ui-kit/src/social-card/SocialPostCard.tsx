import { forwardRef, useEffect, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import { SocialPlatformMark } from "./PlatformMark.tsx";
import {
  extractHostname,
  formatCompactCount,
  formatDuration,
  normalizeSocialPlatform,
  resolveSocialCardArchetype,
} from "./archetype.ts";
import css from "./SocialPostCard.module.css";
import type {
  SocialCardOutlierBadge,
  SocialPostCardItem,
  SocialPostCardProps,
} from "./types.ts";

const c = (name: keyof typeof css & string): string => cssClass(css[name], name);

function HeartGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

function RepostGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function PlayGlyph({ size = 12 }: { size?: number | undefined }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

function avatarInitials(name: string | undefined, handle: string | undefined): string {
  const source = String(name || handle || "?").replace(/^@/, "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
  }
  return Array.from(source).slice(0, 2).join("").toUpperCase();
}

function Avatar({
  name,
  handle,
  avatarUrl,
  sizeClass,
}: {
  name?: string | undefined;
  handle?: string | undefined;
  avatarUrl?: string | undefined;
  sizeClass: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  return (
    <span className={cx(c("avatar"), sizeClass)} aria-hidden="true">
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          className={c("avatarImg")}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        avatarInitials(name, handle)
      )}
    </span>
  );
}

function AuthorRow({
  item,
  avatarSize = "sm",
  showHandleInline = false,
  className,
}: {
  item: SocialPostCardItem;
  avatarSize?: "sm" | "md" | "lg" | undefined;
  showHandleInline?: boolean | undefined;
  className?: string | undefined;
}) {
  const authorName = String(item.author?.name || item.author?.handle || item.hostname || "").trim();
  const handleText = item.author?.handle ? `@${String(item.author.handle).replace(/^@/, "")}` : "";
  const showHandle = showHandleInline && handleText && handleText.toLowerCase() !== `@${authorName.toLowerCase()}`;
  const timeText = item.publishedLabel || "";

  if (!authorName && !timeText) return null;
  const sizeCls = avatarSize === "lg" ? c("avatarLg") : avatarSize === "md" ? c("avatarMd") : c("avatarSm");

  return (
    <div className={cx(c("authorRow"), className)}>
      <Avatar name={authorName} handle={handleText} avatarUrl={item.author?.avatarUrl} sizeClass={sizeCls} />
      <div className={c("authorMeta")}>
        <div className={c("authorTop")}>
          <span className={c("authorName")}>{authorName || handleText}</span>
          {showHandle ? <span className={c("authorHandle")}>{handleText}</span> : null}
        </div>
        {timeText ? <span className={c("timeLabel")}>{timeText}</span> : null}
      </div>
    </div>
  );
}

function OutlierBadges({ badges }: { badges?: readonly SocialCardOutlierBadge[] | undefined }) {
  if (!badges?.length) return null;
  return (
    <>
      {badges.map((badge, idx) => {
        const toneCls =
          badge.tone === "amber"
            ? c("outlierAmber")
            : badge.tone === "violet"
              ? c("outlierViolet")
              : badge.tone === "green"
                ? c("outlierGreen")
                : c("outlierBlue");
        return (
          <span key={`${badge.label}-${idx}`} className={cx(c("outlierBadge"), toneCls)}>
            {badge.label}
          </span>
        );
      })}
    </>
  );
}

function StatsBar({
  item,
  platform,
  showViews = false,
  hidePlatformMark = false,
}: {
  item: SocialPostCardItem;
  platform: string;
  showViews?: boolean | undefined;
  hidePlatformMark?: boolean | undefined;
}) {
  const likes = formatCompactCount(item.metrics?.likes);
  const reposts = formatCompactCount(item.metrics?.reposts);
  const views = showViews ? formatCompactCount(item.metrics?.views) : undefined;
  const hasStats = Boolean(likes || reposts || views || item.outlierBadges?.length);
  if (!hasStats && hidePlatformMark) return null;

  return (
    <div className={c("statsBar")}>
      <div className={c("statsLeft")}>
        {likes ? (
          <span className={c("statItem")}>
            <HeartGlyph />
            <span>{likes}</span>
          </span>
        ) : null}
        {reposts ? (
          <span className={c("statItem")}>
            <RepostGlyph />
            <span>{reposts}</span>
          </span>
        ) : null}
        {views ? (
          <span className={c("statItem")}>
            <PlayGlyph size={11} />
            <span>{views}</span>
          </span>
        ) : null}
        <OutlierBadges badges={item.outlierBadges} />
      </div>
      {!hidePlatformMark ? <SocialPlatformMark platform={platform} className={c("platformMark")} size={15} /> : null}
    </div>
  );
}

function CoverMedia({
  item,
  platform,
  aspectClass,
  coverNode,
  children,
}: {
  item: SocialPostCardItem;
  platform: string;
  aspectClass: string;
  coverNode?: ReactNode | undefined;
  children?: ReactNode | undefined;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [item.coverUrl]);

  const inlineStyle =
    !item.coverAspectRatio || aspectClass === c("articleCover") || aspectClass === c("landscapeCover") || aspectClass === c("webLinkCover")
      ? undefined
      : { aspectRatio: String(Math.max(0.55, Math.min(1.91, item.coverAspectRatio))) };

  return (
    <div className={cx(c("mediaBox"), aspectClass)} style={inlineStyle}>
      {coverNode != null ? (
        coverNode
      ) : item.coverUrl && !failed ? (
        <img
          src={item.coverUrl}
          alt={item.coverAlt || item.title || ""}
          className={c("mediaImg")}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={c("mediaFallback")}>
          <SocialPlatformMark platform={platform} size={26} />
        </div>
      )}
      {children}
    </div>
  );
}

function ArticleBody({ item, platform, coverNode, hideMedia }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
  hideMedia?: boolean | undefined;
}) {
  const titleText = String(item.title || item.body || "").trim();
  const excerptText = String(item.excerpt || (item.title && item.body && item.body !== item.title ? item.body : "")).trim();

  const hasCover = !hideMedia && Boolean(item.coverUrl || coverNode);

  return (
    <>
      {hasCover ? (
        <CoverMedia item={item} platform={platform} aspectClass={c("articleCover")} coverNode={coverNode} />
      ) : null}
      <div className={c("articleBody")}>
        {titleText ? <h3 className={cx(c("articleTitle"), !hasCover && c("pinnedClearance"))}>{titleText}</h3> : null}
        {excerptText ? <p className={c("articleExcerpt")}>{excerptText}</p> : null}
        <AuthorRow item={item} avatarSize="sm" />
      </div>
      <StatsBar item={item} platform={platform} />
    </>
  );
}

function SocialPostBody({ item, platform, coverNode, hideMedia }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
  hideMedia?: boolean | undefined;
}) {
  const bodyText = String(item.body || item.excerpt || item.title || "").trim();
  const hasMedia = !hideMedia && Boolean(item.coverUrl || coverNode);
  const mediaCount = item.mediaCount && item.mediaCount > 1 ? `1/${item.mediaCount}` : "";

  return (
    <>
      <div className={c("socialWrap")}>
        <AuthorRow item={item} avatarSize="md" showHandleInline className={c("pinnedClearance")} />
        {bodyText ? (
          <p className={cx(c("socialBodyText"), !hasMedia && c("socialBodyTextOnly"))}>{bodyText}</p>
        ) : null}
        {hasMedia ? (
          <CoverMedia item={item} platform={platform} aspectClass={c("socialMediaInset")} coverNode={coverNode}>
            {mediaCount ? <span className={c("galleryPill")}>{mediaCount}</span> : null}
            {item.isVideo ? (
              <span className={c("videoPlayBadge")} aria-hidden="true">
                <PlayGlyph size={13} />
              </span>
            ) : null}
          </CoverMedia>
        ) : null}
      </div>
      <StatsBar item={item} platform={platform} />
    </>
  );
}

function ShortVideoBody({ item, platform, coverNode }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
}) {
  const durationText = formatDuration(item.durationSec);
  const likes = formatCompactCount(item.metrics?.likes);
  const reposts = formatCompactCount(item.metrics?.reposts);
  const handle = item.author?.handle
    ? `@${String(item.author.handle).replace(/^@/, "")}`
    : item.author?.name || "";
  const caption = String(item.body || item.title || "").trim();

  return (
    <>
      <CoverMedia item={item} platform={platform} aspectClass={c("shortVideoStage")} coverNode={coverNode}>
        {durationText ? <span className={cx(c("durationPill"), c("shortVideoDuration"))}>{durationText}</span> : null}
        <div className={c("shortVideoScrim")} aria-hidden="true" />
        {likes || reposts ? (
          <div className={c("shortVideoRightStats")} aria-hidden="true">
            {likes ? (
              <div className={c("shortVideoRightStat")}>
                <HeartGlyph />
                <span>{likes}</span>
              </div>
            ) : null}
            {reposts ? (
              <div className={c("shortVideoRightStat")}>
                <RepostGlyph />
                <span>{reposts}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {handle || caption ? (
          <div className={c("shortVideoBottomCopy")}>
            {handle ? <div className={c("shortVideoHandle")}>{handle}</div> : null}
            {caption ? <p className={c("shortVideoCaption")}>{caption}</p> : null}
          </div>
        ) : null}
      </CoverMedia>
      <div className={c("shortVideoFooter")}>
        <AuthorRow item={item} avatarSize="sm" />
        <SocialPlatformMark platform={platform} variant="circle-badge" className={c("platformCircle")} size={14} />
      </div>
    </>
  );
}

function PhotoFeedBody({ item, platform, coverNode }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
}) {
  const mediaCount = item.mediaCount && item.mediaCount > 1 ? `1/${item.mediaCount}` : "";
  const inlineHandle = String(item.author?.handle || item.author?.name || "").replace(/^@/, "").trim();
  const caption = String(item.body || item.title || "").trim();
  const likes = formatCompactCount(item.metrics?.likes);
  const views = formatCompactCount(item.metrics?.views);

  return (
    <>
      <div className={cx(c("photoFeedHeader"), c("pinnedClearance"))}>
        <AuthorRow item={item} avatarSize="sm" />
      </div>
      <CoverMedia item={item} platform={platform} aspectClass={c("photoFeedMedia")} coverNode={coverNode}>
        {mediaCount ? <span className={c("galleryPill")}>{mediaCount}</span> : null}
        {item.isVideo ? (
          <span className={c("videoPlayBadge")} aria-hidden="true">
            <PlayGlyph size={13} />
          </span>
        ) : null}
      </CoverMedia>
      <div className={c("photoFeedBody")}>
        {likes || views || item.outlierBadges?.length ? (
          <div className={c("statsLeft")}>
            {likes ? (
              <span className={c("statItem")}>
                <HeartGlyph />
                <span>{likes}</span>
              </span>
            ) : null}
            {views ? (
              <span className={c("statItem")}>
                <PlayGlyph size={11} />
                <span>{views}</span>
              </span>
            ) : null}
            <OutlierBadges badges={item.outlierBadges} />
          </div>
        ) : null}
        <div className={c("photoFeedCaptionRow")}>
          <p className={c("photoFeedCaption")}>
            {inlineHandle ? <strong className={c("photoFeedHandle")}>{inlineHandle}</strong> : null}
            {caption}
          </p>
          <SocialPlatformMark platform={platform} className={c("platformMark")} size={15} />
        </div>
      </div>
    </>
  );
}

function LandscapeVideoBody({ item, platform, coverNode }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
}) {
  const durationText = formatDuration(item.durationSec);
  const titleText = String(item.title || item.body || "").trim();
  const channelName = String(item.author?.name || item.author?.handle || "").trim();
  const views = formatCompactCount(item.metrics?.views);
  const timeText = item.publishedLabel || "";

  return (
    <>
      <CoverMedia item={item} platform={platform} aspectClass={c("landscapeCover")} coverNode={coverNode}>
        {durationText ? <span className={cx(c("durationPill"), c("landscapeDuration"))}>{durationText}</span> : null}
      </CoverMedia>
      <div className={c("landscapeFooter")}>
        <Avatar
          name={channelName}
          handle={item.author?.handle}
          avatarUrl={item.author?.avatarUrl}
          sizeClass={c("avatarLg")}
        />
        <div className={c("landscapeCol")}>
          {titleText ? <h3 className={c("landscapeTitle")}>{titleText}</h3> : null}
          {channelName ? <span className={c("timeLabel")}>{channelName}</span> : null}
          <div className={c("landscapeSubrow")}>
            <div className={c("landscapeMetaPair")}>
              {timeText ? <span>{timeText}</span> : null}
              {views ? <span>{views}</span> : null}
              <OutlierBadges badges={item.outlierBadges} />
            </div>
            <SocialPlatformMark platform={platform} className={c("platformMark")} size={15} />
          </div>
        </div>
      </div>
    </>
  );
}

function WebLinkBody({ item, platform, coverNode, hideMedia }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
  hideMedia?: boolean | undefined;
}) {
  const [favFailed, setFavFailed] = useState(false);
  useEffect(() => {
    setFavFailed(false);
  }, [item.faviconUrl]);

  const titleText = String(item.title || item.body || item.hostname || item.sourceUrl || "").trim();
  const hostText = item.hostname || extractHostname(item.sourceUrl) || platform;

  return (
    <>
      {!hideMedia ? (
        <CoverMedia item={item} platform={platform} aspectClass={c("webLinkCover")} coverNode={coverNode} />
      ) : null}
      <div className={c("webLinkBody")}>
        {titleText ? <h3 className={cx(c("webLinkTitle"), hideMedia && c("pinnedClearance"))}>{titleText}</h3> : null}
        <div className={c("webLinkHostRow")}>
          {item.faviconUrl && !favFailed ? (
            <img
              src={item.faviconUrl}
              alt=""
              className={c("faviconImg")}
              loading="lazy"
              onError={() => setFavFailed(true)}
            />
          ) : (
            <SocialPlatformMark platform={platform === "web" ? "web" : platform} size={13} className={c("platformMark")} />
          )}
          <span>{hostText}</span>
        </div>
      </div>
    </>
  );
}

function RawMediaBody({ item, platform, coverNode }: {
  item: SocialPostCardItem;
  platform: string;
  coverNode?: ReactNode | undefined;
}) {
  const durationText = formatDuration(item.durationSec);
  return (
    <CoverMedia item={item} platform={platform} aspectClass={c("rawMediaFrame")} coverNode={coverNode}>
      {durationText ? <span className={cx(c("durationPill"), c("shortVideoDuration"))}>{durationText}</span> : null}
      {item.isVideo ? (
        <span className={c("videoPlayBadge")} aria-hidden="true">
          <PlayGlyph size={13} />
        </span>
      ) : null}
    </CoverMedia>
  );
}

/** Semantic 6-archetype card for social posts, articles, videos, web links, and local media. */
export const SocialPostCard = forwardRef<HTMLElement, SocialPostCardProps>(function SocialPostCard(
  {
    item,
    density = "default",
    selected = false,
    active = false,
    loading = false,
    menuOpen = false,
    hasPinnedTopRight = false,
    pinnedTopRightCount,
    topLeftSlot,
    topRightSlot,
    hoverActions,
    statusOverlay,
    coverNode,
    hideMedia = false,
    dataAttributes,
    className,
    onClick,
    onContextMenu,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const archetype = resolveSocialCardArchetype(item);
  const platform = normalizeSocialPlatform(item.platform, item.sourceUrl);
  const interactive = Boolean(onClick);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !interactive || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.(event as unknown as Parameters<NonNullable<typeof onClick>>[0]);
    }
  };

  const extraData: Record<string, string | number | boolean | undefined> = {};
  if (dataAttributes) {
    for (const [k, v] of Object.entries(dataAttributes)) {
      if (v !== undefined) extraData[k] = v;
    }
  }

  return (
    <article
      {...rest}
      {...extraData}
      ref={ref}
      tabIndex={rest.tabIndex ?? (interactive ? 0 : undefined)}
      data-archetype={archetype}
      data-platform={platform}
      data-density={density}
      data-interactive={interactive ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
      data-menu-open={menuOpen ? "true" : undefined}
      data-pinned-tr={hasPinnedTopRight ? "true" : undefined}
      data-pinned-tr-multi={hasPinnedTopRight && (pinnedTopRightCount ?? 1) > 1 ? "true" : undefined}
      className={cx(c("card"), className)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      {topLeftSlot != null ? (
        <div className={c("topLeft")} onClick={(e: MouseEvent) => e.stopPropagation()}>
          {topLeftSlot}
        </div>
      ) : null}
      {topRightSlot != null ? (
        <div className={c("topRight")} onClick={(e: MouseEvent) => e.stopPropagation()}>
          {topRightSlot}
        </div>
      ) : null}
      {hoverActions != null ? (
        <div className={c("hoverActions")} onClick={(e: MouseEvent) => e.stopPropagation()}>
          {hoverActions}
        </div>
      ) : null}
      {statusOverlay ?? null}

      {archetype === "article" ? (
        <ArticleBody item={item} platform={platform} coverNode={coverNode} hideMedia={hideMedia} />
      ) : archetype === "short-video" ? (
        <ShortVideoBody item={item} platform={platform} coverNode={coverNode} />
      ) : archetype === "photo-feed" ? (
        <PhotoFeedBody item={item} platform={platform} coverNode={coverNode} />
      ) : archetype === "landscape-video" ? (
        <LandscapeVideoBody item={item} platform={platform} coverNode={coverNode} />
      ) : archetype === "web-link" ? (
        <WebLinkBody item={item} platform={platform} coverNode={coverNode} hideMedia={hideMedia} />
      ) : archetype === "raw-media" ? (
        <RawMediaBody item={item} platform={platform} coverNode={coverNode} />
      ) : (
        <SocialPostBody item={item} platform={platform} coverNode={coverNode} hideMedia={hideMedia} />
      )}
    </article>
  );
});
