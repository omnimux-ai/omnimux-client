import { n as cx, r as cssClass, t as injectCss } from "./injectCss-73B9Wi4w.js";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
// src/social-card/archetype.ts
const KNOWN_PLATFORMS = /* @__PURE__ */ new Set([
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
	"web"
]);
const VALID_ARCHETYPES = /* @__PURE__ */ new Set([
	"article",
	"social-post",
	"short-video",
	"photo-feed",
	"landscape-video",
	"web-link",
	"raw-media"
]);
/** Extract a clean lowercase hostname (stripping leading `www.`) from an HTTP URL. */
function extractHostname(url) {
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
function normalizeSocialPlatform(rawPlatform, sourceUrl) {
	const slug = String(rawPlatform ?? "").trim().toLowerCase();
	if (slug === "twitter") return "x";
	if (slug === "xhs") return "xiaohongshu";
	if (KNOWN_PLATFORMS.has(slug)) return slug;
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
function isVerticalVideoRatio(ratio) {
	return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 && ratio < .85;
}
function isYouTubeShortsUrl(url) {
	const raw = String(url ?? "").toLowerCase();
	return raw.includes("youtube.com/shorts/") || raw.includes("/shorts/");
}
function hasArticleStructure(item, platform) {
	if (item.contentShape === "article" || item.isArticle === true) return true;
	const title = String(item.title ?? "").trim();
	const excerpt = String(item.excerpt ?? "").trim();
	const body = String(item.body ?? "").trim();
	if (platform === "substack") return title.length > 0;
	if (platform === "x" && title.length > 0 && excerpt.length > 0 && title !== body) return true;
	return false;
}
/**
* Resolve one of the 6 semantic content archetypes (plus raw-media) from structured metadata.
* Relies solely on protocol/store fields; never guesses archetypes from arbitrary body text regexes.
*/
function resolveSocialCardArchetype(item) {
	if (item.archetype && VALID_ARCHETYPES.has(item.archetype)) return item.archetype;
	const platform = normalizeSocialPlatform(item.platform, item.sourceUrl);
	const hasUrl = Boolean(String(item.sourceUrl ?? "").trim());
	const ratio = item.coverAspectRatio;
	if (!hasUrl && platform === "web" && (item.mediaType === "image" || item.mediaType === "video" || Boolean(item.coverUrl))) return "raw-media";
	if (hasArticleStructure(item, platform)) return "article";
	if (platform === "tiktok" || platform === "douyin") return "short-video";
	if (platform === "youtube") {
		if (isYouTubeShortsUrl(item.sourceUrl) || item.isVideo !== false && isVerticalVideoRatio(ratio)) return "short-video";
		return Boolean(item.coverUrl || typeof item.durationSec === "number" && item.durationSec > 0 || item.author?.name || typeof item.metrics?.views === "number" && item.metrics.views >= 0) ? "landscape-video" : "web-link";
	}
	if (platform === "bilibili") return Boolean(item.coverUrl && (typeof item.durationSec === "number" && item.durationSec > 0 || item.author?.name)) ? "landscape-video" : "web-link";
	if (platform === "instagram" || platform === "xiaohongshu") {
		if (item.isVideo === true && (item.mediaCount ?? 1) <= 1 && isVerticalVideoRatio(ratio)) return "short-video";
		return "photo-feed";
	}
	if (platform === "x" || platform === "threads" || platform === "linkedin" || platform === "substack") return "social-post";
	return "web-link";
}
/**
* Derive outlier badges purely from backend-supplied velocity metrics.
* Returns an empty array when data is absent so cards never display fabricated numbers.
*/
function resolveOutlierBadges(velocity) {
	if (!velocity || typeof velocity !== "object") return [];
	const badges = [];
	const multiplier = Number(velocity.multiplier);
	if (Number.isFinite(multiplier) && multiplier >= 1.2) {
		const formatted = `${multiplier >= 10 ? multiplier.toFixed(1) : multiplier.toFixed(2).replace(/0$/, "")}\u00d7`;
		badges.push({
			label: formatted,
			tone: multiplier >= 5 ? "amber" : "blue"
		});
	}
	const rawTop = velocity.topPercent ?? velocity.top_percent ?? velocity.percentile;
	if (rawTop != null) {
		const pct = Number(rawTop);
		if (Number.isFinite(pct) && pct > 0 && pct <= 25) badges.push({
			label: `Top ${pct % 1 === 0 ? pct : pct.toFixed(1)}%`,
			tone: "violet"
		});
	}
	return badges;
}
/** Compact metric formatting (e.g. `5.7K`, `1.5M`) paired with `tabular-nums`. */
function formatCompactCount(raw) {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return void 0;
	if (raw >= 1e6) {
		const v = raw / 1e6;
		return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}M`;
	}
	if (raw >= 1e3) {
		const v = raw / 1e3;
		return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}K`;
	}
	return String(Math.round(raw));
}
/** Format duration in whole seconds as `m:ss` or `h:mm:ss`. */
function formatDuration(seconds) {
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return void 0;
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor(total % 3600 / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
	return `${m}:${ss}`;
}
const ARCHETYPE_WEIGHTS = {
	"short-video": 1.65,
	"photo-feed": 1.5,
	article: 1.45,
	"landscape-video": 1.15,
	"social-post": 1.1,
	"web-link": 1,
	"raw-media": .95
};
/** Heuristic height weight for balanced initial masonry column assignment. */
function estimateArchetypeWeight(item) {
	const archetype = resolveSocialCardArchetype(item);
	let weight = ARCHETYPE_WEIGHTS[archetype];
	if (archetype === "social-post" && !item.coverUrl) weight = String(item.body ?? "").length > 200 ? 1.15 : .78;
	return weight;
}
// src/social-card/PlatformMark.tsx
const PATHS = {
	x: {
		viewBox: "0 0 24 24",
		paths: ["M18.24 2.25h3.3l-7.22 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z"]
	},
	tiktok: {
		viewBox: "0 0 24 24",
		paths: ["M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.87a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.3Z"]
	},
	douyin: {
		viewBox: "0 0 16 16",
		paths: ["M10 2.4c.2 1.5 1.2 2.6 2.7 2.9v2.2a5 5 0 0 1-2.7-1v4.1a3.9 3.9 0 1 1-3.6-3.9v2.2a1.7 1.7 0 1 0 1.4 1.7V2.4H10Z"]
	},
	instagram: {
		viewBox: "0 0 24 24",
		paths: ["M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6Zm9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"]
	},
	youtube: {
		viewBox: "0 0 24 24",
		paths: ["M21.58 7.19a2.75 2.75 0 0 0-1.94-1.95C17.93 4.75 12 4.75 12 4.75s-5.93 0-7.64.49a2.75 2.75 0 0 0-1.94 1.95A28.7 28.7 0 0 0 2 12a28.7 28.7 0 0 0 .42 4.81 2.75 2.75 0 0 0 1.94 1.95c1.71.49 7.64.49 7.64.49s5.93 0 7.64-.49a2.75 2.75 0 0 0 1.94-1.95A28.7 28.7 0 0 0 22 12a28.7 28.7 0 0 0-.42-4.81ZM10 15.11V8.89L15.4 12 10 15.11Z"]
	},
	bilibili: {
		viewBox: "0 0 24 24",
		stroke: true,
		paths: [
			"M7 4l3 3",
			"M17 4l-3 3",
			"M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
			"M9 12v3",
			"M15 12v3"
		]
	},
	xiaohongshu: {
		viewBox: "0 0 16 16",
		paths: ["M8 4.6C6.9 3.7 5.3 3.2 3.4 3.2v8.4c1.9 0 3.5.5 4.6 1.4 1.1-.9 2.7-1.4 4.6-1.4V3.2C10.7 3.2 9.1 3.7 8 4.6Zm-.9 1.6c-.8-.5-1.8-.8-2.8-.9v6.1c1 .1 2 .4 2.8.9V6.2Zm1.8 0c.8-.5 1.8-.8 2.8-.9v6.1c-1 .1-2 .4-2.8.9V6.2Z"]
	},
	threads: {
		viewBox: "0 0 16 16",
		paths: ["M9.9 7.5a3.7 3.7 0 0 0-1.2-.5c-.1-1.1-.6-1.8-1.5-1.8-.6 0-1.1.3-1.4.9l1 .6c.2-.3.4-.4.5-.4.4 0 .6.3.7 1a6 6 0 0 0-1.2.2C5.6 7.8 4.9 8.6 5 9.6c0 1.2 1 1.9 2.1 1.8 1-.1 1.7-.7 1.9-1.6.3.2.6.4.8.7.5.7.5 1.7-.3 2.4-.6.6-1.5.9-2.4.8-1.8-.1-3-1.2-3-3.7s1.2-3.6 3.1-3.7c1.3-.1 2.2.4 2.7 1.2Z"]
	},
	linkedin: {
		viewBox: "0 0 24 24",
		paths: ["M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14Zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75ZM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68Zm1.39 9.94v-8.37H5.5v8.37h2.77Z"]
	},
	substack: {
		viewBox: "0 0 24 24",
		paths: ["M4 4h16v2.5H4V4Zm0 4.5h16V11H4V8.5Zm0 4.5h16v9l-8-4.5-8 4.5v-9Z"]
	},
	web: {
		viewBox: "0 0 24 24",
		stroke: true,
		paths: [
			"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
			"M2 12h20",
			"M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"
		]
	}
};
/** Source attribution mark for social platforms and generic web links. */
function SocialPlatformMark({ platform, variant = "icon", size = 15, className, title }) {
	const key = normalizeSocialPlatform(platform);
	const spec = PATHS[key] ?? PATHS.web;
	const glyphSize = variant === "circle-badge" ? Math.max(12, Math.round(size * .85)) : size;
	const svg = /* @__PURE__ */ jsx("svg", {
		width: glyphSize,
		height: glyphSize,
		viewBox: spec.viewBox,
		fill: spec.stroke ? "none" : "currentColor",
		stroke: spec.stroke ? "currentColor" : "none",
		strokeWidth: spec.stroke ? "1.8" : void 0,
		strokeLinecap: spec.stroke ? "round" : void 0,
		strokeLinejoin: spec.stroke ? "round" : void 0,
		"aria-hidden": "true",
		children: spec.paths.map((d, idx) => /* @__PURE__ */ jsx("path", { d }, idx))
	});
	return /* @__PURE__ */ jsx("span", {
		className,
		"data-platform-mark": key,
		"data-variant": variant,
		"aria-label": title,
		title,
		children: svg
	});
}
// \0dsh-ui-kit-css:src/social-card/SocialPostCard.module.css.mjs
injectCss("SocialPostCard.module.css", ".dshUk-SocialPostCard-card {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n  border-radius: 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  background-color: var(--dsw-alias-card-fill);\n  color: var(--dsw-alias-label-primary);\n  overflow: hidden;\n  text-align: left;\n  transition: border-color 140ms ease;\n}\n\n.dshUk-SocialPostCard-card[data-interactive=\"true\"] {\n  cursor: pointer;\n}\n\n.dshUk-SocialPostCard-card:hover {\n  border-color: var(--dsw-alias-border-l3);\n}\n\n.dshUk-SocialPostCard-card:focus {\n  outline: none;\n}\n\n.dshUk-SocialPostCard-card:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dshUk-SocialPostCard-card[data-selected=\"true\"],\n.dshUk-SocialPostCard-card[data-active=\"true\"] {\n  border-color: var(--dsw-alias-brand-primary);\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary);\n}\n\n/* Chrome overlay slots (selection, favorite/menu, hover CTAs) */\n.dshUk-SocialPostCard-topLeft {\n  position: absolute;\n  top: 8px;\n  left: 8px;\n  z-index: 6;\n  display: inline-flex;\n  align-items: center;\n  opacity: 0;\n  transition: opacity 130ms ease;\n}\n\n.dshUk-SocialPostCard-topRight {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  z-index: 6;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.dshUk-SocialPostCard-hoverActions {\n  position: absolute;\n  right: 8px;\n  bottom: 8px;\n  z-index: 5;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  opacity: 0;\n  transform: translateY(3px);\n  pointer-events: none;\n  transition:\n    opacity 130ms ease,\n    transform 130ms ease;\n}\n\n.dshUk-SocialPostCard-card:hover .dshUk-SocialPostCard-topLeft,\n.dshUk-SocialPostCard-card:focus-within .dshUk-SocialPostCard-topLeft,\n.dshUk-SocialPostCard-card[data-selected=\"true\"] .dshUk-SocialPostCard-topLeft,\n.dshUk-SocialPostCard-card[data-menu-open=\"true\"] .dshUk-SocialPostCard-topLeft {\n  opacity: 1;\n}\n\n.dshUk-SocialPostCard-card:hover .dshUk-SocialPostCard-hoverActions,\n.dshUk-SocialPostCard-card:focus-within .dshUk-SocialPostCard-hoverActions {\n  opacity: 1;\n  transform: translateY(0);\n  pointer-events: auto;\n}\n\n@media (hover: none) {\n  .dshUk-SocialPostCard-topLeft {\n    opacity: 1;\n  }\n\n  .dshUk-SocialPostCard-hoverActions {\n    opacity: 1;\n    transform: none;\n    pointer-events: auto;\n  }\n}\n\n/* Pin-clearance when top-right carries persistent indicator(s) (favorite star / error badge) */\n.dshUk-SocialPostCard-card[data-pinned-tr=\"true\"] .dshUk-SocialPostCard-pinnedClearance {\n  padding-right: 36px;\n}\n\n.dshUk-SocialPostCard-card[data-pinned-tr-multi=\"true\"] .dshUk-SocialPostCard-pinnedClearance {\n  padding-right: 64px;\n}\n\n/* Shared sub-elements */\n.dshUk-SocialPostCard-avatar {\n  flex-shrink: 0;\n  border-radius: 9999px;\n  overflow: hidden;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l1);\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 600;\n  font-size: 12px;\n}\n\n.dshUk-SocialPostCard-avatarImg {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  display: block;\n}\n\n.dshUk-SocialPostCard-avatarSm {\n  width: 28px;\n  height: 28px;\n}\n\n.dshUk-SocialPostCard-avatarMd {\n  width: 32px;\n  height: 32px;\n}\n\n.dshUk-SocialPostCard-avatarLg {\n  width: 36px;\n  height: 36px;\n}\n\n.dshUk-SocialPostCard-authorRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.dshUk-SocialPostCard-authorMeta {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  min-width: 0;\n  flex: 1;\n}\n\n.dshUk-SocialPostCard-authorTop {\n  display: flex;\n  align-items: baseline;\n  gap: 5px;\n  min-width: 0;\n}\n\n.dshUk-SocialPostCard-authorName {\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 17px;\n  color: var(--dsw-alias-label-primary);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.dshUk-SocialPostCard-authorHandle {\n  font-size: 12.5px;\n  font-weight: 400;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.dshUk-SocialPostCard-timeLabel {\n  font-size: 12px;\n  line-height: 15px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshUk-SocialPostCard-statsBar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 0 12px 11px;\n  margin-top: auto;\n}\n\n.dshUk-SocialPostCard-statsLeft {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  min-width: 0;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-statItem {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 12px;\n  line-height: 16px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshUk-SocialPostCard-outlierBadge {\n  display: inline-flex;\n  align-items: center;\n  padding: 2px 6px;\n  border-radius: 6px;\n  font-size: 11px;\n  line-height: 15px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-outlierBlue {\n  background-color: var(--dsw-alias-state-business-tertiary);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.dshUk-SocialPostCard-outlierViolet {\n  background-color: color-mix(in srgb, var(--dsw-alias-state-done-primary) 16%, transparent);\n  color: var(--dsw-alias-state-done-primary);\n}\n\n.dshUk-SocialPostCard-outlierAmber {\n  background-color: var(--dsw-alias-state-warn-tertiary);\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.dshUk-SocialPostCard-outlierGreen {\n  background-color: var(--dsw-alias-state-success-tertiary);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.dshUk-SocialPostCard-platformMark {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshUk-SocialPostCard-platformCircle {\n  width: 24px;\n  height: 24px;\n  border-radius: 9999px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  background-color: var(--dsw-alias-brand-primary);\n  color: var(--dsw-alias-bg-base);\n}\n\n.dshUk-SocialPostCard-mediaBox {\n  position: relative;\n  width: 100%;\n  overflow: hidden;\n  background-color: var(--dsw-alias-bg-layer-2);\n}\n\n.dshUk-SocialPostCard-mediaImg {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.dshUk-SocialPostCard-mediaFallback {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 100%;\n  color: var(--dsw-alias-label-tertiary);\n  background-color: var(--dsw-alias-bg-layer-2);\n}\n\n.dshUk-SocialPostCard-durationPill {\n  position: absolute;\n  padding: 2px 6px;\n  border-radius: 5px;\n  background-color: color-mix(in srgb, var(--dsw-static-neutral-1000) 76%, transparent);\n  color: var(--dsw-static-neutral-00);\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 15px;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-galleryPill {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  padding: 2px 7px;\n  border-radius: 9999px;\n  background-color: color-mix(in srgb, var(--dsw-static-neutral-1000) 70%, transparent);\n  color: var(--dsw-static-neutral-00);\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 15px;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-videoPlayBadge {\n  position: absolute;\n  right: 10px;\n  bottom: 10px;\n  width: 30px;\n  height: 30px;\n  border-radius: 9999px;\n  background-color: color-mix(in srgb, var(--dsw-static-neutral-1000) 72%, transparent);\n  color: var(--dsw-static-neutral-00);\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n\n/* 1. Article archetype */\n.dshUk-SocialPostCard-articleCover {\n  aspect-ratio: 16 / 9;\n}\n\n.dshUk-SocialPostCard-articleBody {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 12px 12px 10px;\n}\n\n.dshUk-SocialPostCard-articleTitle {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 1.35;\n  color: var(--dsw-alias-label-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 3;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-articleTitle {\n  font-size: 14px;\n}\n\n.dshUk-SocialPostCard-articleExcerpt {\n  margin: 0;\n  font-size: 13px;\n  line-height: 1.45;\n  color: var(--dsw-alias-label-secondary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n/* 2. Social-post archetype */\n.dshUk-SocialPostCard-socialWrap {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px;\n}\n\n.dshUk-SocialPostCard-socialBodyText {\n  margin: 0;\n  font-size: 13.5px;\n  line-height: 1.48;\n  color: var(--dsw-alias-label-primary);\n  white-space: pre-line;\n  display: -webkit-box;\n  -webkit-line-clamp: 5;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n  user-select: text;\n}\n\n.dshUk-SocialPostCard-socialBodyTextOnly {\n  -webkit-line-clamp: 10;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-socialBodyText {\n  font-size: 13px;\n  -webkit-line-clamp: 4;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-socialBodyTextOnly {\n  -webkit-line-clamp: 6;\n}\n\n.dshUk-SocialPostCard-socialMediaInset {\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  aspect-ratio: 16 / 10;\n}\n\n/* 3. Short-video archetype */\n.dshUk-SocialPostCard-shortVideoStage {\n  position: relative;\n  width: 100%;\n  aspect-ratio: 5 / 8;\n  overflow: hidden;\n  background-color: var(--dsw-alias-bg-layer-3);\n}\n\n.dshUk-SocialPostCard-shortVideoDuration {\n  top: 8px;\n  left: 8px;\n}\n\n.dshUk-SocialPostCard-shortVideoScrim {\n  position: absolute;\n  inset: auto 0 0 0;\n  height: 46%;\n  background: linear-gradient(\n    180deg,\n    transparent 0%,\n    color-mix(in srgb, var(--dsw-static-neutral-1000) 82%, transparent) 100%\n  );\n  pointer-events: none;\n}\n\n.dshUk-SocialPostCard-shortVideoRightStats {\n  position: absolute;\n  right: 8px;\n  bottom: 52px;\n  z-index: 2;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 10px;\n  color: var(--dsw-static-neutral-00);\n  text-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-static-neutral-1000) 75%, transparent);\n  font-size: 11px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-shortVideoRightStat {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 2px;\n}\n\n.dshUk-SocialPostCard-shortVideoBottomCopy {\n  position: absolute;\n  left: 10px;\n  right: 42px;\n  bottom: 10px;\n  z-index: 2;\n  color: var(--dsw-static-neutral-00);\n  text-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-static-neutral-1000) 75%, transparent);\n}\n\n.dshUk-SocialPostCard-shortVideoHandle {\n  font-size: 12.5px;\n  font-weight: 600;\n  margin-bottom: 2px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.dshUk-SocialPostCard-shortVideoCaption {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.38;\n  color: color-mix(in srgb, var(--dsw-static-neutral-00) 92%, transparent);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-shortVideoFooter {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 10px 12px;\n  background-color: var(--dsw-alias-card-fill);\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n\n/* 4. Photo-feed archetype */\n.dshUk-SocialPostCard-photoFeedHeader {\n  padding: 10px 12px;\n}\n\n.dshUk-SocialPostCard-photoFeedMedia {\n  aspect-ratio: 4 / 5;\n}\n\n.dshUk-SocialPostCard-photoFeedBody {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 10px 12px 11px;\n}\n\n.dshUk-SocialPostCard-photoFeedCaptionRow {\n  display: flex;\n  align-items: flex-end;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.dshUk-SocialPostCard-photoFeedCaption {\n  margin: 0;\n  font-size: 12.5px;\n  line-height: 1.42;\n  color: var(--dsw-alias-label-secondary);\n  display: -webkit-box;\n  -webkit-line-clamp: 3;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n  user-select: text;\n}\n\n.dshUk-SocialPostCard-photoFeedHandle {\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n  margin-right: 5px;\n}\n\n/* 5. Landscape-video archetype */\n.dshUk-SocialPostCard-landscapeCover {\n  aspect-ratio: 16 / 9;\n}\n\n.dshUk-SocialPostCard-landscapeDuration {\n  right: 8px;\n  bottom: 8px;\n}\n\n.dshUk-SocialPostCard-landscapeFooter {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 10px 12px 12px;\n}\n\n.dshUk-SocialPostCard-landscapeCol {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n\n.dshUk-SocialPostCard-landscapeTitle {\n  margin: 0;\n  font-size: 13.5px;\n  font-weight: 600;\n  line-height: 1.35;\n  color: var(--dsw-alias-label-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-landscapeSubrow {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-top: 2px;\n}\n\n.dshUk-SocialPostCard-landscapeMetaPair {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 6. Web-link & raw-media archetypes */\n.dshUk-SocialPostCard-webLinkCover {\n  aspect-ratio: 16 / 9;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.dshUk-SocialPostCard-webLinkBody {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 12px 12px;\n}\n\n.dshUk-SocialPostCard-webLinkTitle {\n  margin: 0;\n  font-size: 13.5px;\n  font-weight: 600;\n  line-height: 1.36;\n  color: var(--dsw-alias-label-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-webLinkHostRow {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshUk-SocialPostCard-faviconImg {\n  width: 14px;\n  height: 14px;\n  border-radius: 3px;\n  object-fit: cover;\n  flex-shrink: 0;\n}\n\n.dshUk-SocialPostCard-rawMediaFrame {\n  aspect-ratio: 4 / 3;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshUk-SocialPostCard-card,\n  .dshUk-SocialPostCard-topLeft,\n  .dshUk-SocialPostCard-hoverActions {\n    transition: none;\n  }\n}\n");
var SocialPostCard_module_css_default = {
	"card": "dshUk-SocialPostCard-card",
	"topLeft": "dshUk-SocialPostCard-topLeft",
	"topRight": "dshUk-SocialPostCard-topRight",
	"hoverActions": "dshUk-SocialPostCard-hoverActions",
	"pinnedClearance": "dshUk-SocialPostCard-pinnedClearance",
	"avatar": "dshUk-SocialPostCard-avatar",
	"avatarImg": "dshUk-SocialPostCard-avatarImg",
	"avatarSm": "dshUk-SocialPostCard-avatarSm",
	"avatarMd": "dshUk-SocialPostCard-avatarMd",
	"avatarLg": "dshUk-SocialPostCard-avatarLg",
	"authorRow": "dshUk-SocialPostCard-authorRow",
	"authorMeta": "dshUk-SocialPostCard-authorMeta",
	"authorTop": "dshUk-SocialPostCard-authorTop",
	"authorName": "dshUk-SocialPostCard-authorName",
	"authorHandle": "dshUk-SocialPostCard-authorHandle",
	"timeLabel": "dshUk-SocialPostCard-timeLabel",
	"statsBar": "dshUk-SocialPostCard-statsBar",
	"statsLeft": "dshUk-SocialPostCard-statsLeft",
	"statItem": "dshUk-SocialPostCard-statItem",
	"outlierBadge": "dshUk-SocialPostCard-outlierBadge",
	"outlierBlue": "dshUk-SocialPostCard-outlierBlue",
	"outlierViolet": "dshUk-SocialPostCard-outlierViolet",
	"outlierAmber": "dshUk-SocialPostCard-outlierAmber",
	"outlierGreen": "dshUk-SocialPostCard-outlierGreen",
	"platformMark": "dshUk-SocialPostCard-platformMark",
	"platformCircle": "dshUk-SocialPostCard-platformCircle",
	"mediaBox": "dshUk-SocialPostCard-mediaBox",
	"mediaImg": "dshUk-SocialPostCard-mediaImg",
	"mediaFallback": "dshUk-SocialPostCard-mediaFallback",
	"durationPill": "dshUk-SocialPostCard-durationPill",
	"galleryPill": "dshUk-SocialPostCard-galleryPill",
	"videoPlayBadge": "dshUk-SocialPostCard-videoPlayBadge",
	"articleCover": "dshUk-SocialPostCard-articleCover",
	"articleBody": "dshUk-SocialPostCard-articleBody",
	"articleTitle": "dshUk-SocialPostCard-articleTitle",
	"articleExcerpt": "dshUk-SocialPostCard-articleExcerpt",
	"socialWrap": "dshUk-SocialPostCard-socialWrap",
	"socialBodyText": "dshUk-SocialPostCard-socialBodyText",
	"socialBodyTextOnly": "dshUk-SocialPostCard-socialBodyTextOnly",
	"socialMediaInset": "dshUk-SocialPostCard-socialMediaInset",
	"shortVideoStage": "dshUk-SocialPostCard-shortVideoStage",
	"shortVideoDuration": "dshUk-SocialPostCard-shortVideoDuration",
	"shortVideoScrim": "dshUk-SocialPostCard-shortVideoScrim",
	"shortVideoRightStats": "dshUk-SocialPostCard-shortVideoRightStats",
	"shortVideoRightStat": "dshUk-SocialPostCard-shortVideoRightStat",
	"shortVideoBottomCopy": "dshUk-SocialPostCard-shortVideoBottomCopy",
	"shortVideoHandle": "dshUk-SocialPostCard-shortVideoHandle",
	"shortVideoCaption": "dshUk-SocialPostCard-shortVideoCaption",
	"shortVideoFooter": "dshUk-SocialPostCard-shortVideoFooter",
	"photoFeedHeader": "dshUk-SocialPostCard-photoFeedHeader",
	"photoFeedMedia": "dshUk-SocialPostCard-photoFeedMedia",
	"photoFeedBody": "dshUk-SocialPostCard-photoFeedBody",
	"photoFeedCaptionRow": "dshUk-SocialPostCard-photoFeedCaptionRow",
	"photoFeedCaption": "dshUk-SocialPostCard-photoFeedCaption",
	"photoFeedHandle": "dshUk-SocialPostCard-photoFeedHandle",
	"landscapeCover": "dshUk-SocialPostCard-landscapeCover",
	"landscapeDuration": "dshUk-SocialPostCard-landscapeDuration",
	"landscapeFooter": "dshUk-SocialPostCard-landscapeFooter",
	"landscapeCol": "dshUk-SocialPostCard-landscapeCol",
	"landscapeTitle": "dshUk-SocialPostCard-landscapeTitle",
	"landscapeSubrow": "dshUk-SocialPostCard-landscapeSubrow",
	"landscapeMetaPair": "dshUk-SocialPostCard-landscapeMetaPair",
	"webLinkCover": "dshUk-SocialPostCard-webLinkCover",
	"webLinkBody": "dshUk-SocialPostCard-webLinkBody",
	"webLinkTitle": "dshUk-SocialPostCard-webLinkTitle",
	"webLinkHostRow": "dshUk-SocialPostCard-webLinkHostRow",
	"faviconImg": "dshUk-SocialPostCard-faviconImg",
	"rawMediaFrame": "dshUk-SocialPostCard-rawMediaFrame"
};
// src/social-card/SocialPostCard.tsx
const c = (name) => cssClass(SocialPostCard_module_css_default[name], name);
function HeartGlyph() {
	return /* @__PURE__ */ jsx("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: /* @__PURE__ */ jsx("path", { d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" })
	});
}
function RepostGlyph() {
	return /* @__PURE__ */ jsxs("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ jsx("path", { d: "m17 2 4 4-4 4" }),
			/* @__PURE__ */ jsx("path", { d: "M3 11v-1a4 4 0 0 1 4-4h14" }),
			/* @__PURE__ */ jsx("path", { d: "m7 22-4-4 4-4" }),
			/* @__PURE__ */ jsx("path", { d: "M21 13v1a4 4 0 0 1-4 4H3" })
		]
	});
}
function PlayGlyph({ size = 12 }) {
	return /* @__PURE__ */ jsx("svg", {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "currentColor",
		"aria-hidden": "true",
		children: /* @__PURE__ */ jsx("polygon", { points: "6 4 20 12 6 20 6 4" })
	});
}
function avatarInitials(name, handle) {
	const source = String(name || handle || "?").replace(/^@/, "").trim();
	if (!source) return "?";
	const parts = source.split(/\s+/).filter(Boolean);
	if (parts.length >= 2 && parts[0] && parts[1]) return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
	return Array.from(source).slice(0, 2).join("").toUpperCase();
}
function Avatar({ name, handle, avatarUrl, sizeClass }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setFailed(false);
	}, [avatarUrl]);
	return /* @__PURE__ */ jsx("span", {
		className: cx(c("avatar"), sizeClass),
		"aria-hidden": "true",
		children: avatarUrl && !failed ? /* @__PURE__ */ jsx("img", {
			src: avatarUrl,
			alt: "",
			className: c("avatarImg"),
			loading: "lazy",
			onError: () => setFailed(true)
		}) : avatarInitials(name, handle)
	});
}
function AuthorRow({ item, avatarSize = "sm", showHandleInline = false, className }) {
	const authorName = String(item.author?.name || item.author?.handle || item.hostname || "").trim();
	const handleText = item.author?.handle ? `@${String(item.author.handle).replace(/^@/, "")}` : "";
	const showHandle = showHandleInline && handleText && handleText.toLowerCase() !== `@${authorName.toLowerCase()}`;
	const timeText = item.publishedLabel || "";
	if (!authorName && !timeText) return null;
	const sizeCls = avatarSize === "lg" ? c("avatarLg") : avatarSize === "md" ? c("avatarMd") : c("avatarSm");
	return /* @__PURE__ */ jsxs("div", {
		className: cx(c("authorRow"), className),
		children: [/* @__PURE__ */ jsx(Avatar, {
			name: authorName,
			handle: handleText,
			avatarUrl: item.author?.avatarUrl,
			sizeClass: sizeCls
		}), /* @__PURE__ */ jsxs("div", {
			className: c("authorMeta"),
			children: [/* @__PURE__ */ jsxs("div", {
				className: c("authorTop"),
				children: [/* @__PURE__ */ jsx("span", {
					className: c("authorName"),
					children: authorName || handleText
				}), showHandle ? /* @__PURE__ */ jsx("span", {
					className: c("authorHandle"),
					children: handleText
				}) : null]
			}), timeText ? /* @__PURE__ */ jsx("span", {
				className: c("timeLabel"),
				children: timeText
			}) : null]
		})]
	});
}
function OutlierBadges({ badges }) {
	if (!badges?.length) return null;
	return /* @__PURE__ */ jsx(Fragment, { children: badges.map((badge, idx) => {
		const toneCls = badge.tone === "amber" ? c("outlierAmber") : badge.tone === "violet" ? c("outlierViolet") : badge.tone === "green" ? c("outlierGreen") : c("outlierBlue");
		return /* @__PURE__ */ jsx("span", {
			className: cx(c("outlierBadge"), toneCls),
			children: badge.label
		}, `${badge.label}-${idx}`);
	}) });
}
function StatsBar({ item, platform, showViews = false, hidePlatformMark = false }) {
	const likes = formatCompactCount(item.metrics?.likes);
	const reposts = formatCompactCount(item.metrics?.reposts);
	const views = showViews ? formatCompactCount(item.metrics?.views) : void 0;
	if (!Boolean(likes || reposts || views || item.outlierBadges?.length) && hidePlatformMark) return null;
	return /* @__PURE__ */ jsxs("div", {
		className: c("statsBar"),
		children: [/* @__PURE__ */ jsxs("div", {
			className: c("statsLeft"),
			children: [
				likes ? /* @__PURE__ */ jsxs("span", {
					className: c("statItem"),
					children: [/* @__PURE__ */ jsx(HeartGlyph, {}), /* @__PURE__ */ jsx("span", { children: likes })]
				}) : null,
				reposts ? /* @__PURE__ */ jsxs("span", {
					className: c("statItem"),
					children: [/* @__PURE__ */ jsx(RepostGlyph, {}), /* @__PURE__ */ jsx("span", { children: reposts })]
				}) : null,
				views ? /* @__PURE__ */ jsxs("span", {
					className: c("statItem"),
					children: [/* @__PURE__ */ jsx(PlayGlyph, { size: 11 }), /* @__PURE__ */ jsx("span", { children: views })]
				}) : null,
				/* @__PURE__ */ jsx(OutlierBadges, { badges: item.outlierBadges })
			]
		}), !hidePlatformMark ? /* @__PURE__ */ jsx(SocialPlatformMark, {
			platform,
			className: c("platformMark"),
			size: 15
		}) : null]
	});
}
function CoverMedia({ item, platform, aspectClass, coverNode, children }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setFailed(false);
	}, [item.coverUrl]);
	const inlineStyle = !item.coverAspectRatio || aspectClass === c("articleCover") || aspectClass === c("landscapeCover") || aspectClass === c("webLinkCover") ? void 0 : { aspectRatio: String(Math.max(.55, Math.min(1.91, item.coverAspectRatio))) };
	return /* @__PURE__ */ jsxs("div", {
		className: cx(c("mediaBox"), aspectClass),
		style: inlineStyle,
		children: [coverNode != null ? coverNode : item.coverUrl && !failed ? /* @__PURE__ */ jsx("img", {
			src: item.coverUrl,
			alt: item.coverAlt || item.title || "",
			className: c("mediaImg"),
			loading: "lazy",
			onError: () => setFailed(true)
		}) : /* @__PURE__ */ jsx("div", {
			className: c("mediaFallback"),
			children: /* @__PURE__ */ jsx(SocialPlatformMark, {
				platform,
				size: 26
			})
		}), children]
	});
}
function ArticleBody({ item, platform, coverNode, hideMedia }) {
	const titleText = String(item.title || item.body || "").trim();
	const excerptText = String(item.excerpt || (item.title && item.body && item.body !== item.title ? item.body : "")).trim();
	const hasCover = !hideMedia && Boolean(item.coverUrl || coverNode);
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		hasCover ? /* @__PURE__ */ jsx(CoverMedia, {
			item,
			platform,
			aspectClass: c("articleCover"),
			coverNode
		}) : null,
		/* @__PURE__ */ jsxs("div", {
			className: c("articleBody"),
			children: [
				titleText ? /* @__PURE__ */ jsx("h3", {
					className: cx(c("articleTitle"), !hasCover && c("pinnedClearance")),
					children: titleText
				}) : null,
				excerptText ? /* @__PURE__ */ jsx("p", {
					className: c("articleExcerpt"),
					children: excerptText
				}) : null,
				/* @__PURE__ */ jsx(AuthorRow, {
					item,
					avatarSize: "sm"
				})
			]
		}),
		/* @__PURE__ */ jsx(StatsBar, {
			item,
			platform
		})
	] });
}
function SocialPostBody({ item, platform, coverNode, hideMedia }) {
	const bodyText = String(item.body || item.excerpt || item.title || "").trim();
	const hasMedia = !hideMedia && Boolean(item.coverUrl || coverNode);
	const mediaCount = item.mediaCount && item.mediaCount > 1 ? `1/${item.mediaCount}` : "";
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
		className: c("socialWrap"),
		children: [
			/* @__PURE__ */ jsx(AuthorRow, {
				item,
				avatarSize: "md",
				showHandleInline: true,
				className: c("pinnedClearance")
			}),
			bodyText ? /* @__PURE__ */ jsx("p", {
				className: cx(c("socialBodyText"), !hasMedia && c("socialBodyTextOnly")),
				children: bodyText
			}) : null,
			hasMedia ? /* @__PURE__ */ jsxs(CoverMedia, {
				item,
				platform,
				aspectClass: c("socialMediaInset"),
				coverNode,
				children: [mediaCount ? /* @__PURE__ */ jsx("span", {
					className: c("galleryPill"),
					children: mediaCount
				}) : null, item.isVideo ? /* @__PURE__ */ jsx("span", {
					className: c("videoPlayBadge"),
					"aria-hidden": "true",
					children: /* @__PURE__ */ jsx(PlayGlyph, { size: 13 })
				}) : null]
			}) : null
		]
	}), /* @__PURE__ */ jsx(StatsBar, {
		item,
		platform
	})] });
}
function ShortVideoBody({ item, platform, coverNode }) {
	const durationText = formatDuration(item.durationSec);
	const likes = formatCompactCount(item.metrics?.likes);
	const reposts = formatCompactCount(item.metrics?.reposts);
	const handle = item.author?.handle ? `@${String(item.author.handle).replace(/^@/, "")}` : item.author?.name || "";
	const caption = String(item.body || item.title || "").trim();
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs(CoverMedia, {
		item,
		platform,
		aspectClass: c("shortVideoStage"),
		coverNode,
		children: [
			durationText ? /* @__PURE__ */ jsx("span", {
				className: cx(c("durationPill"), c("shortVideoDuration")),
				children: durationText
			}) : null,
			/* @__PURE__ */ jsx("div", {
				className: c("shortVideoScrim"),
				"aria-hidden": "true"
			}),
			likes || reposts ? /* @__PURE__ */ jsxs("div", {
				className: c("shortVideoRightStats"),
				"aria-hidden": "true",
				children: [likes ? /* @__PURE__ */ jsxs("div", {
					className: c("shortVideoRightStat"),
					children: [/* @__PURE__ */ jsx(HeartGlyph, {}), /* @__PURE__ */ jsx("span", { children: likes })]
				}) : null, reposts ? /* @__PURE__ */ jsxs("div", {
					className: c("shortVideoRightStat"),
					children: [/* @__PURE__ */ jsx(RepostGlyph, {}), /* @__PURE__ */ jsx("span", { children: reposts })]
				}) : null]
			}) : null,
			handle || caption ? /* @__PURE__ */ jsxs("div", {
				className: c("shortVideoBottomCopy"),
				children: [handle ? /* @__PURE__ */ jsx("div", {
					className: c("shortVideoHandle"),
					children: handle
				}) : null, caption ? /* @__PURE__ */ jsx("p", {
					className: c("shortVideoCaption"),
					children: caption
				}) : null]
			}) : null
		]
	}), /* @__PURE__ */ jsxs("div", {
		className: c("shortVideoFooter"),
		children: [/* @__PURE__ */ jsx(AuthorRow, {
			item,
			avatarSize: "sm"
		}), /* @__PURE__ */ jsx(SocialPlatformMark, {
			platform,
			variant: "circle-badge",
			className: c("platformCircle"),
			size: 14
		})]
	})] });
}
function PhotoFeedBody({ item, platform, coverNode }) {
	const mediaCount = item.mediaCount && item.mediaCount > 1 ? `1/${item.mediaCount}` : "";
	const inlineHandle = String(item.author?.handle || item.author?.name || "").replace(/^@/, "").trim();
	const caption = String(item.body || item.title || "").trim();
	const likes = formatCompactCount(item.metrics?.likes);
	const views = formatCompactCount(item.metrics?.views);
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx("div", {
			className: cx(c("photoFeedHeader"), c("pinnedClearance")),
			children: /* @__PURE__ */ jsx(AuthorRow, {
				item,
				avatarSize: "sm"
			})
		}),
		/* @__PURE__ */ jsxs(CoverMedia, {
			item,
			platform,
			aspectClass: c("photoFeedMedia"),
			coverNode,
			children: [mediaCount ? /* @__PURE__ */ jsx("span", {
				className: c("galleryPill"),
				children: mediaCount
			}) : null, item.isVideo ? /* @__PURE__ */ jsx("span", {
				className: c("videoPlayBadge"),
				"aria-hidden": "true",
				children: /* @__PURE__ */ jsx(PlayGlyph, { size: 13 })
			}) : null]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: c("photoFeedBody"),
			children: [likes || views || item.outlierBadges?.length ? /* @__PURE__ */ jsxs("div", {
				className: c("statsLeft"),
				children: [
					likes ? /* @__PURE__ */ jsxs("span", {
						className: c("statItem"),
						children: [/* @__PURE__ */ jsx(HeartGlyph, {}), /* @__PURE__ */ jsx("span", { children: likes })]
					}) : null,
					views ? /* @__PURE__ */ jsxs("span", {
						className: c("statItem"),
						children: [/* @__PURE__ */ jsx(PlayGlyph, { size: 11 }), /* @__PURE__ */ jsx("span", { children: views })]
					}) : null,
					/* @__PURE__ */ jsx(OutlierBadges, { badges: item.outlierBadges })
				]
			}) : null, /* @__PURE__ */ jsxs("div", {
				className: c("photoFeedCaptionRow"),
				children: [/* @__PURE__ */ jsxs("p", {
					className: c("photoFeedCaption"),
					children: [inlineHandle ? /* @__PURE__ */ jsx("strong", {
						className: c("photoFeedHandle"),
						children: inlineHandle
					}) : null, caption]
				}), /* @__PURE__ */ jsx(SocialPlatformMark, {
					platform,
					className: c("platformMark"),
					size: 15
				})]
			})]
		})
	] });
}
function LandscapeVideoBody({ item, platform, coverNode }) {
	const durationText = formatDuration(item.durationSec);
	const titleText = String(item.title || item.body || "").trim();
	const channelName = String(item.author?.name || item.author?.handle || "").trim();
	const views = formatCompactCount(item.metrics?.views);
	const timeText = item.publishedLabel || "";
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(CoverMedia, {
		item,
		platform,
		aspectClass: c("landscapeCover"),
		coverNode,
		children: durationText ? /* @__PURE__ */ jsx("span", {
			className: cx(c("durationPill"), c("landscapeDuration")),
			children: durationText
		}) : null
	}), /* @__PURE__ */ jsxs("div", {
		className: c("landscapeFooter"),
		children: [/* @__PURE__ */ jsx(Avatar, {
			name: channelName,
			handle: item.author?.handle,
			avatarUrl: item.author?.avatarUrl,
			sizeClass: c("avatarLg")
		}), /* @__PURE__ */ jsxs("div", {
			className: c("landscapeCol"),
			children: [
				titleText ? /* @__PURE__ */ jsx("h3", {
					className: c("landscapeTitle"),
					children: titleText
				}) : null,
				channelName ? /* @__PURE__ */ jsx("span", {
					className: c("timeLabel"),
					children: channelName
				}) : null,
				/* @__PURE__ */ jsxs("div", {
					className: c("landscapeSubrow"),
					children: [/* @__PURE__ */ jsxs("div", {
						className: c("landscapeMetaPair"),
						children: [
							timeText ? /* @__PURE__ */ jsx("span", { children: timeText }) : null,
							views ? /* @__PURE__ */ jsx("span", { children: views }) : null,
							/* @__PURE__ */ jsx(OutlierBadges, { badges: item.outlierBadges })
						]
					}), /* @__PURE__ */ jsx(SocialPlatformMark, {
						platform,
						className: c("platformMark"),
						size: 15
					})]
				})
			]
		})]
	})] });
}
function WebLinkBody({ item, platform, coverNode, hideMedia }) {
	const [favFailed, setFavFailed] = useState(false);
	useEffect(() => {
		setFavFailed(false);
	}, [item.faviconUrl]);
	const titleText = String(item.title || item.body || item.hostname || item.sourceUrl || "").trim();
	const hostText = item.hostname || extractHostname(item.sourceUrl) || platform;
	return /* @__PURE__ */ jsxs(Fragment, { children: [!hideMedia ? /* @__PURE__ */ jsx(CoverMedia, {
		item,
		platform,
		aspectClass: c("webLinkCover"),
		coverNode
	}) : null, /* @__PURE__ */ jsxs("div", {
		className: c("webLinkBody"),
		children: [titleText ? /* @__PURE__ */ jsx("h3", {
			className: cx(c("webLinkTitle"), hideMedia && c("pinnedClearance")),
			children: titleText
		}) : null, /* @__PURE__ */ jsxs("div", {
			className: c("webLinkHostRow"),
			children: [item.faviconUrl && !favFailed ? /* @__PURE__ */ jsx("img", {
				src: item.faviconUrl,
				alt: "",
				className: c("faviconImg"),
				loading: "lazy",
				onError: () => setFavFailed(true)
			}) : /* @__PURE__ */ jsx(SocialPlatformMark, {
				platform: platform === "web" ? "web" : platform,
				size: 13,
				className: c("platformMark")
			}), /* @__PURE__ */ jsx("span", { children: hostText })]
		})]
	})] });
}
function RawMediaBody({ item, platform, coverNode }) {
	const durationText = formatDuration(item.durationSec);
	return /* @__PURE__ */ jsxs(CoverMedia, {
		item,
		platform,
		aspectClass: c("rawMediaFrame"),
		coverNode,
		children: [durationText ? /* @__PURE__ */ jsx("span", {
			className: cx(c("durationPill"), c("shortVideoDuration")),
			children: durationText
		}) : null, item.isVideo ? /* @__PURE__ */ jsx("span", {
			className: c("videoPlayBadge"),
			"aria-hidden": "true",
			children: /* @__PURE__ */ jsx(PlayGlyph, { size: 13 })
		}) : null]
	});
}
/** Semantic 6-archetype card for social posts, articles, videos, web links, and local media. */
const SocialPostCard = forwardRef(function SocialPostCard({ item, density = "default", selected = false, active = false, loading = false, menuOpen = false, hasPinnedTopRight = false, pinnedTopRightCount, topLeftSlot, topRightSlot, hoverActions, statusOverlay, coverNode, hideMedia = false, dataAttributes, className, onClick, onContextMenu, onKeyDown, ...rest }, ref) {
	const archetype = resolveSocialCardArchetype(item);
	const platform = normalizeSocialPlatform(item.platform, item.sourceUrl);
	const interactive = Boolean(onClick);
	const handleKeyDown = (event) => {
		onKeyDown?.(event);
		if (event.defaultPrevented || !interactive || event.target !== event.currentTarget) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onClick?.(event);
		}
	};
	const extraData = {};
	if (dataAttributes) {
		for (const [k, v] of Object.entries(dataAttributes)) if (v !== void 0) extraData[k] = v;
	}
	return /* @__PURE__ */ jsxs("article", {
		...rest,
		...extraData,
		ref,
		tabIndex: rest.tabIndex ?? (interactive ? 0 : void 0),
		"data-archetype": archetype,
		"data-platform": platform,
		"data-density": density,
		"data-interactive": interactive ? "true" : void 0,
		"data-selected": selected ? "true" : void 0,
		"data-active": active ? "true" : void 0,
		"data-loading": loading ? "true" : void 0,
		"data-menu-open": menuOpen ? "true" : void 0,
		"data-pinned-tr": hasPinnedTopRight ? "true" : void 0,
		"data-pinned-tr-multi": hasPinnedTopRight && (pinnedTopRightCount ?? 1) > 1 ? "true" : void 0,
		className: cx(c("card"), className),
		onClick,
		onContextMenu,
		onKeyDown: handleKeyDown,
		children: [
			topLeftSlot != null ? /* @__PURE__ */ jsx("div", {
				className: c("topLeft"),
				onClick: (e) => e.stopPropagation(),
				children: topLeftSlot
			}) : null,
			topRightSlot != null ? /* @__PURE__ */ jsx("div", {
				className: c("topRight"),
				onClick: (e) => e.stopPropagation(),
				children: topRightSlot
			}) : null,
			hoverActions != null ? /* @__PURE__ */ jsx("div", {
				className: c("hoverActions"),
				onClick: (e) => e.stopPropagation(),
				children: hoverActions
			}) : null,
			statusOverlay ?? null,
			archetype === "article" ? /* @__PURE__ */ jsx(ArticleBody, {
				item,
				platform,
				coverNode,
				hideMedia
			}) : archetype === "short-video" ? /* @__PURE__ */ jsx(ShortVideoBody, {
				item,
				platform,
				coverNode
			}) : archetype === "photo-feed" ? /* @__PURE__ */ jsx(PhotoFeedBody, {
				item,
				platform,
				coverNode
			}) : archetype === "landscape-video" ? /* @__PURE__ */ jsx(LandscapeVideoBody, {
				item,
				platform,
				coverNode
			}) : archetype === "web-link" ? /* @__PURE__ */ jsx(WebLinkBody, {
				item,
				platform,
				coverNode,
				hideMedia
			}) : archetype === "raw-media" ? /* @__PURE__ */ jsx(RawMediaBody, {
				item,
				platform,
				coverNode
			}) : /* @__PURE__ */ jsx(SocialPostBody, {
				item,
				platform,
				coverNode,
				hideMedia
			})
		]
	});
});
// \0dsh-ui-kit-css:src/social-card/MasonryGrid.module.css.mjs
injectCss("MasonryGrid.module.css", ".dshUk-MasonryGrid-root {\n  display: flex;\n  align-items: flex-start;\n  width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n}\n\n.dshUk-MasonryGrid-column {\n  display: flex;\n  flex-direction: column;\n  flex: 1 1 0;\n  min-width: 0;\n}\n");
var MasonryGrid_module_css_default = {
	"root": "dshUk-MasonryGrid-root",
	"column": "dshUk-MasonryGrid-column"
};
// src/social-card/MasonryGrid.tsx
/** Calculate responsive column count from measured container width. */
function computeMasonryColumnCount(containerWidth, { minColumnWidth = 236, minColumns = 1, maxColumns = 6, gap = 12, defaultColumns = 4 } = {}) {
	const lo = Math.max(1, Math.floor(minColumns));
	const hi = Math.max(lo, Math.floor(maxColumns));
	if (!Number.isFinite(containerWidth) || containerWidth <= 0) return Math.min(hi, Math.max(lo, Math.floor(defaultColumns)));
	const raw = Math.floor((containerWidth + gap) / (Math.max(120, minColumnWidth) + gap));
	return Math.min(hi, Math.max(lo, raw));
}
/**
* Distribute items across CSS flex columns while keeping prior assignments stable
* when paginated batches append to the end of the list.
*/
function distributeMasonryColumns(items, getKey, columnCount, previousAssignments, estimateWeight) {
	const safeCols = Math.max(1, Math.floor(columnCount));
	const columns = Array.from({ length: safeCols }, () => []);
	const weights = new Array(safeCols).fill(0);
	const assignments = /* @__PURE__ */ new Map();
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i];
		if (item === void 0) continue;
		const key = getKey(item, i);
		const weight = estimateWeight ? Math.max(.4, estimateWeight(item, i)) : 1;
		const cachedCol = previousAssignments?.get(key);
		let targetCol;
		if (cachedCol !== void 0 && cachedCol >= 0 && cachedCol < safeCols) targetCol = cachedCol;
		else {
			targetCol = 0;
			let minWeight = weights[0] ?? 0;
			for (let col = 1; col < safeCols; col += 1) {
				const w = weights[col] ?? 0;
				if (w < minWeight) {
					minWeight = w;
					targetCol = col;
				}
			}
		}
		columns[targetCol]?.push({
			item,
			index: i,
			column: targetCol
		});
		weights[targetCol] = (weights[targetCol] ?? 0) + weight;
		assignments.set(key, targetCol);
	}
	return {
		columns,
		assignments
	};
}
/**
* Natural CSS flex-column masonry layout. Avoids pixel height estimation overlap
* and preserves existing card column placements across pagination appends.
*/
function MasonryGrid({ items, getKey, renderItem, estimateWeight, minColumnWidth = 236, minColumns = 1, maxColumns = 6, gap = 12, defaultColumns = 4, resetKey, className, ariaLabel }) {
	const rootRef = useRef(null);
	const [columnCount, setColumnCount] = useState(() => computeMasonryColumnCount(0, {
		minColumnWidth,
		minColumns,
		maxColumns,
		gap,
		defaultColumns
	}));
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return void 0;
		const update = (width) => {
			const next = computeMasonryColumnCount(width, {
				minColumnWidth,
				minColumns,
				maxColumns,
				gap,
				defaultColumns
			});
			setColumnCount((prev) => prev === next ? prev : next);
		};
		const initialWidth = el.clientWidth || (typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect().width : 0);
		if (initialWidth > 0) update(initialWidth);
		if (typeof ResizeObserver === "undefined") return void 0;
		const observer = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect?.width;
			if (typeof w === "number" && w > 0) update(w);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [
		minColumnWidth,
		minColumns,
		maxColumns,
		gap,
		defaultColumns
	]);
	const cacheRef = useRef({
		scope: "",
		map: /* @__PURE__ */ new Map()
	});
	const scopeKey = `${String(resetKey ?? "")}::${columnCount}`;
	const { columns, assignments } = useMemo(() => {
		const prev = cacheRef.current.scope === scopeKey ? cacheRef.current.map : void 0;
		return distributeMasonryColumns(items, getKey, columnCount, prev, estimateWeight);
	}, [
		items,
		getKey,
		columnCount,
		scopeKey,
		estimateWeight
	]);
	useEffect(() => {
		cacheRef.current = {
			scope: scopeKey,
			map: assignments
		};
	}, [scopeKey, assignments]);
	const gapPx = `${Math.max(0, gap)}px`;
	return /* @__PURE__ */ jsx("div", {
		ref: rootRef,
		role: ariaLabel ? "region" : void 0,
		"aria-label": ariaLabel,
		"data-columns": columnCount,
		className: cx(cssClass(MasonryGrid_module_css_default.root, "root"), className),
		style: { gap: gapPx },
		children: columns.map((colEntries, colIdx) => /* @__PURE__ */ jsx("div", {
			className: cssClass(MasonryGrid_module_css_default.column, "column"),
			style: { gap: gapPx },
			children: colEntries.map((entry) => renderItem(entry.item, {
				index: entry.index,
				column: entry.column,
				columnCount
			}))
		}, colIdx))
	});
}
export { MasonryGrid, SocialPlatformMark, SocialPostCard, computeMasonryColumnCount, distributeMasonryColumns, estimateArchetypeWeight, extractHostname, formatCompactCount, formatDuration, normalizeSocialPlatform, resolveOutlierBadges, resolveSocialCardArchetype };

//# sourceMappingURL=social-card.js.map