import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import { IconSwap } from "../motion/IconSwap.tsx";
import { MasonryGrid } from "./MasonryGrid.tsx";
import { SocialPlatformMark } from "./PlatformMark.tsx";
import { SocialPostCard } from "./SocialPostCard.tsx";
import css from "./SocialSearchToolView.module.css";
import { estimateArchetypeWeight } from "./archetype.ts";
import { isSafeHttpUrl, parseSocialToolBlock } from "./toolview-parser.ts";
import type { ParsedSocialToolView } from "./toolview-parser.ts";
import type { SocialCardPlatform, SocialPostCardItem } from "./types.ts";

const c = (name: keyof typeof css & string): string => cssClass(css[name], name);

type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface SaveToInspirationResult {
  ok: boolean;
  alreadySaved?: boolean | undefined;
  error?: string | undefined;
}

export interface SocialSearchToolViewProps {
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

const PLATFORM_NAMES: Readonly<Record<SocialCardPlatform, { zh: string; en: string }>> = {
  x: { zh: "X", en: "X" },
  tiktok: { zh: "TikTok", en: "TikTok" },
  instagram: { zh: "Instagram", en: "Instagram" },
  youtube: { zh: "YouTube", en: "YouTube" },
  bilibili: { zh: "B站", en: "Bilibili" },
  xiaohongshu: { zh: "小红书", en: "Xiaohongshu" },
  douyin: { zh: "抖音", en: "Douyin" },
  threads: { zh: "Threads", en: "Threads" },
  linkedin: { zh: "LinkedIn", en: "LinkedIn" },
  substack: { zh: "Substack", en: "Substack" },
  web: { zh: "网页", en: "Web" },
};

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ExternalLinkGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function BookmarkGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function InspectGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function resolveActionTitle(parsed: ParsedSocialToolView, locale: "zh" | "en"): string {
  const { phase, toolName, platform } = parsed;
  const plat = platform && PLATFORM_NAMES[platform] ? PLATFORM_NAMES[platform][locale] : undefined;

  if (phase === "error") {
    return locale === "en" ? "Post fetch failed" : "获取帖子失败";
  }

  const running = phase === "running";
  if (phase === "passthrough") {
    return locale === "en" ? "Social data output" : "社媒数据输出";
  }

  if (toolName.includes("_inspiration_") || toolName === "inspiration_search" || toolName === "inspiration_get") {
    if (toolName.endsWith("_get")) {
      return running
        ? locale === "en" ? "Fetching inspiration" : "正在读取灵感详情"
        : locale === "en" ? "Fetched inspiration" : "已读取灵感详情";
    }
    return running
      ? locale === "en" ? "Searching inspirations" : "正在检索灵感库"
      : locale === "en" ? "Searched inspirations" : "已检索灵感库";
  }

  if (toolName.startsWith("inspiration_rival_")) {
    return running
      ? locale === "en" ? "Fetching rival posts" : "正在读取对标作品"
      : locale === "en" ? "Fetched rival posts" : "已读取对标作品";
  }

  if (toolName.endsWith("_search")) {
    return running
      ? locale === "en" ? `Searching ${plat ?? "social"} posts` : `正在搜索${plat ? ` ${plat} ` : "社媒"}帖子`
      : locale === "en" ? `Searched ${plat ?? "social"} posts` : `已搜索${plat ? ` ${plat} ` : "社媒"}帖子`;
  }

  if (toolName.endsWith("_posts")) {
    return running
      ? locale === "en" ? `Fetching ${plat ?? "creator"} posts` : `正在获取${plat ? ` ${plat} ` : "创作者"}作品`
      : locale === "en" ? `Fetched ${plat ?? "creator"} posts` : `已获取${plat ? ` ${plat} ` : "创作者"}作品`;
  }

  if (toolName.endsWith("_tweet") || toolName.endsWith("_video") || toolName.endsWith("_post")) {
    return running
      ? locale === "en" ? `Fetching ${plat ?? "social"} post` : `正在获取${plat ? ` ${plat} ` : "社媒"}帖子`
      : locale === "en" ? `Fetched ${plat ?? "social"} post` : `已获取${plat ? ` ${plat} ` : "社媒"}帖子`;
  }

  return running
    ? locale === "en" ? "Querying social posts" : "正在查询社媒帖子"
    : locale === "en" ? "Fetched social posts" : "已获取社媒帖子";
}

function defaultOpenExternal(url: string | undefined): void {
  if (!isSafeHttpUrl(url)) return;
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(String(url).trim(), "_blank", "noopener,noreferrer");
  }
}

