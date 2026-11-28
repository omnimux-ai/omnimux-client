import { i as cssClass, n as injectCss, r as cx, t as IconSwap } from "./IconSwap-BbF3ZTXG.js";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
injectCss("SocialPostCard.module.css", ".dshUk-SocialPostCard-card {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n  border-radius: 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  background-color: var(--dsw-alias-card-fill);\n  color: var(--dsw-alias-label-primary);\n  overflow: hidden;\n  text-align: left;\n  transition: border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialPostCard-card[data-interactive=\"true\"] {\n  cursor: pointer;\n}\n\n.dshUk-SocialPostCard-card:hover {\n  border-color: var(--dsw-alias-border-l3);\n}\n\n.dshUk-SocialPostCard-card:focus {\n  outline: none;\n}\n\n.dshUk-SocialPostCard-card:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dshUk-SocialPostCard-card[data-selected=\"true\"],\n.dshUk-SocialPostCard-card[data-active=\"true\"] {\n  border-color: var(--dsw-alias-brand-primary);\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary);\n}\n\n/* Chrome overlay slots (selection, favorite/menu, hover CTAs) */\n.dshUk-SocialPostCard-topLeft {\n  position: absolute;\n  top: 8px;\n  left: 8px;\n  z-index: 6;\n  display: inline-flex;\n  align-items: center;\n  opacity: 0;\n  transition: opacity var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialPostCard-topRight {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  z-index: 6;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.dshUk-SocialPostCard-hoverActions {\n  position: absolute;\n  right: 8px;\n  bottom: 8px;\n  z-index: 5;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  opacity: 0;\n  transform: translateY(3px);\n  pointer-events: none;\n  transition:\n    opacity var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    transform var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialPostCard-card:hover .dshUk-SocialPostCard-topLeft,\n.dshUk-SocialPostCard-card:focus-within .dshUk-SocialPostCard-topLeft,\n.dshUk-SocialPostCard-card[data-selected=\"true\"] .dshUk-SocialPostCard-topLeft,\n.dshUk-SocialPostCard-card[data-menu-open=\"true\"] .dshUk-SocialPostCard-topLeft {\n  opacity: 1;\n}\n\n.dshUk-SocialPostCard-card:hover .dshUk-SocialPostCard-hoverActions,\n.dshUk-SocialPostCard-card:focus-within .dshUk-SocialPostCard-hoverActions {\n  opacity: 1;\n  transform: translateY(0);\n  pointer-events: auto;\n}\n\n@media (hover: none) {\n  .dshUk-SocialPostCard-topLeft {\n    opacity: 1;\n  }\n\n  .dshUk-SocialPostCard-hoverActions {\n    opacity: 1;\n    transform: none;\n    pointer-events: auto;\n  }\n}\n\n/* Pin-clearance when top-right carries persistent indicator(s) (favorite star / error badge) */\n.dshUk-SocialPostCard-card[data-pinned-tr=\"true\"] .dshUk-SocialPostCard-pinnedClearance {\n  padding-right: 36px;\n}\n\n.dshUk-SocialPostCard-card[data-pinned-tr-multi=\"true\"] .dshUk-SocialPostCard-pinnedClearance {\n  padding-right: 64px;\n}\n\n/* Shared sub-elements */\n.dshUk-SocialPostCard-avatar {\n  flex-shrink: 0;\n  border-radius: 9999px;\n  overflow: hidden;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l1);\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 600;\n  font-size: 12px;\n}\n\n.dshUk-SocialPostCard-avatarImg {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  display: block;\n}\n\n.dshUk-SocialPostCard-avatarSm {\n  width: 28px;\n  height: 28px;\n}\n\n.dshUk-SocialPostCard-avatarMd {\n  width: 32px;\n  height: 32px;\n}\n\n.dshUk-SocialPostCard-avatarLg {\n  width: 36px;\n  height: 36px;\n}\n\n.dshUk-SocialPostCard-authorRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.dshUk-SocialPostCard-authorMeta {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  min-width: 0;\n  flex: 1;\n}\n\n.dshUk-SocialPostCard-authorTop {\n  display: flex;\n  align-items: baseline;\n  gap: 5px;\n  min-width: 0;\n}\n\n.dshUk-SocialPostCard-authorName {\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 17px;\n  color: var(--dsw-alias-label-primary);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.dshUk-SocialPostCard-authorHandle {\n  font-size: 12.5px;\n  font-weight: 400;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.dshUk-SocialPostCard-timeLabel {\n  font-size: 12px;\n  line-height: 15px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshUk-SocialPostCard-statsBar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 0 12px 11px;\n  margin-top: auto;\n}\n\n.dshUk-SocialPostCard-statsLeft {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  min-width: 0;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-statItem {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 12px;\n  line-height: 16px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshUk-SocialPostCard-outlierBadge {\n  display: inline-flex;\n  align-items: center;\n  padding: 2px 6px;\n  border-radius: 6px;\n  font-size: 11px;\n  line-height: 15px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-outlierBlue {\n  background-color: var(--dsw-alias-state-business-tertiary);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.dshUk-SocialPostCard-outlierViolet {\n  background-color: color-mix(in srgb, var(--dsw-alias-state-done-primary) 16%, transparent);\n  color: var(--dsw-alias-state-done-primary);\n}\n\n.dshUk-SocialPostCard-outlierAmber {\n  background-color: var(--dsw-alias-state-warn-tertiary);\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.dshUk-SocialPostCard-outlierGreen {\n  background-color: var(--dsw-alias-state-success-tertiary);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.dshUk-SocialPostCard-platformMark {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshUk-SocialPostCard-platformCircle {\n  width: 24px;\n  height: 24px;\n  border-radius: 9999px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  background-color: var(--dsw-alias-brand-primary);\n  color: var(--dsw-alias-bg-base);\n}\n\n.dshUk-SocialPostCard-mediaBox {\n  position: relative;\n  width: 100%;\n  overflow: hidden;\n  background-color: var(--dsw-alias-bg-layer-2);\n}\n\n.dshUk-SocialPostCard-mediaImg {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.dshUk-SocialPostCard-mediaFallback {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 100%;\n  color: var(--dsw-alias-label-tertiary);\n  background-color: var(--dsw-alias-bg-layer-2);\n}\n\n.dshUk-SocialPostCard-durationPill {\n  position: absolute;\n  padding: 2px 6px;\n  border-radius: 5px;\n  background-color: color-mix(in srgb, var(--dsw-static-neutral-1000) 76%, transparent);\n  color: var(--dsw-static-neutral-00);\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 15px;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-galleryPill {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  padding: 2px 7px;\n  border-radius: 9999px;\n  background-color: color-mix(in srgb, var(--dsw-static-neutral-1000) 70%, transparent);\n  color: var(--dsw-static-neutral-00);\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 15px;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-videoPlayBadge {\n  position: absolute;\n  right: 10px;\n  bottom: 10px;\n  width: 30px;\n  height: 30px;\n  border-radius: 9999px;\n  background-color: color-mix(in srgb, var(--dsw-static-neutral-1000) 72%, transparent);\n  color: var(--dsw-static-neutral-00);\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n\n/* 1. Article archetype */\n.dshUk-SocialPostCard-articleCover {\n  aspect-ratio: 16 / 9;\n}\n\n.dshUk-SocialPostCard-articleBody {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 12px 12px 10px;\n}\n\n.dshUk-SocialPostCard-articleTitle {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 1.35;\n  color: var(--dsw-alias-label-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 3;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-articleTitle {\n  font-size: 14px;\n}\n\n.dshUk-SocialPostCard-articleExcerpt {\n  margin: 0;\n  font-size: 13px;\n  line-height: 1.45;\n  color: var(--dsw-alias-label-secondary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n/* 2. Social-post archetype */\n.dshUk-SocialPostCard-socialWrap {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px;\n}\n\n.dshUk-SocialPostCard-socialBodyText {\n  margin: 0;\n  font-size: 13.5px;\n  line-height: 1.48;\n  color: var(--dsw-alias-label-primary);\n  white-space: pre-line;\n  display: -webkit-box;\n  -webkit-line-clamp: 5;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n  user-select: text;\n}\n\n.dshUk-SocialPostCard-socialBodyTextOnly {\n  -webkit-line-clamp: 10;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-socialBodyText {\n  font-size: 13px;\n  -webkit-line-clamp: 4;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-socialBodyTextOnly {\n  -webkit-line-clamp: 6;\n}\n\n.dshUk-SocialPostCard-socialMediaInset {\n  border-radius: 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  aspect-ratio: 16 / 10;\n}\n\n/* 3. Short-video archetype */\n.dshUk-SocialPostCard-shortVideoStage {\n  position: relative;\n  width: 100%;\n  aspect-ratio: 5 / 8;\n  overflow: hidden;\n  background-color: var(--dsw-alias-bg-layer-3);\n}\n\n.dshUk-SocialPostCard-shortVideoDuration {\n  top: 8px;\n  left: 8px;\n}\n\n.dshUk-SocialPostCard-shortVideoScrim {\n  position: absolute;\n  inset: auto 0 0 0;\n  height: 46%;\n  background: linear-gradient(\n    180deg,\n    transparent 0%,\n    color-mix(in srgb, var(--dsw-static-neutral-1000) 82%, transparent) 100%\n  );\n  pointer-events: none;\n}\n\n.dshUk-SocialPostCard-shortVideoRightStats {\n  position: absolute;\n  right: 8px;\n  bottom: 52px;\n  z-index: 2;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 10px;\n  color: var(--dsw-static-neutral-00);\n  text-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-static-neutral-1000) 75%, transparent);\n  font-size: 11px;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshUk-SocialPostCard-shortVideoRightStat {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 2px;\n}\n\n.dshUk-SocialPostCard-shortVideoBottomCopy {\n  position: absolute;\n  left: 10px;\n  right: 42px;\n  bottom: 10px;\n  z-index: 2;\n  color: var(--dsw-static-neutral-00);\n  text-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-static-neutral-1000) 75%, transparent);\n}\n\n.dshUk-SocialPostCard-shortVideoHandle {\n  font-size: 12.5px;\n  font-weight: 600;\n  margin-bottom: 2px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.dshUk-SocialPostCard-shortVideoCaption {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.38;\n  color: color-mix(in srgb, var(--dsw-static-neutral-00) 92%, transparent);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-shortVideoFooter {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 10px 12px;\n  background-color: var(--dsw-alias-card-fill);\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n\n/* 4. Photo-feed archetype */\n.dshUk-SocialPostCard-photoFeedHeader {\n  padding: 10px 12px;\n}\n\n.dshUk-SocialPostCard-photoFeedMedia {\n  aspect-ratio: 4 / 5;\n}\n\n.dshUk-SocialPostCard-photoFeedBody {\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n  padding: 10px 12px 11px;\n}\n\n.dshUk-SocialPostCard-photoFeedCaptionRow {\n  display: flex;\n  align-items: flex-end;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.dshUk-SocialPostCard-photoFeedCaption {\n  margin: 0;\n  font-size: 12.5px;\n  line-height: 1.42;\n  color: var(--dsw-alias-label-secondary);\n  display: -webkit-box;\n  -webkit-line-clamp: 3;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n  user-select: text;\n}\n\n.dshUk-SocialPostCard-photoFeedHandle {\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n  margin-right: 5px;\n}\n\n/* 5. Landscape-video archetype */\n.dshUk-SocialPostCard-landscapeCover {\n  aspect-ratio: 16 / 9;\n}\n\n.dshUk-SocialPostCard-landscapeDuration {\n  right: 8px;\n  bottom: 8px;\n}\n\n.dshUk-SocialPostCard-landscapeFooter {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 10px 12px 12px;\n}\n\n.dshUk-SocialPostCard-landscapeCol {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n\n.dshUk-SocialPostCard-landscapeTitle {\n  margin: 0;\n  font-size: 13.5px;\n  font-weight: 600;\n  line-height: 1.35;\n  color: var(--dsw-alias-label-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-landscapeSubrow {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-top: 2px;\n}\n\n.dshUk-SocialPostCard-landscapeMetaPair {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 6. Web-link & raw-media archetypes */\n.dshUk-SocialPostCard-webLinkCover {\n  aspect-ratio: 16 / 9;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.dshUk-SocialPostCard-webLinkBody {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 12px 12px;\n}\n\n.dshUk-SocialPostCard-webLinkTitle {\n  margin: 0;\n  font-size: 13.5px;\n  font-weight: 600;\n  line-height: 1.36;\n  color: var(--dsw-alias-label-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n.dshUk-SocialPostCard-webLinkHostRow {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshUk-SocialPostCard-faviconImg {\n  width: 14px;\n  height: 14px;\n  border-radius: 3px;\n  object-fit: cover;\n  flex-shrink: 0;\n}\n\n.dshUk-SocialPostCard-rawMediaFrame {\n  aspect-ratio: 4 / 3;\n}\n\n/* Compact density refinements for chat conversation toolview */\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-articleBody {\n  padding: 10px 11px 8px;\n  gap: 6px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-socialWrap {\n  padding: 10px 11px;\n  gap: 8px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-shortVideoStage {\n  aspect-ratio: 3 / 4;\n  max-height: 360px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-shortVideoFooter {\n  padding: 9px 11px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-photoFeedHeader {\n  padding: 9px 11px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-photoFeedMedia {\n  aspect-ratio: 4 / 5;\n  max-height: 320px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-photoFeedBody {\n  padding: 9px 11px 10px;\n  gap: 6px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-landscapeFooter {\n  padding: 9px 11px 10px;\n  gap: 9px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-webLinkBody {\n  padding: 9px 11px 10px;\n}\n\n.dshUk-SocialPostCard-card[data-density=\"compact\"] .dshUk-SocialPostCard-statsBar {\n  padding: 0 11px 10px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshUk-SocialPostCard-card,\n  .dshUk-SocialPostCard-topLeft,\n  .dshUk-SocialPostCard-hoverActions {\n    transition: none;\n  }\n}\n");
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
const c$1 = (name) => cssClass(SocialPostCard_module_css_default[name], name);
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
		className: cx(c$1("avatar"), sizeClass),
		"aria-hidden": "true",
		children: avatarUrl && !failed ? /* @__PURE__ */ jsx("img", {
			src: avatarUrl,
			alt: "",
			className: c$1("avatarImg"),
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
	const sizeCls = avatarSize === "lg" ? c$1("avatarLg") : avatarSize === "md" ? c$1("avatarMd") : c$1("avatarSm");
	return /* @__PURE__ */ jsxs("div", {
		className: cx(c$1("authorRow"), className),
		children: [/* @__PURE__ */ jsx(Avatar, {
			name: authorName,
			handle: handleText,
			avatarUrl: item.author?.avatarUrl,
			sizeClass: sizeCls
		}), /* @__PURE__ */ jsxs("div", {
			className: c$1("authorMeta"),
			children: [/* @__PURE__ */ jsxs("div", {
				className: c$1("authorTop"),
				children: [/* @__PURE__ */ jsx("span", {
					className: c$1("authorName"),
					children: authorName || handleText
				}), showHandle ? /* @__PURE__ */ jsx("span", {
					className: c$1("authorHandle"),
					children: handleText
				}) : null]
			}), timeText ? /* @__PURE__ */ jsx("span", {
				className: c$1("timeLabel"),
				children: timeText
			}) : null]
		})]
	});
}
function OutlierBadges({ badges }) {
	if (!badges?.length) return null;
	return /* @__PURE__ */ jsx(Fragment, { children: badges.map((badge, idx) => {
		const toneCls = badge.tone === "amber" ? c$1("outlierAmber") : badge.tone === "violet" ? c$1("outlierViolet") : badge.tone === "green" ? c$1("outlierGreen") : c$1("outlierBlue");
		return /* @__PURE__ */ jsx("span", {
			className: cx(c$1("outlierBadge"), toneCls),
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
		className: c$1("statsBar"),
		children: [/* @__PURE__ */ jsxs("div", {
			className: c$1("statsLeft"),
			children: [
				likes ? /* @__PURE__ */ jsxs("span", {
					className: c$1("statItem"),
					children: [/* @__PURE__ */ jsx(HeartGlyph, {}), /* @__PURE__ */ jsx("span", { children: likes })]
				}) : null,
				reposts ? /* @__PURE__ */ jsxs("span", {
					className: c$1("statItem"),
					children: [/* @__PURE__ */ jsx(RepostGlyph, {}), /* @__PURE__ */ jsx("span", { children: reposts })]
				}) : null,
				views ? /* @__PURE__ */ jsxs("span", {
					className: c$1("statItem"),
					children: [/* @__PURE__ */ jsx(PlayGlyph, { size: 11 }), /* @__PURE__ */ jsx("span", { children: views })]
				}) : null,
				/* @__PURE__ */ jsx(OutlierBadges, { badges: item.outlierBadges })
			]
		}), !hidePlatformMark ? /* @__PURE__ */ jsx(SocialPlatformMark, {
			platform,
			className: c$1("platformMark"),
			size: 15
		}) : null]
	});
}
function CoverMedia({ item, platform, aspectClass, coverNode, children }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setFailed(false);
	}, [item.coverUrl]);
	const inlineStyle = !item.coverAspectRatio || aspectClass === c$1("articleCover") || aspectClass === c$1("landscapeCover") || aspectClass === c$1("webLinkCover") ? void 0 : { aspectRatio: String(Math.max(.55, Math.min(1.91, item.coverAspectRatio))) };
	return /* @__PURE__ */ jsxs("div", {
		className: cx(c$1("mediaBox"), aspectClass),
		style: inlineStyle,
		children: [coverNode != null ? coverNode : item.coverUrl && !failed ? /* @__PURE__ */ jsx("img", {
			src: item.coverUrl,
			alt: item.coverAlt || item.title || "",
			className: c$1("mediaImg"),
			loading: "lazy",
			onError: () => setFailed(true)
		}) : /* @__PURE__ */ jsx("div", {
			className: c$1("mediaFallback"),
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
			aspectClass: c$1("articleCover"),
			coverNode
		}) : null,
		/* @__PURE__ */ jsxs("div", {
			className: c$1("articleBody"),
			children: [
				titleText ? /* @__PURE__ */ jsx("h3", {
					className: cx(c$1("articleTitle"), !hasCover && c$1("pinnedClearance")),
					children: titleText
				}) : null,
				excerptText ? /* @__PURE__ */ jsx("p", {
					className: c$1("articleExcerpt"),
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
		className: c$1("socialWrap"),
		children: [
			/* @__PURE__ */ jsx(AuthorRow, {
				item,
				avatarSize: "md",
				showHandleInline: true,
				className: c$1("pinnedClearance")
			}),
			bodyText ? /* @__PURE__ */ jsx("p", {
				className: cx(c$1("socialBodyText"), !hasMedia && c$1("socialBodyTextOnly")),
				children: bodyText
			}) : null,
			hasMedia ? /* @__PURE__ */ jsxs(CoverMedia, {
				item,
				platform,
				aspectClass: c$1("socialMediaInset"),
				coverNode,
				children: [mediaCount ? /* @__PURE__ */ jsx("span", {
					className: c$1("galleryPill"),
					children: mediaCount
				}) : null, item.isVideo ? /* @__PURE__ */ jsx("span", {
					className: c$1("videoPlayBadge"),
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
		aspectClass: c$1("shortVideoStage"),
		coverNode,
		children: [
			durationText ? /* @__PURE__ */ jsx("span", {
				className: cx(c$1("durationPill"), c$1("shortVideoDuration")),
				children: durationText
			}) : null,
			/* @__PURE__ */ jsx("div", {
				className: c$1("shortVideoScrim"),
				"aria-hidden": "true"
			}),
			likes || reposts ? /* @__PURE__ */ jsxs("div", {
				className: c$1("shortVideoRightStats"),
				"aria-hidden": "true",
				children: [likes ? /* @__PURE__ */ jsxs("div", {
					className: c$1("shortVideoRightStat"),
					children: [/* @__PURE__ */ jsx(HeartGlyph, {}), /* @__PURE__ */ jsx("span", { children: likes })]
				}) : null, reposts ? /* @__PURE__ */ jsxs("div", {
					className: c$1("shortVideoRightStat"),
					children: [/* @__PURE__ */ jsx(RepostGlyph, {}), /* @__PURE__ */ jsx("span", { children: reposts })]
				}) : null]
			}) : null,
			handle || caption ? /* @__PURE__ */ jsxs("div", {
				className: c$1("shortVideoBottomCopy"),
				children: [handle ? /* @__PURE__ */ jsx("div", {
					className: c$1("shortVideoHandle"),
					children: handle
				}) : null, caption ? /* @__PURE__ */ jsx("p", {
					className: c$1("shortVideoCaption"),
					children: caption
				}) : null]
			}) : null
		]
	}), /* @__PURE__ */ jsxs("div", {
		className: c$1("shortVideoFooter"),
		children: [/* @__PURE__ */ jsx(AuthorRow, {
			item,
			avatarSize: "sm"
		}), /* @__PURE__ */ jsx(SocialPlatformMark, {
			platform,
			variant: "circle-badge",
			className: c$1("platformCircle"),
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
			className: cx(c$1("photoFeedHeader"), c$1("pinnedClearance")),
			children: /* @__PURE__ */ jsx(AuthorRow, {
				item,
				avatarSize: "sm"
			})
		}),
		/* @__PURE__ */ jsxs(CoverMedia, {
			item,
			platform,
			aspectClass: c$1("photoFeedMedia"),
			coverNode,
			children: [mediaCount ? /* @__PURE__ */ jsx("span", {
				className: c$1("galleryPill"),
				children: mediaCount
			}) : null, item.isVideo ? /* @__PURE__ */ jsx("span", {
				className: c$1("videoPlayBadge"),
				"aria-hidden": "true",
				children: /* @__PURE__ */ jsx(PlayGlyph, { size: 13 })
			}) : null]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: c$1("photoFeedBody"),
			children: [likes || views || item.outlierBadges?.length ? /* @__PURE__ */ jsxs("div", {
				className: c$1("statsLeft"),
				children: [
					likes ? /* @__PURE__ */ jsxs("span", {
						className: c$1("statItem"),
						children: [/* @__PURE__ */ jsx(HeartGlyph, {}), /* @__PURE__ */ jsx("span", { children: likes })]
					}) : null,
					views ? /* @__PURE__ */ jsxs("span", {
						className: c$1("statItem"),
						children: [/* @__PURE__ */ jsx(PlayGlyph, { size: 11 }), /* @__PURE__ */ jsx("span", { children: views })]
					}) : null,
					/* @__PURE__ */ jsx(OutlierBadges, { badges: item.outlierBadges })
				]
			}) : null, /* @__PURE__ */ jsxs("div", {
				className: c$1("photoFeedCaptionRow"),
				children: [/* @__PURE__ */ jsxs("p", {
					className: c$1("photoFeedCaption"),
					children: [inlineHandle ? /* @__PURE__ */ jsx("strong", {
						className: c$1("photoFeedHandle"),
						children: inlineHandle
					}) : null, caption]
				}), /* @__PURE__ */ jsx(SocialPlatformMark, {
					platform,
					className: c$1("platformMark"),
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
		aspectClass: c$1("landscapeCover"),
		coverNode,
		children: durationText ? /* @__PURE__ */ jsx("span", {
			className: cx(c$1("durationPill"), c$1("landscapeDuration")),
			children: durationText
		}) : null
	}), /* @__PURE__ */ jsxs("div", {
		className: c$1("landscapeFooter"),
		children: [/* @__PURE__ */ jsx(Avatar, {
			name: channelName,
			handle: item.author?.handle,
			avatarUrl: item.author?.avatarUrl,
			sizeClass: c$1("avatarLg")
		}), /* @__PURE__ */ jsxs("div", {
			className: c$1("landscapeCol"),
			children: [
				titleText ? /* @__PURE__ */ jsx("h3", {
					className: c$1("landscapeTitle"),
					children: titleText
				}) : null,
				channelName ? /* @__PURE__ */ jsx("span", {
					className: c$1("timeLabel"),
					children: channelName
				}) : null,
				/* @__PURE__ */ jsxs("div", {
					className: c$1("landscapeSubrow"),
					children: [/* @__PURE__ */ jsxs("div", {
						className: c$1("landscapeMetaPair"),
						children: [
							timeText ? /* @__PURE__ */ jsx("span", { children: timeText }) : null,
							views ? /* @__PURE__ */ jsx("span", { children: views }) : null,
							/* @__PURE__ */ jsx(OutlierBadges, { badges: item.outlierBadges })
						]
					}), /* @__PURE__ */ jsx(SocialPlatformMark, {
						platform,
						className: c$1("platformMark"),
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
		aspectClass: c$1("webLinkCover"),
		coverNode
	}) : null, /* @__PURE__ */ jsxs("div", {
		className: c$1("webLinkBody"),
		children: [titleText ? /* @__PURE__ */ jsx("h3", {
			className: cx(c$1("webLinkTitle"), hideMedia && c$1("pinnedClearance")),
			children: titleText
		}) : null, /* @__PURE__ */ jsxs("div", {
			className: c$1("webLinkHostRow"),
			children: [item.faviconUrl && !favFailed ? /* @__PURE__ */ jsx("img", {
				src: item.faviconUrl,
				alt: "",
				className: c$1("faviconImg"),
				loading: "lazy",
				onError: () => setFavFailed(true)
			}) : /* @__PURE__ */ jsx(SocialPlatformMark, {
				platform: platform === "web" ? "web" : platform,
				size: 13,
				className: c$1("platformMark")
			}), /* @__PURE__ */ jsx("span", { children: hostText })]
		})]
	})] });
}
function RawMediaBody({ item, platform, coverNode }) {
	const durationText = formatDuration(item.durationSec);
	return /* @__PURE__ */ jsxs(CoverMedia, {
		item,
		platform,
		aspectClass: c$1("rawMediaFrame"),
		coverNode,
		children: [durationText ? /* @__PURE__ */ jsx("span", {
			className: cx(c$1("durationPill"), c$1("shortVideoDuration")),
			children: durationText
		}) : null, item.isVideo ? /* @__PURE__ */ jsx("span", {
			className: c$1("videoPlayBadge"),
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
		className: cx(c$1("card"), className),
		onClick,
		onContextMenu,
		onKeyDown: handleKeyDown,
		children: [
			topLeftSlot != null ? /* @__PURE__ */ jsx("div", {
				className: c$1("topLeft"),
				onClick: (e) => e.stopPropagation(),
				children: topLeftSlot
			}) : null,
			topRightSlot != null ? /* @__PURE__ */ jsx("div", {
				className: c$1("topRight"),
				onClick: (e) => e.stopPropagation(),
				children: topRightSlot
			}) : null,
			hoverActions != null ? /* @__PURE__ */ jsx("div", {
				className: c$1("hoverActions"),
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
// \0dsh-ui-kit-css:src/social-card/SocialSearchToolView.module.css.mjs
injectCss("SocialSearchToolView.module.css", ".dshUk-SocialSearchToolView-root,\n.dshUk-SocialSearchToolView-root * {\n  box-sizing: border-box;\n}\n\n.dshUk-SocialSearchToolView-root {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  width: 100%;\n  min-width: 0;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshUk-SocialSearchToolView-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-height: 28px;\n  min-width: 0;\n}\n\n.dshUk-SocialSearchToolView-headerLeft {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  flex: 1;\n}\n\n.dshUk-SocialSearchToolView-headerTrigger {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  max-width: 100%;\n  padding: 2px 6px;\n  margin: -2px -6px;\n  border: none;\n  border-radius: var(--dsw-radius-sm, 6px);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  line-height: 20px;\n  text-align: left;\n  cursor: pointer;\n  transition:\n    background-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialSearchToolView-headerTrigger[data-static=\"true\"] {\n  cursor: default;\n}\n\n.dshUk-SocialSearchToolView-headerTrigger:not([data-static=\"true\"]):hover {\n  background-color: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshUk-SocialSearchToolView-headerTrigger:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n.dshUk-SocialSearchToolView-headerIcon {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 16px;\n  height: 16px;\n  flex-shrink: 0;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n@keyframes stvPulse {\n  0%,\n  100% {\n    opacity: 0.4;\n    transform: scale(0.9);\n  }\n  50% {\n    opacity: 1;\n    transform: scale(1.06);\n  }\n}\n\n.dshUk-SocialSearchToolView-runningDot {\n  width: 7px;\n  height: 7px;\n  border-radius: 9999px;\n  background-color: var(--dsw-alias-brand-primary);\n  animation: stvPulse 1.1s ease-in-out infinite;\n}\n\n.dshUk-SocialSearchToolView-title {\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  flex-shrink: 0;\n}\n\n.dshUk-SocialSearchToolView-headerTrigger[data-error=\"true\"] .dshUk-SocialSearchToolView-title {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshUk-SocialSearchToolView-headerTrigger:not([data-static=\"true\"]):hover .dshUk-SocialSearchToolView-title {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshUk-SocialSearchToolView-query {\n  color: var(--dsw-alias-label-tertiary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 0;\n}\n\n.dshUk-SocialSearchToolView-countPill {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 1px 8px;\n  border-radius: 9999px;\n  background-color: var(--dsw-alias-bg-layer-2);\n  border: 1px solid var(--dsw-alias-border-l1);\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 16px;\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n  flex-shrink: 0;\n}\n\n.dshUk-SocialSearchToolView-chevron {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  color: var(--dsw-alias-label-tertiary);\n  transition: transform var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialSearchToolView-chevron[data-open=\"false\"] {\n  transform: rotate(-90deg);\n}\n\n.dshUk-SocialSearchToolView-headerActions {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  flex-shrink: 0;\n}\n\n.dshUk-SocialSearchToolView-headerActionBtn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  height: 24px;\n  padding: 0 7px;\n  border-radius: var(--dsw-radius-sm, 6px);\n  border: 1px solid transparent;\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  font-family: var(--ds-font-family-code, monospace);\n  font-size: 11px;\n  line-height: 16px;\n  cursor: pointer;\n  transition:\n    background-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    border-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialSearchToolView-headerActionBtn:active:not(:disabled) {\n  transform: scale(var(--omx-press-scale, 0.96));\n}\n\n.dshUk-SocialSearchToolView-headerActionBtn:hover,\n.dshUk-SocialSearchToolView-headerActionBtn[aria-expanded=\"true\"] {\n  background-color: var(--dsw-alias-bg-layer-2);\n  border-color: var(--dsw-alias-border-l1);\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshUk-SocialSearchToolView-headerActionBtn:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n.dshUk-SocialSearchToolView-gridSingle {\n  max-width: 380px;\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn {\n  width: 26px;\n  height: 26px;\n  border-radius: 7px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  background-color: var(--dsw-alias-card-fill);\n  color: var(--dsw-alias-label-secondary);\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 0;\n  cursor: pointer;\n  transition:\n    background-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    border-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn:active:not(:disabled) {\n  transform: scale(var(--omx-press-scale, 0.96));\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn:hover:not(:disabled) {\n  background-color: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n  border-color: var(--dsw-alias-border-l3);\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn[data-save-state=\"saved\"] {\n  background-color: var(--dsw-alias-state-success-tertiary);\n  color: var(--dsw-alias-state-success-primary);\n  border-color: transparent;\n  cursor: default;\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn[data-save-state=\"error\"] {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshUk-SocialSearchToolView-hoverPillBtn[data-save-state=\"saving\"] {\n  opacity: 0.7;\n  cursor: progress;\n}\n\n.dshUk-SocialSearchToolView-showMoreBtn {\n  align-self: flex-start;\n  height: 28px;\n  padding: 0 12px;\n  border-radius: var(--dsw-radius-md, 8px);\n  border: 1px solid var(--dsw-alias-border-l2);\n  background-color: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 12px;\n  font-weight: 500;\n  line-height: 16px;\n  cursor: pointer;\n  transition:\n    background-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    border-color var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-SocialSearchToolView-showMoreBtn:active:not(:disabled) {\n  transform: scale(var(--omx-press-scale, 0.96));\n}\n\n.dshUk-SocialSearchToolView-showMoreBtn:hover {\n  background-color: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n  border-color: var(--dsw-alias-border-l3);\n}\n\n.dshUk-SocialSearchToolView-showMoreBtn:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 1px;\n}\n\n.dshUk-SocialSearchToolView-rawOutputBox {\n  margin: 0;\n  padding: 10px 12px;\n  border-radius: var(--dsw-radius-md, 10px);\n  border: 1px solid var(--dsw-alias-border-l2);\n  background-color: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-secondary);\n  font-family: var(--ds-font-family-code, monospace);\n  font-size: 11px;\n  line-height: 1.48;\n  max-height: 240px;\n  overflow: auto;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n.dshUk-SocialSearchToolView-errorBox {\n  padding: 9px 12px;\n  border-radius: var(--dsw-radius-md, 10px);\n  border: 1px solid var(--dsw-alias-border-l2);\n  background-color: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12px;\n  line-height: 1.45;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n@keyframes stvPulseReduced {\n  0%,\n  100% {\n    opacity: 0.4;\n  }\n  50% {\n    opacity: 1;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshUk-SocialSearchToolView-runningDot {\n    animation: stvPulseReduced 1.6s ease-in-out infinite;\n  }\n\n  .dshUk-SocialSearchToolView-headerTrigger,\n  .dshUk-SocialSearchToolView-chevron,\n  .dshUk-SocialSearchToolView-headerActionBtn,\n  .dshUk-SocialSearchToolView-hoverPillBtn,\n  .dshUk-SocialSearchToolView-showMoreBtn {\n    transition: none;\n  }\n\n  .dshUk-SocialSearchToolView-headerActionBtn:active:not(:disabled),\n  .dshUk-SocialSearchToolView-hoverPillBtn:active:not(:disabled),\n  .dshUk-SocialSearchToolView-showMoreBtn:active:not(:disabled) {\n    transform: none;\n  }\n}\n");
var SocialSearchToolView_module_css_default = {
	"root": "dshUk-SocialSearchToolView-root",
	"header": "dshUk-SocialSearchToolView-header",
	"headerLeft": "dshUk-SocialSearchToolView-headerLeft",
	"headerTrigger": "dshUk-SocialSearchToolView-headerTrigger",
	"headerIcon": "dshUk-SocialSearchToolView-headerIcon",
	"runningDot": "dshUk-SocialSearchToolView-runningDot",
	"title": "dshUk-SocialSearchToolView-title",
	"query": "dshUk-SocialSearchToolView-query",
	"countPill": "dshUk-SocialSearchToolView-countPill",
	"chevron": "dshUk-SocialSearchToolView-chevron",
	"headerActions": "dshUk-SocialSearchToolView-headerActions",
	"headerActionBtn": "dshUk-SocialSearchToolView-headerActionBtn",
	"gridSingle": "dshUk-SocialSearchToolView-gridSingle",
	"hoverPillBtn": "dshUk-SocialSearchToolView-hoverPillBtn",
	"showMoreBtn": "dshUk-SocialSearchToolView-showMoreBtn",
	"rawOutputBox": "dshUk-SocialSearchToolView-rawOutputBox",
	"errorBox": "dshUk-SocialSearchToolView-errorBox"
};
// src/social-card/toolview-parser.ts
const POST_CAPABILITIES = /* @__PURE__ */ new Set([
	"search",
	"posts",
	"tweet",
	"post",
	"video",
	"creator_search_videos"
]);
const TOOL_PLATFORM_HINTS = {
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
	omnimux_youtube_video: "youtube"
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
	"data"
];
const WRAPPER_CONTAINERS = [
	"data",
	"result",
	"feed",
	"payload",
	"aweme_data"
];
const SINGLE_POST_CONTAINERS = [
	"item",
	"post",
	"aweme_detail",
	"aweme_info",
	"tweet",
	"video"
];
const SITE_MEDIA_PREFIXES = [
	"https://omnimux.ai/api/inspiration/v1/media/",
	"https://www.omnimux.ai/api/inspiration/v1/media/",
	"/api/inspiration/v1/media/"
];
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function firstNonEmptyString(values) {
	for (const val of values) if (typeof val === "string") {
		const trimmed = val.trim();
		if (trimmed) return trimmed;
	} else if (typeof val === "number" && Number.isFinite(val)) return String(val);
	return "";
}
function asFiniteNumber(value) {
	if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : void 0;
	if (typeof value === "string") {
		const cleaned = value.trim().replace(/,/g, "").replace(/\s*(?:views?|plays?|次观看|次播放)\s*$/i, "");
		if (!cleaned) return void 0;
		const compactMatch = /^(\d+(?:\.\d+)?)\s*([kmb])$/i.exec(cleaned);
		if (compactMatch && compactMatch[1] && compactMatch[2]) {
			const base = Number(compactMatch[1]);
			if (!Number.isFinite(base)) return void 0;
			const unit = compactMatch[2].toUpperCase();
			return Math.round(base * (unit === "B" ? 1e9 : unit === "M" ? 1e6 : 1e3));
		}
		const parsed = Number(cleaned);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
	}
}
/** Validate that an external post link strictly uses `http:` or `https:`. */
function isSafeHttpUrl(value) {
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
const ALLOWED_LOCAL_MEDIA_PREFIXES = ["/omnimux/inspiration/media/", "/omnimux/inspiration/local/media/"];
/** Validate media/image sources: public `http(s):` or safe same-origin `/omnimux/inspiration/(local/)?media/*` route. */
function isSafeMediaSrc(value) {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (!trimmed || /[\u0000-\u001f\u007f\\?#]/.test(trimmed)) return false;
	if (trimmed.startsWith("/")) {
		const matchedPrefix = ALLOWED_LOCAL_MEDIA_PREFIXES.find((prefix) => trimmed.startsWith(prefix));
		if (!matchedPrefix) return false;
		const suffix = trimmed.slice(matchedPrefix.length);
		if (!suffix || /(?:%2e|%2f|%5c)/i.test(suffix)) return false;
		let decoded = suffix;
		try {
			decoded = decodeURIComponent(suffix);
		} catch {
			return false;
		}
		if (/[\u0000-\u001f\u007f\\?#]/.test(decoded)) return false;
		const hasCleanSegments = (rawPath) => rawPath.split("/").every((seg) => Boolean(seg) && seg !== "." && seg !== "..");
		return hasCleanSegments(suffix) && hasCleanSegments(decoded);
	}
	return isSafeHttpUrl(trimmed);
}
function sanitizeHttpUrl(values) {
	for (const val of values) if (isSafeHttpUrl(val)) return String(val).trim();
}
function sanitizeMediaUrl(values) {
	for (const val of values) {
		if (typeof val !== "string") continue;
		let candidate = val.trim();
		if (!candidate) continue;
		for (const prefix of SITE_MEDIA_PREFIXES) if (candidate.startsWith(prefix)) {
			candidate = `/omnimux/inspiration/media/${candidate.slice(prefix.length)}`;
			break;
		}
		if (isSafeMediaSrc(candidate)) return candidate;
	}
}
/** Format an ISO timestamp or epoch seconds/ms into concise relative labels without middle dots. */
function formatSocialRelativeTime(isoOrEpoch, locale = "zh", nowMs = Date.now()) {
	if (isoOrEpoch === null || isoOrEpoch === void 0 || isoOrEpoch === "") return void 0;
	let ts = null;
	if (typeof isoOrEpoch === "number" && Number.isFinite(isoOrEpoch) && isoOrEpoch > 0) ts = isoOrEpoch < 1e11 ? isoOrEpoch * 1e3 : isoOrEpoch;
	else if (typeof isoOrEpoch === "string") {
		const trimmed = isoOrEpoch.trim();
		if (!trimmed) return void 0;
		if (/^\d{9,16}$/.test(trimmed)) {
			const n = Number(trimmed);
			if (Number.isFinite(n) && n > 0) ts = n < 1e11 ? n * 1e3 : n;
		} else {
			const parsed = Date.parse(trimmed);
			if (Number.isFinite(parsed) && parsed > 0) ts = parsed;
			else {
				if (trimmed.length <= 24) return trimmed;
				return;
			}
		}
	}
	if (ts === null || !Number.isFinite(ts)) return void 0;
	const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1e3));
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
function parseDurationText(raw) {
	const direct = asFiniteNumber(raw);
	if (direct !== void 0) return direct > 0 ? direct : void 0;
	if (typeof raw !== "string") return void 0;
	const parts = raw.trim().split(":").map((p) => Number(p));
	if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return;
	if (parts.length === 2 && parts[0] !== void 0 && parts[1] !== void 0) return parts[0] * 60 + parts[1];
	if (parts.length === 3 && parts[0] !== void 0 && parts[1] !== void 0 && parts[2] !== void 0) return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function parseArgsObject(raw) {
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		return asRecord(JSON.parse(raw)) ?? {};
	} catch {
		return {};
	}
}
function extractQuerySummary(args, root) {
	return firstNonEmptyString([
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
		root?.query
	]) || void 0;
}
function extractContentText(content) {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const part of content) {
		if (typeof part === "string" && part.trim()) {
			parts.push(part.trim());
			continue;
		}
		const rec = asRecord(part);
		if (rec && rec.type === "text" && typeof rec.text === "string" && rec.text.trim()) parts.push(rec.text.trim());
	}
	return parts.join("\n").trim();
}
function tryParseJson(raw) {
	if (!raw) return void 0;
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return void 0;
	try {
		return JSON.parse(trimmed);
	} catch {
		return;
	}
}
function decodeBasicEntities(text) {
	return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}
function textFromRuns(value) {
	if (typeof value === "string") return value.trim();
	const rec = asRecord(value);
	if (!rec) return "";
	if (typeof rec.simpleText === "string") return rec.simpleText.trim();
	if (typeof rec.text === "string") return rec.text.trim();
	if (Array.isArray(rec.runs)) return rec.runs.map((r) => typeof asRecord(r)?.text === "string" ? String(asRecord(r)?.text) : "").join("").trim();
	return "";
}
function urlListFirst(value) {
	if (!value) return void 0;
	if (Array.isArray(value)) {
		for (const entry of value) if (typeof entry === "string") {
			const clean = sanitizeMediaUrl([entry]);
			if (clean) return clean;
		} else {
			const rec = asRecord(entry);
			const clean = sanitizeMediaUrl([rec?.url, rec?.src]);
			if (clean) return clean;
		}
		return;
	}
	const rec = asRecord(value);
	if (rec && Array.isArray(rec.url_list)) return urlListFirst(rec.url_list);
	return sanitizeMediaUrl([rec?.url]);
}
function synthesizedPostUrl(platform, rawId) {
	const id = rawId.trim();
	if (!id) return void 0;
	if (platform === "x" && /^\d{5,}$/.test(id)) return `https://x.com/i/status/${id}`;
	if (platform === "tiktok" && /^\d{15,25}$/.test(id)) return `https://www.tiktok.com/video/${id}`;
	if (platform === "youtube" && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
	if (platform === "instagram" && /^[A-Za-z0-9_-]{5,}$/.test(id) && !/^\d+$/.test(id)) return `https://www.instagram.com/p/${id}`;
}
function unwrapRendererEntry(entry) {
	const rec = asRecord(entry);
	if (!rec) return null;
	if (asRecord(rec.node)) return asRecord(rec.node);
	if (asRecord(rec.aweme_info)) return asRecord(rec.aweme_info);
	if (asRecord(rec.videoRenderer)) return asRecord(rec.videoRenderer);
	if (asRecord(rec.compactVideoRenderer)) return asRecord(rec.compactVideoRenderer);
	if (asRecord(rec.gridVideoRenderer)) return asRecord(rec.gridVideoRenderer);
	const richContent = asRecord(asRecord(rec.richItemRenderer)?.content);
	if (richContent && asRecord(richContent.videoRenderer)) return asRecord(richContent.videoRenderer);
	if (asRecord(rec.item) && !rec.id && !rec.aweme_id && !rec.id_str) return asRecord(rec.item);
	return rec;
}
function isPostListContainer(obj) {
	if (obj.id_str || obj.aweme_id || obj.shortcode || obj.shortCode || obj.videoId) return false;
	return LIST_CONTAINERS.some((k) => Array.isArray(obj[k]));
}
function hasLooksLikePostRow(row) {
	return Boolean(row.id || row.id_str || row.post_id || row.aweme_id || row.tweet_id || row.rest_id || row.shortcode || row.shortCode || row.videoId || row.source_url || row.url || row.share_url || row.cover_url || row.cover_http_url || row.article || row.caption || row.video || row.mediaDetails || row.image_versions2 || row.content || row.text || row.desc || row.full_text || row.title);
}
function extractPostRows(payload) {
	if (Array.isArray(payload)) {
		if (payload.length === 0) return {
			rows: [],
			foundListContainer: true
		};
		const rows = payload.map(unwrapRendererEntry).filter((r) => r !== null && hasLooksLikePostRow(r));
		return {
			rows,
			foundListContainer: rows.length > 0
		};
	}
	const root = asRecord(payload);
	if (!root) return {
		rows: [],
		foundListContainer: false
	};
	const containerAccount = asRecord(root.account);
	const probeContainer = (obj) => {
		for (const listKey of LIST_CONTAINERS) {
			const candidate = obj[listKey];
			if (Array.isArray(candidate)) {
				const mapped = candidate.map(unwrapRendererEntry).filter((r) => Boolean(r));
				if (mapped.length > 0) return {
					rows: mapped,
					foundListContainer: true
				};
			}
			const nestedObj = asRecord(candidate);
			if (nestedObj && Array.isArray(nestedObj.edges)) {
				const mapped = nestedObj.edges.map(unwrapRendererEntry).filter((r) => Boolean(r));
				if (mapped.length > 0) return {
					rows: mapped,
					foundListContainer: true
				};
			}
		}
		return null;
	};
	const direct = probeContainer(root);
	if (direct) return {
		...direct,
		containerAccount
	};
	for (const wrapKey of WRAPPER_CONTAINERS) {
		const wrapped = asRecord(root[wrapKey]);
		if (!wrapped) continue;
		const nested = probeContainer(wrapped);
		if (nested) return {
			...nested,
			containerAccount: asRecord(wrapped.account) ?? containerAccount
		};
	}
	if (LIST_CONTAINERS.some((k) => Array.isArray(root[k]) && root[k].length === 0) || WRAPPER_CONTAINERS.some((wk) => {
		const w = asRecord(root[wk]);
		return Boolean(w && LIST_CONTAINERS.some((k) => Array.isArray(w[k]) && w[k].length === 0));
	})) return {
		rows: [],
		foundListContainer: true,
		containerAccount
	};
	if ((Array.isArray(root.users) || Array.isArray(root.hashtags) || Array.isArray(root.places)) && !hasLooksLikePostRow(root)) return {
		rows: [],
		foundListContainer: false,
		containerAccount
	};
	for (const singleKey of SINGLE_POST_CONTAINERS) {
		const single = asRecord(root[singleKey]);
		if (single && hasLooksLikePostRow(single)) return {
			rows: [single],
			foundListContainer: false,
			containerAccount
		};
	}
	if (!isPostListContainer(root) && hasLooksLikePostRow(root)) return {
		rows: [root],
		foundListContainer: false,
		containerAccount
	};
	return {
		rows: [],
		foundListContainer: false,
		containerAccount
	};
}
function mapRawRowToSocialItem(row, index, options) {
	const { platformHint, toolName, locale, nowMs, containerAccount } = options;
	const validYoutubeVideoId = typeof row.videoId === "string" && /^[\w-]{11}$/.test(row.videoId.trim()) ? row.videoId.trim() : void 0;
	const explicitUrl = sanitizeHttpUrl([
		row.source_url,
		row.url,
		row.share_url,
		row.post_url,
		row.webVideoUrl,
		row.permalink,
		row.link,
		row.expanded_url,
		validYoutubeVideoId ? synthesizedPostUrl("youtube", validYoutubeVideoId) : void 0
	]);
	const platform = normalizeSocialPlatform(firstNonEmptyString([
		row.source_platform,
		row.platform,
		containerAccount?.platform,
		platformHint
	]) || void 0, explicitUrl);
	const shortcodeCandidate = firstNonEmptyString([row.shortcode, row.shortCode]) || (typeof row.code === "string" && row.code.trim().length >= 5 ? row.code.trim() : "");
	const rawId = firstNonEmptyString([
		row.id_str,
		row.id,
		row.post_id,
		row.aweme_id,
		row.tweet_id,
		row.rest_id,
		validYoutubeVideoId,
		shortcodeCandidate,
		row.pk
	]);
	const synthKey = platform === "instagram" && shortcodeCandidate ? shortcodeCandidate : rawId;
	const sourceUrl = explicitUrl || (synthKey ? synthesizedPostUrl(platform, synthKey) : void 0);
	const articleObj = asRecord(row.article);
	const articleResult = asRecord(asRecord(articleObj?.article_results)?.result) ?? articleObj;
	const noteTweetText = firstNonEmptyString([asRecord(asRecord(asRecord(row.note_tweet)?.note_tweet_results)?.result)?.text, asRecord(row.note_tweet)?.text]);
	const captionText = firstNonEmptyString([asRecord(row.caption)?.text, typeof row.caption === "string" ? row.caption : ""]);
	const ytTitle = textFromRuns(row.title);
	const rawTitle = firstNonEmptyString([articleResult?.title, typeof row.title === "string" ? row.title : ytTitle]);
	const rawExcerpt = firstNonEmptyString([
		articleResult?.preview_text,
		articleResult?.excerpt,
		articleResult?.description,
		row.excerpt,
		row.preview_text,
		row.hook_summary
	]);
	const rawBody = decodeBasicEntities(firstNonEmptyString([
		noteTweetText,
		articleResult?.plain_text,
		articleResult?.body,
		row.full_text,
		row.content,
		row.desc,
		row.text,
		captionText,
		textFromRuns(row.descriptionSnippet),
		row.description
	]));
	const declaredShape = firstNonEmptyString([row.content_shape, row.contentShape]).toLowerCase();
	const isArticle = declaredShape === "article" || row.is_article === true || Boolean(articleResult && (articleResult.title || articleResult.preview_text || articleResult.plain_text));
	const videoObj = asRecord(row.video);
	const imagePostImages = Array.isArray(asRecord(row.image_post_info)?.images) ? asRecord(row.image_post_info)?.images : [];
	const mediaDetails = Array.isArray(row.mediaDetails) ? row.mediaDetails : [];
	const entitiesMedia = Array.isArray(asRecord(row.entities)?.media) ? asRecord(row.entities)?.media : [];
	const extendedMedia = Array.isArray(asRecord(row.extended_entities)?.media) ? asRecord(row.extended_entities)?.media : [];
	const mediaContainer = asRecord(row.media);
	const mediaVideoArr = Array.isArray(mediaContainer?.video) ? mediaContainer.video : [];
	const mediaPhotoArr = Array.isArray(mediaContainer?.photo) ? mediaContainer.photo : Array.isArray(mediaContainer?.photos) ? mediaContainer.photos : [];
	const carouselMedia = Array.isArray(row.carousel_media) ? row.carousel_media : [];
	const rowImages = Array.isArray(row.images) ? row.images : [];
	const igCandidates = Array.isArray(asRecord(row.image_versions2)?.candidates) ? asRecord(row.image_versions2)?.candidates : [];
	const ytThumbnails = Array.isArray(asRecord(row.thumbnail)?.thumbnails) ? asRecord(row.thumbnail)?.thumbnails : Array.isArray(row.thumbnails) ? row.thumbnails : [];
	const collectedMediaEntries = [
		...mediaDetails,
		...extendedMedia,
		...entitiesMedia,
		...mediaVideoArr,
		...mediaPhotoArr
	].map((m) => asRecord(m)).filter((m) => Boolean(m));
	const xCoverCandidate = sanitizeMediaUrl(collectedMediaEntries.map((m) => m.media_url_https ?? m.media_url ?? m.preview_image_url ?? m.display_url));
	const igCarouselCover = sanitizeMediaUrl(carouselMedia.flatMap((c) => {
		const cr = asRecord(c);
		const cand = Array.isArray(asRecord(cr?.image_versions2)?.candidates) ? asRecord(cr?.image_versions2)?.candidates : [];
		return [
			cr?.display_url,
			cr?.cover_url,
			...cand.map((x) => asRecord(x)?.url)
		];
	}));
	const igDirectCover = sanitizeMediaUrl([
		row.display_url,
		row.thumbnail_src,
		...igCandidates.map((x) => asRecord(x)?.url)
	]);
	const ytLastThumb = ytThumbnails.length > 0 ? asRecord(ytThumbnails[ytThumbnails.length - 1])?.url : void 0;
	const tiktokCover = urlListFirst(videoObj?.cover) ?? urlListFirst(videoObj?.origin_cover) ?? urlListFirst(videoObj?.dynamic_cover) ?? sanitizeMediaUrl([videoObj?.poster]) ?? (imagePostImages.length > 0 ? urlListFirst(asRecord(imagePostImages[0])?.display_image) ?? urlListFirst(asRecord(imagePostImages[0])?.thumbnail) : void 0);
	const flatRowImages = rowImages.map((entry) => typeof entry === "string" ? sanitizeMediaUrl([entry]) : sanitizeMediaUrl([asRecord(entry)?.url, asRecord(entry)?.display_url])).filter((u) => Boolean(u));
	const rowMediaUrls = Array.isArray(row.media_urls) ? row.media_urls.map((u) => sanitizeMediaUrl([u])).filter((u) => Boolean(u)) : [];
	const coverUrl = sanitizeMediaUrl([
		asRecord(asRecord(articleResult?.cover_media)?.media_info)?.original_img_url,
		asRecord(articleResult?.cover_media)?.original_img_url,
		articleResult?.cover_image_url,
		articleResult?.cover_url,
		row.cover_http_url,
		row.cover_url,
		row.cover,
		row.thumbnail_url,
		row.thumbnail,
		row.origin_cover,
		row.image_url,
		ytLastThumb
	]) ?? tiktokCover ?? xCoverCandidate ?? igCarouselCover ?? igDirectCover ?? flatRowImages[0] ?? rowMediaUrls[0];
	const isVideo = String(row.type || "").toLowerCase() === "video" || declaredShape === "video" || row.is_video === true || Boolean(row.video_url) || Boolean(row.video_versions) || Boolean(videoObj && (videoObj.play_addr || videoObj.playAddr || videoObj.download_addr || videoObj.duration)) || mediaVideoArr.length > 0 || collectedMediaEntries.some((m) => m.type === "video" || m.type === "animated_gif") || platform === "tiktok" || platform === "youtube";
	let durationSec = parseDurationText(row.duration ?? row.video_duration ?? row.duration_seconds ?? textFromRuns(row.lengthText));
	if (durationSec === void 0 && videoObj?.duration != null) {
		const vd = asFiniteNumber(videoObj.duration);
		if (vd !== void 0 && vd > 0) durationSec = platform === "tiktok" && vd > 500 ? Math.round(vd / 1e3) : Math.round(vd);
	}
	if (durationSec === void 0) for (const m of collectedMediaEntries) {
		const ms = asFiniteNumber(asRecord(m.video_info)?.duration_millis);
		if (ms !== void 0 && ms > 0) {
			durationSec = Math.round(ms / 1e3);
			break;
		}
	}
	let coverAspectRatio = asFiniteNumber(row.ratio);
	if (coverAspectRatio === void 0 && videoObj) {
		const w = asFiniteNumber(videoObj.width);
		const h = asFiniteNumber(videoObj.height);
		if (w && h && w > 0 && h > 0) coverAspectRatio = w / h;
	}
	if (coverAspectRatio === void 0) for (const m of collectedMediaEntries) {
		const info = asRecord(m.original_info);
		const w = asFiniteNumber(info?.width);
		const h = asFiniteNumber(info?.height);
		if (w && h && w > 0 && h > 0) {
			coverAspectRatio = w / h;
			break;
		}
	}
	const mediaCount = asFiniteNumber(row.media_count) ?? (carouselMedia.length > 1 ? carouselMedia.length : imagePostImages.length > 1 ? imagePostImages.length : flatRowImages.length > 1 ? flatRowImages.length : collectedMediaEntries.length > 1 ? collectedMediaEntries.length : void 0);
	const rawUser = asRecord(row.author) ?? asRecord(asRecord(asRecord(asRecord(row.core)?.user_results)?.result)?.legacy) ?? asRecord(row.user) ?? asRecord(row.owner) ?? containerAccount ?? {};
	const userResult = asRecord(asRecord(asRecord(row.core)?.user_results)?.result);
	const authorName = firstNonEmptyString([
		rawUser.name,
		rawUser.nickname,
		asRecord(userResult?.core)?.name,
		row.author_name,
		row.channel_name,
		textFromRuns(row.ownerText),
		textFromRuns(row.longBylineText),
		textFromRuns(row.shortBylineText)
	]) || void 0;
	const authorHandle = firstNonEmptyString([
		rawUser.handle,
		rawUser.screen_name,
		rawUser.username,
		rawUser.unique_id,
		asRecord(userResult?.core)?.screen_name,
		row.author_handle,
		row.screen_name
	]).replace(/^@+/, "") || void 0;
	const ytChannelThumbObj = asRecord(asRecord(asRecord(row.channelThumbnailSupportedRenderers)?.channelThumbnailWithLinkRenderer)?.thumbnail);
	const ytChannelThumbs = Array.isArray(ytChannelThumbObj?.thumbnails) ? ytChannelThumbObj.thumbnails : [];
	const avatarUrl = sanitizeMediaUrl([
		rawUser.avatar_http_url,
		rawUser.avatar_url,
		rawUser.avatarUrl,
		rawUser.avatar,
		rawUser.profile_image_url_https,
		rawUser.profile_pic_url,
		asRecord(userResult?.avatar)?.image_url,
		urlListFirst(rawUser.avatar_thumb),
		urlListFirst(rawUser.avatar_larger),
		row.avatar_http_url,
		row.avatar_url,
		containerAccount?.avatar_http_url,
		containerAccount?.avatar_url,
		asRecord(ytChannelThumbs[0])?.url
	]);
	const author = authorName || authorHandle || avatarUrl ? {
		name: authorName,
		handle: authorHandle,
		avatarUrl
	} : void 0;
	const stats = asRecord(row.stats) ?? asRecord(row.statistics) ?? asRecord(row.engagement) ?? row;
	const metrics = {
		likes: asFiniteNumber(stats.likes ?? stats.like_count ?? stats.favorite_count ?? stats.digg_count),
		reposts: asFiniteNumber(stats.shares ?? stats.reposts ?? stats.retweet_count ?? stats.repost_count ?? stats.share_count),
		views: asFiniteNumber(stats.views ?? stats.view_count ?? stats.play_count ?? stats.video_view_count ?? textFromRuns(row.viewCountText)),
		comments: asFiniteNumber(stats.comments ?? stats.comment_count ?? stats.reply_count)
	};
	const hasAnyMetric = Object.values(metrics).some((v) => v !== void 0);
	const publishedAtRaw = firstNonEmptyString([
		row.published_at,
		row.posted_at,
		row.create_time,
		row.createTime,
		row.taken_at,
		row.created_at,
		textFromRuns(row.publishedTimeText)
	]);
	const publishedLabel = formatSocialRelativeTime(publishedAtRaw || row.create_time || row.taken_at, locale, nowMs);
	const outlierBadges = resolveOutlierBadges(asRecord(row.velocity));
	const hostname = extractHostname(sourceUrl) || void 0;
	const faviconUrl = sanitizeMediaUrl([row.favicon_url]);
	const title = isArticle ? rawTitle || void 0 : rawTitle && rawTitle !== rawBody ? rawTitle : void 0;
	const excerpt = rawExcerpt || void 0;
	const body = rawBody || (!isArticle ? rawTitle : "") || void 0;
	if (!title && !body && !excerpt && !coverUrl && !sourceUrl) return null;
	const candidate = {
		id: rawId || `${toolName}-${index}`,
		platform,
		contentShape: declaredShape || (isArticle ? "article" : void 0),
		mediaType: !coverUrl ? sourceUrl ? "link" : "text" : isVideo ? "video" : "image",
		isArticle: isArticle || void 0,
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
		metrics: hasAnyMetric ? metrics : void 0,
		outlierBadges: outlierBadges.length > 0 ? outlierBadges : void 0,
		publishedAt: publishedAtRaw || void 0,
		publishedLabel,
		sourceUrl,
		faviconUrl,
		hostname
	};
	return {
		...candidate,
		archetype: resolveSocialCardArchetype(candidate)
	};
}
/**
* Pure adapter transforming any chat `tool.call.toolview` block for social/inspiration
* search, feed, or single-post tools into a render-ready model.
*/
function parseSocialToolBlock(block, toolName, options = {}) {
	const locale = options.locale === "en" ? "en" : "zh";
	const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
	const blk = asRecord(block);
	const toolPlatform = TOOL_PLATFORM_HINTS[toolName];
	const settled = Boolean(blk && blk.kind === "tool-result");
	const args = parseArgsObject(settled ? blk?.call?.argsRaw ?? blk?.argsRaw : blk?.argsRaw);
	const initialQuery = extractQuerySummary(args);
	if (!blk || !settled) return {
		phase: "running",
		toolName,
		platform: normalizeArgPlatform(args.platform) ?? toolPlatform,
		capability: typeof args.capability === "string" ? args.capability : void 0,
		querySummary: initialQuery,
		items: [],
		totalCount: 0
	};
	const rawOutputText = extractContentText(blk.content);
	if (blk.isError) return {
		phase: "error",
		toolName,
		platform: normalizeArgPlatform(args.platform) ?? toolPlatform,
		capability: typeof args.capability === "string" ? args.capability : void 0,
		querySummary: initialQuery,
		items: [],
		totalCount: 0,
		errorMessage: rawOutputText || firstNonEmptyString([
			blk.error?.reason,
			blk.error?.message,
			blk.error?.name,
			blk.error?.code
		]) || (locale === "en" ? "Tool execution failed" : "工具调用失败"),
		rawOutputText: rawOutputText || void 0
	};
	const parsedJson = tryParseJson(rawOutputText);
	if (parsedJson === void 0) return {
		phase: "passthrough",
		toolName,
		platform: normalizeArgPlatform(args.platform) ?? toolPlatform,
		capability: typeof args.capability === "string" ? args.capability : void 0,
		querySummary: initialQuery,
		items: [],
		totalCount: 0,
		rawOutputText: rawOutputText || void 0
	};
	const root = asRecord(parsedJson);
	const resolvedCapability = firstNonEmptyString([root?.capability, args.capability]) || void 0;
	const resolvedPlatform = normalizeArgPlatform(root?.platform ?? args.platform) ?? toolPlatform;
	const querySummary = extractQuerySummary(args, root) ?? initialQuery;
	if (toolName === "omnimux_social_data" && resolvedCapability && !POST_CAPABILITIES.has(resolvedCapability)) return {
		phase: "passthrough",
		toolName,
		platform: resolvedPlatform,
		capability: resolvedCapability,
		querySummary,
		items: [],
		totalCount: 0,
		rawOutputText: rawOutputText || void 0
	};
	let payload = parsedJson;
	if (root) {
		const inner = root.data;
		if (Array.isArray(inner) || asRecord(inner)) {
			payload = inner;
			const innerRec = asRecord(inner);
			if (innerRec && (typeof innerRec.code === "number" || innerRec.status != null) && asRecord(innerRec.data)) payload = innerRec.data;
		}
	}
	const payloadRec = asRecord(payload);
	if (payloadRec && Object.keys(payloadRec).length > 0 && Object.keys(payloadRec).every((k) => [
		"text",
		"code",
		"message",
		"msg",
		"status"
	].includes(k)) && (payloadRec.text === null || payloadRec.text === "")) return {
		phase: "empty",
		toolName,
		platform: resolvedPlatform,
		capability: resolvedCapability,
		querySummary,
		items: [],
		totalCount: 0,
		rawOutputText: rawOutputText || void 0
	};
	const { rows, foundListContainer, containerAccount } = extractPostRows(payload);
	const seenIds = /* @__PURE__ */ new Set();
	const items = [];
	for (let i = 0; i < rows.length; i += 1) {
		const mapped = mapRawRowToSocialItem(rows[i], i, {
			platformHint: resolvedPlatform,
			toolName,
			locale,
			nowMs,
			containerAccount: containerAccount ?? asRecord(root?.account)
		});
		if (!mapped) continue;
		if (seenIds.has(mapped.id)) continue;
		seenIds.add(mapped.id);
		items.push(mapped);
	}
	if (items.length === 0) return {
		phase: foundListContainer ? "empty" : "passthrough",
		toolName,
		platform: resolvedPlatform,
		capability: resolvedCapability,
		querySummary,
		items: [],
		totalCount: 0,
		rawOutputText: rawOutputText || void 0
	};
	const distinctPlatforms = new Set(items.map((it) => it.platform).filter(Boolean));
	return {
		phase: "ready",
		toolName,
		platform: resolvedPlatform ?? (distinctPlatforms.size === 1 ? Array.from(distinctPlatforms)[0] : void 0),
		capability: resolvedCapability,
		querySummary,
		items,
		totalCount: items.length,
		rawOutputText: rawOutputText || void 0
	};
}
function normalizeArgPlatform(raw) {
	if (typeof raw !== "string" || !raw.trim()) return void 0;
	const p = normalizeSocialPlatform(raw);
	return p === "web" && raw.trim().toLowerCase() !== "web" ? void 0 : p;
}
// src/social-card/SocialSearchToolView.tsx
const c = (name) => cssClass(SocialSearchToolView_module_css_default[name], name);
const PLATFORM_NAMES = {
	x: {
		zh: "X",
		en: "X"
	},
	tiktok: {
		zh: "TikTok",
		en: "TikTok"
	},
	instagram: {
		zh: "Instagram",
		en: "Instagram"
	},
	youtube: {
		zh: "YouTube",
		en: "YouTube"
	},
	bilibili: {
		zh: "B站",
		en: "Bilibili"
	},
	xiaohongshu: {
		zh: "小红书",
		en: "Xiaohongshu"
	},
	douyin: {
		zh: "抖音",
		en: "Douyin"
	},
	threads: {
		zh: "Threads",
		en: "Threads"
	},
	linkedin: {
		zh: "LinkedIn",
		en: "LinkedIn"
	},
	substack: {
		zh: "Substack",
		en: "Substack"
	},
	web: {
		zh: "网页",
		en: "Web"
	}
};
function SearchGlyph() {
	return /* @__PURE__ */ jsxs("svg", {
		width: "14",
		height: "14",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: [/* @__PURE__ */ jsx("circle", {
			cx: "11",
			cy: "11",
			r: "7"
		}), /* @__PURE__ */ jsx("path", { d: "m20 20-3.5-3.5" })]
	});
}
function ChevronGlyph() {
	return /* @__PURE__ */ jsx("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: /* @__PURE__ */ jsx("path", { d: "m6 9 6 6 6-6" })
	});
}
function ExternalLinkGlyph() {
	return /* @__PURE__ */ jsxs("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ jsx("path", { d: "M15 3h6v6" }),
			/* @__PURE__ */ jsx("path", { d: "M10 14 21 3" }),
			/* @__PURE__ */ jsx("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" })
		]
	});
}
function BookmarkGlyph() {
	return /* @__PURE__ */ jsx("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: /* @__PURE__ */ jsx("path", { d: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" })
	});
}
function CheckGlyph() {
	return /* @__PURE__ */ jsx("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2.2",
		"aria-hidden": "true",
		children: /* @__PURE__ */ jsx("polyline", { points: "20 6 9 17 4 12" })
	});
}
function InspectGlyph() {
	return /* @__PURE__ */ jsxs("svg", {
		width: "13",
		height: "13",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		"aria-hidden": "true",
		children: [/* @__PURE__ */ jsx("polyline", { points: "16 18 22 12 16 6" }), /* @__PURE__ */ jsx("polyline", { points: "8 6 2 12 8 18" })]
	});
}
function resolveActionTitle(parsed, locale) {
	const { phase, toolName, platform } = parsed;
	const plat = platform && PLATFORM_NAMES[platform] ? PLATFORM_NAMES[platform][locale] : void 0;
	if (phase === "error") return locale === "en" ? "Post fetch failed" : "获取帖子失败";
	const running = phase === "running";
	if (phase === "passthrough") return locale === "en" ? "Social data output" : "社媒数据输出";
	if (toolName.includes("_inspiration_") || toolName === "inspiration_search" || toolName === "inspiration_get") {
		if (toolName.endsWith("_get")) return running ? locale === "en" ? "Fetching inspiration" : "正在读取灵感详情" : locale === "en" ? "Fetched inspiration" : "已读取灵感详情";
		return running ? locale === "en" ? "Searching inspirations" : "正在检索灵感库" : locale === "en" ? "Searched inspirations" : "已检索灵感库";
	}
	if (toolName.startsWith("inspiration_rival_")) return running ? locale === "en" ? "Fetching rival posts" : "正在读取对标作品" : locale === "en" ? "Fetched rival posts" : "已读取对标作品";
	if (toolName.endsWith("_search")) return running ? locale === "en" ? `Searching ${plat ?? "social"} posts` : `正在搜索${plat ? ` ${plat} ` : "社媒"}帖子` : locale === "en" ? `Searched ${plat ?? "social"} posts` : `已搜索${plat ? ` ${plat} ` : "社媒"}帖子`;
	if (toolName.endsWith("_posts")) return running ? locale === "en" ? `Fetching ${plat ?? "creator"} posts` : `正在获取${plat ? ` ${plat} ` : "创作者"}作品` : locale === "en" ? `Fetched ${plat ?? "creator"} posts` : `已获取${plat ? ` ${plat} ` : "创作者"}作品`;
	if (toolName.endsWith("_tweet") || toolName.endsWith("_video") || toolName.endsWith("_post")) return running ? locale === "en" ? `Fetching ${plat ?? "social"} post` : `正在获取${plat ? ` ${plat} ` : "社媒"}帖子` : locale === "en" ? `Fetched ${plat ?? "social"} post` : `已获取${plat ? ` ${plat} ` : "社媒"}帖子`;
	return running ? locale === "en" ? "Querying social posts" : "正在查询社媒帖子" : locale === "en" ? "Fetched social posts" : "已获取社媒帖子";
}
function defaultOpenExternal(url) {
	if (!isSafeHttpUrl(url)) return;
	if (typeof window !== "undefined" && typeof window.open === "function") window.open(String(url).trim(), "_blank", "noopener,noreferrer");
}
/**
* Shared chat conversation view (`tool.call.toolview`) that renders social search,
* creator feeds, single posts, and inspiration items as 2-column compact 6-archetype cards.
*/
function SocialSearchToolView({ toolName, block, locale = "zh", inspect, initialVisibleCount = 6, canSaveToInspiration = false, onOpenPost, onSaveToInspiration, className }) {
	const lang = locale === "en" ? "en" : "zh";
	const parsed = useMemo(() => parseSocialToolBlock(block, toolName, { locale: lang }), [
		block,
		toolName,
		lang
	]);
	const [cardsExpanded, setCardsExpanded] = useState(true);
	const [rawOpen, setRawOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [saveStates, setSaveStates] = useState(() => /* @__PURE__ */ new Map());
	const [saveErrors, setSaveErrors] = useState(() => /* @__PURE__ */ new Map());
	const callKey = useMemo(() => {
		const b = block && typeof block === "object" ? block : void 0;
		return typeof b?.callId === "string" ? b.callId : toolName;
	}, [block, toolName]);
	const mountedRef = useRef(true);
	const callKeyRef = useRef(callKey);
	const inFlightSavesRef = useRef(/* @__PURE__ */ new Set());
	callKeyRef.current = callKey;
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);
	useEffect(() => {
		inFlightSavesRef.current = /* @__PURE__ */ new Set();
		setShowAll(false);
		setRawOpen(false);
		setCardsExpanded(true);
		setSaveStates(/* @__PURE__ */ new Map());
		setSaveErrors(/* @__PURE__ */ new Map());
	}, [callKey]);
	const title = resolveActionTitle(parsed, lang);
	const isReady = parsed.phase === "ready";
	const isRunning = parsed.phase === "running";
	const isError = parsed.phase === "error";
	const isPassthrough = parsed.phase === "passthrough";
	const isEmpty = parsed.phase === "empty";
	const canToggleBody = isReady || (isPassthrough || isError) && Boolean(parsed.rawOutputText);
	const isBodyOpen = isReady ? cardsExpanded : rawOpen;
	const handleToggleHeader = useCallback(() => {
		if (isReady) {
			setCardsExpanded((prev) => !prev);
			return;
		}
		if (isPassthrough && parsed.rawOutputText || isError) setRawOpen((prev) => !prev);
	}, [
		isReady,
		isPassthrough,
		isError,
		parsed.rawOutputText
	]);
	const handleOpen = useCallback((item) => {
		if (onOpenPost) {
			onOpenPost(item);
			return;
		}
		defaultOpenExternal(item.sourceUrl);
	}, [onOpenPost]);
	const handleSave = useCallback(async (item) => {
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
			if (res && res.ok) setSaveStates((prev) => {
				const next = new Map(prev);
				next.set(item.id, "saved");
				return next;
			});
			else {
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
			if (callKeyRef.current === activeCallKey) inFlightSavesRef.current.delete(item.id);
		}
	}, [
		canSaveToInspiration,
		onSaveToInspiration,
		saveStates,
		lang
	]);
	const visibleItems = useMemo(() => {
		if (!isReady) return [];
		const cap = Math.max(1, initialVisibleCount);
		return showAll || parsed.items.length <= cap ? parsed.items : parsed.items.slice(0, cap);
	}, [
		isReady,
		parsed.items,
		showAll,
		initialVisibleCount
	]);
	const remainingCount = Math.max(0, parsed.items.length - Math.max(1, initialVisibleCount));
	const countLabel = isReady || isEmpty ? `×${parsed.totalCount}` : null;
	const singleCard = isReady && parsed.items.length === 1;
	return /* @__PURE__ */ jsxs("section", {
		className: cx(c("root"), className),
		"data-social-toolview": toolName,
		"data-phase": parsed.phase,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: c("header"),
				children: [/* @__PURE__ */ jsx("div", {
					className: c("headerLeft"),
					children: /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: c("headerTrigger"),
						"data-static": !canToggleBody ? "true" : void 0,
						"data-error": isError ? "true" : void 0,
						"aria-expanded": canToggleBody ? isBodyOpen : void 0,
						onClick: canToggleBody ? handleToggleHeader : void 0,
						disabled: !canToggleBody,
						children: [
							/* @__PURE__ */ jsx("span", {
								className: c("headerIcon"),
								"aria-hidden": "true",
								children: isRunning ? /* @__PURE__ */ jsx("span", { className: c("runningDot") }) : parsed.platform ? /* @__PURE__ */ jsx(SocialPlatformMark, {
									platform: parsed.platform,
									size: 14
								}) : /* @__PURE__ */ jsx(SearchGlyph, {})
							}),
							/* @__PURE__ */ jsx("span", {
								className: c("title"),
								children: title
							}),
							parsed.querySummary ? /* @__PURE__ */ jsx("span", {
								className: c("query"),
								children: parsed.querySummary
							}) : null,
							countLabel ? /* @__PURE__ */ jsx("span", {
								className: c("countPill"),
								children: countLabel
							}) : null,
							canToggleBody ? /* @__PURE__ */ jsx("span", {
								className: c("chevron"),
								"data-open": String(isBodyOpen),
								"aria-hidden": "true",
								children: /* @__PURE__ */ jsx(ChevronGlyph, {})
							}) : null
						]
					})
				}), /* @__PURE__ */ jsxs("div", {
					className: c("headerActions"),
					children: [parsed.rawOutputText ? /* @__PURE__ */ jsx("button", {
						type: "button",
						className: c("headerActionBtn"),
						"aria-expanded": rawOpen,
						"aria-label": lang === "en" ? "Toggle raw output" : "查看原始输出",
						title: lang === "en" ? "Raw output" : "原始输出",
						onClick: () => setRawOpen((prev) => !prev),
						children: "JSON"
					}) : null, inspect ? /* @__PURE__ */ jsx("button", {
						type: "button",
						className: c("headerActionBtn"),
						"aria-label": lang === "en" ? "Inspect call" : "检查调用详情",
						title: lang === "en" ? "Inspect call" : "检查调用详情",
						onClick: inspect,
						children: /* @__PURE__ */ jsx(InspectGlyph, {})
					}) : null]
				})]
			}),
			isError ? /* @__PURE__ */ jsx("div", {
				className: c("errorBox"),
				role: "status",
				children: parsed.errorMessage
			}) : null,
			rawOpen && parsed.rawOutputText ? /* @__PURE__ */ jsx("pre", {
				className: c("rawOutputBox"),
				children: parsed.rawOutputText
			}) : null,
			isReady && cardsExpanded ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", {
				className: singleCard ? c("gridSingle") : void 0,
				children: /* @__PURE__ */ jsx(MasonryGrid, {
					items: visibleItems,
					getKey: (item) => item.id,
					minColumnWidth: 210,
					minColumns: 1,
					maxColumns: singleCard ? 1 : 2,
					defaultColumns: singleCard ? 1 : 2,
					gap: 10,
					resetKey: `${callKey}:${toolName}:${parsed.totalCount}:${parsed.items[0]?.id ?? ""}`,
					estimateWeight: estimateArchetypeWeight,
					ariaLabel: title,
					renderItem: (item) => {
						const hasLink = isSafeHttpUrl(item.sourceUrl);
						const saveStatus = saveStates.get(item.id) ?? "idle";
						const saveErr = saveErrors.get(item.id);
						const showSave = Boolean(canSaveToInspiration && onSaveToInspiration && hasLink);
						const hoverActions = hasLink || showSave ? /* @__PURE__ */ jsxs(Fragment, { children: [hasLink ? /* @__PURE__ */ jsx("button", {
							type: "button",
							className: c("hoverPillBtn"),
							"aria-label": lang === "en" ? "Open original post" : "打开原帖",
							title: lang === "en" ? "Open original post" : "打开原帖",
							onClick: (e) => {
								e.stopPropagation();
								handleOpen(item);
							},
							children: /* @__PURE__ */ jsx(ExternalLinkGlyph, {})
						}) : null, showSave ? /* @__PURE__ */ jsx("button", {
							type: "button",
							className: c("hoverPillBtn"),
							"data-save-state": saveStatus,
							disabled: saveStatus === "saving" || saveStatus === "saved",
							"aria-label": saveStatus === "saved" ? lang === "en" ? "Saved to inspiration" : "已保存到灵感库" : saveStatus === "error" ? saveErr || (lang === "en" ? "Retry save" : "重试保存") : lang === "en" ? "Save to inspiration" : "存为灵感",
							title: saveStatus === "saved" ? lang === "en" ? "Saved" : "已存为灵感" : saveStatus === "error" ? saveErr || (lang === "en" ? "Save failed" : "保存失败") : lang === "en" ? "Save to inspiration" : "存为灵感",
							onClick: (e) => {
								e.stopPropagation();
								handleSave(item);
							},
							children: /* @__PURE__ */ jsx(IconSwap, {
								active: saveStatus === "saved",
								primary: /* @__PURE__ */ jsx(BookmarkGlyph, {}),
								secondary: /* @__PURE__ */ jsx(CheckGlyph, {})
							})
						}) : null] }) : void 0;
						return /* @__PURE__ */ jsx(SocialPostCard, {
							item,
							density: "compact",
							onClick: hasLink || onOpenPost ? () => handleOpen(item) : void 0,
							hoverActions
						}, item.id);
					}
				})
			}), remainingCount > 0 ? /* @__PURE__ */ jsx("button", {
				type: "button",
				className: c("showMoreBtn"),
				"aria-expanded": showAll,
				onClick: () => setShowAll((prev) => !prev),
				children: showAll ? lang === "en" ? "Show less" : "收起" : lang === "en" ? `Show ${remainingCount} more` : `展开其余 ${remainingCount} 条`
			}) : null] }) : null
		]
	});
}
export { MasonryGrid, SocialPlatformMark, SocialPostCard, SocialSearchToolView, computeMasonryColumnCount, distributeMasonryColumns, estimateArchetypeWeight, extractHostname, formatCompactCount, formatDuration, formatSocialRelativeTime, isSafeHttpUrl, isSafeMediaSrc, normalizeSocialPlatform, parseSocialToolBlock, resolveOutlierBadges, resolveSocialCardArchetype };

//# sourceMappingURL=social-card.js.map