/**
 * Shared chat conversation view (`tool.call.toolview`) that renders social search,
 * creator feeds, single posts, and inspiration items as 2-column compact 6-archetype cards.
 */
export function SocialSearchToolView({
  toolName,
  block,
  locale = "zh",
  inspect,
  initialVisibleCount = 6,
  canSaveToInspiration = false,
  onOpenPost,
  onSaveToInspiration,
  className,
}: SocialSearchToolViewProps) {
  const lang = locale === "en" ? "en" : "zh";
  const parsed = useMemo(() => parseSocialToolBlock(block, toolName, { locale: lang }), [block, toolName, lang]);

  const [cardsExpanded, setCardsExpanded] = useState(true);
  const [rawOpen, setRawOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saveStates, setSaveStates] = useState<Map<string, SaveStatus>>(() => new Map());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(() => new Map());

  const callKey = useMemo(() => {
    const b = block && typeof block === "object" ? (block as { callId?: unknown }) : undefined;
    return typeof b?.callId === "string" ? b.callId : toolName;
  }, [block, toolName]);

  const mountedRef = useRef(true);
  const callKeyRef = useRef(callKey);
  const inFlightSavesRef = useRef<Set<string>>(new Set());
  callKeyRef.current = callKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    inFlightSavesRef.current = new Set();
    setShowAll(false);
    setRawOpen(false);
    setCardsExpanded(true);
    setSaveStates(new Map());
    setSaveErrors(new Map());
  }, [callKey]);

  const title = resolveActionTitle(parsed, lang);
  const isReady = parsed.phase === "ready";
  const isRunning = parsed.phase === "running";
  const isError = parsed.phase === "error";
  const isPassthrough = parsed.phase === "passthrough";
  const isEmpty = parsed.phase === "empty";

  const canToggleBody = isReady || ((isPassthrough || isError) && Boolean(parsed.rawOutputText));
  const isBodyOpen = isReady ? cardsExpanded : rawOpen;

  const handleToggleHeader = useCallback(() => {
    if (isReady) {
      setCardsExpanded((prev) => !prev);
      return;
    }
    if ((isPassthrough && parsed.rawOutputText) || isError) {
      setRawOpen((prev) => !prev);
    }
  }, [isReady, isPassthrough, isError, parsed.rawOutputText]);

  const handleOpen = useCallback(
    (item: SocialPostCardItem) => {
      if (onOpenPost) {
        onOpenPost(item);
        return;
      }
      defaultOpenExternal(item.sourceUrl);
    },
    [onOpenPost],
  );

  const handleSave = useCallback(
    async (item: SocialPostCardItem) => {
      if (!canSaveToInspiration || !onSaveToInspiration || !isSafeHttpUrl(item.sourceUrl)) return;
      const current = saveStates.get(item.id);
      if (current === "saving" || current === "saved") return;
      if (inFlightSavesRef.current.has(item.id)) return;

      const activeCallKey = callKeyRef.current;
      inFlightSavesRef.current.add(item.id);

      setSaveStates((prev) => {
        const next = new Map(prev);
        next.set(item.id, "saving");
        return next;
      });
      setSaveErrors((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });

      try {
        const res = await onSaveToInspiration(item);
        if (!mountedRef.current || callKeyRef.current !== activeCallKey) return;
        if (res && res.ok) {
          setSaveStates((prev) => {
            const next = new Map(prev);
            next.set(item.id, "saved");
            return next;
          });
        } else {
          setSaveStates((prev) => {
            const next = new Map(prev);
            next.set(item.id, "error");
            return next;
          });
          setSaveErrors((prev) => {
            const next = new Map(prev);
            next.set(item.id, res?.error || (lang === "en" ? "Save failed" : "保存失败"));
            return next;
          });
        }
      } catch (err) {
        if (!mountedRef.current || callKeyRef.current !== activeCallKey) return;
        setSaveStates((prev) => {
          const next = new Map(prev);
          next.set(item.id, "error");
          return next;
        });
        setSaveErrors((prev) => {
          const next = new Map(prev);
          next.set(item.id, err instanceof Error ? err.message : String(err));
          return next;
        });
      } finally {
        if (callKeyRef.current === activeCallKey) {
          inFlightSavesRef.current.delete(item.id);
        }
      }
    },
    [canSaveToInspiration, onSaveToInspiration, saveStates, lang],
  );

  const visibleItems = useMemo(() => {
    if (!isReady) return [];
    const cap = Math.max(1, initialVisibleCount);
    return showAll || parsed.items.length <= cap ? parsed.items : parsed.items.slice(0, cap);
  }, [isReady, parsed.items, showAll, initialVisibleCount]);

  const remainingCount = Math.max(0, parsed.items.length - Math.max(1, initialVisibleCount));
  const countLabel = isReady && parsed.totalCount > 0
    ? lang === "en"
      ? `${parsed.totalCount} ${parsed.totalCount === 1 ? "result" : "results"}`
      : `${parsed.totalCount} 条`
    : null;
  const singleCard = isReady && parsed.items.length === 1;

  return (
    <section
      className={cx(c("root"), className)}
      data-social-toolview={toolName}
      data-phase={parsed.phase}
    >
      <div className={c("header")}>
        <div className={c("headerLeft")}>
          <button
            type="button"
            className={c("headerTrigger")}
            data-static={!canToggleBody ? "true" : undefined}
            data-error={isError ? "true" : undefined}
            aria-expanded={canToggleBody ? isBodyOpen : undefined}
            onClick={canToggleBody ? handleToggleHeader : undefined}
            disabled={!canToggleBody}
          >
            <span className={c("headerIcon")} aria-hidden="true">
              {isRunning ? (
                <span className={c("runningDot")} />
              ) : parsed.platform ? (
                <SocialPlatformMark platform={parsed.platform} size={14} />
              ) : (
                <SearchGlyph />
              )}
            </span>
            <span className={c("title")}>{title}</span>
            {parsed.querySummary ? <span className={c("query")}>{parsed.querySummary}</span> : null}
            {countLabel ? <span className={c("countPill")}>{countLabel}</span> : null}
            {canToggleBody ? (
              <span className={c("chevron")} data-open={String(isBodyOpen)} aria-hidden="true">
                <ChevronGlyph />
              </span>
            ) : null}
          </button>
        </div>

        <div className={c("headerActions")}>
          {(Boolean(inspect) || isPassthrough || isError) && parsed.rawOutputText ? (
            <button
              type="button"
              className={c("headerActionBtn")}
              aria-expanded={rawOpen}
              aria-label={lang === "en" ? "Toggle raw output" : "查看原始输出"}
              title={lang === "en" ? "Raw output" : "原始输出"}
              onClick={() => setRawOpen((prev) => !prev)}
            >
              JSON
            </button>
          ) : null}
          {inspect ? (
            <button
              type="button"
              className={c("headerActionBtn")}
              aria-label={lang === "en" ? "Inspect call" : "检查调用详情"}
              title={lang === "en" ? "Inspect call" : "检查调用详情"}
              onClick={inspect}
            >
              <InspectGlyph />
            </button>
          ) : null}
        </div>
      </div>

      {isError ? (
        <div className={c("errorBox")} role="status">
          {parsed.errorMessage}
        </div>
      ) : null}

      {rawOpen && parsed.rawOutputText ? (
        <pre className={c("rawOutputBox")}>{parsed.rawOutputText}</pre>
      ) : null}

      {isReady && cardsExpanded ? (
        <>
          <div className={singleCard ? c("gridSingle") : undefined}>
            <MasonryGrid
              items={visibleItems}
              getKey={(item) => item.id}
              minColumnWidth={210}
              minColumns={1}
              maxColumns={singleCard ? 1 : 2}
              defaultColumns={singleCard ? 1 : 2}
              gap={10}
              resetKey={`${callKey}:${toolName}:${parsed.totalCount}:${parsed.items[0]?.id ?? ""}`}
              estimateWeight={estimateArchetypeWeight}
              ariaLabel={title}
              renderItem={(item) => {
                const hasLink = isSafeHttpUrl(item.sourceUrl);
                const saveStatus = saveStates.get(item.id) ?? "idle";
                const saveErr = saveErrors.get(item.id);
                const showSave = Boolean(canSaveToInspiration && onSaveToInspiration && hasLink);

                const hoverActions =
                  hasLink || showSave ? (
                    <>
                      {hasLink ? (
                        <button
                          type="button"
                          className={c("hoverPillBtn")}
                          aria-label={lang === "en" ? "Open original post" : "打开原帖"}
                          title={lang === "en" ? "Open original post" : "打开原帖"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpen(item);
                          }}
                        >
                          <ExternalLinkGlyph />
                        </button>
                      ) : null}
                      {showSave ? (
                        <button
                          type="button"
                          className={c("hoverPillBtn")}
                          data-save-state={saveStatus}
                          aria-busy={saveStatus === "saving" || undefined}
                          disabled={saveStatus === "saving" || saveStatus === "saved"}
                          aria-label={
                            saveStatus === "saved"
                              ? lang === "en" ? "Saved to inspiration" : "已保存到灵感库"
                              : saveStatus === "saving"
                                ? lang === "en" ? "Saving to inspiration" : "正在保存灵感"
                                : saveStatus === "error"
                                  ? saveErr || (lang === "en" ? "Save failed, click to retry" : "保存失败，点击重试")
                                  : lang === "en" ? "Save to inspiration" : "存为灵感"
                          }
                          title={
                            saveStatus === "saved"
                              ? lang === "en" ? "Saved" : "已存为灵感"
                              : saveStatus === "saving"
                                ? lang === "en" ? "Saving..." : "保存中"
                                : saveStatus === "error"
                                  ? saveErr || (lang === "en" ? "Save failed, click to retry" : "保存失败，点击重试")
                                  : lang === "en" ? "Save to inspiration" : "存为灵感"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSave(item);
                          }}
                        >
                          {saveStatus === "saving" ? (
                            <span className={c("hoverSpinner")} aria-hidden="true" />
                          ) : saveStatus === "error" ? (
                            <span className={c("hoverRetryLabel")}>
                              {lang === "en" ? "Retry" : "重试"}
                            </span>
                          ) : (
                            <IconSwap
                              active={saveStatus === "saved"}
                              primary={<BookmarkGlyph />}
                              secondary={<CheckGlyph />}
                            />
                          )}
                        </button>
                      ) : null}
                    </>
                  ) : undefined;

                return (
                  <SocialPostCard
                    key={item.id}
                    item={item}
                    density="compact"
                    onClick={hasLink || onOpenPost ? () => handleOpen(item) : undefined}
                    hoverActions={hoverActions}
                  />
                );
              }}
            />
          </div>

          {saveErrors.size > 0 ? (
            <div className={c("errorBox")} role="status">
              {Array.from(saveErrors.values())[0]}
            </div>
          ) : null}

          {remainingCount > 0 ? (
            <button
              type="button"
              className={c("showMoreBtn")}
              aria-expanded={showAll}
              onClick={() => setShowAll((prev) => !prev)}
            >
              {showAll
                ? lang === "en" ? "Show less" : "收起"
                : lang === "en" ? `Show ${remainingCount} more` : `展开其余 ${remainingCount} 条`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
