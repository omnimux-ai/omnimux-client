import { normalizeSocialPlatform } from "./archetype.ts";
import type { SocialCardPlatform, SocialPlatformMarkProps } from "./types.ts";

const PATHS: Readonly<Record<SocialCardPlatform, { viewBox: string; paths: readonly string[]; stroke?: boolean | undefined }>> = {
  x: {
    viewBox: "0 0 24 24",
    paths: [
      "M18.24 2.25h3.3l-7.22 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z",
    ],
  },
  tiktok: {
    viewBox: "0 0 24 24",
    paths: [
      "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.87a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.3Z",
    ],
  },
  douyin: {
    viewBox: "0 0 16 16",
    paths: [
      "M10 2.4c.2 1.5 1.2 2.6 2.7 2.9v2.2a5 5 0 0 1-2.7-1v4.1a3.9 3.9 0 1 1-3.6-3.9v2.2a1.7 1.7 0 1 0 1.4 1.7V2.4H10Z",
    ],
  },
  instagram: {
    viewBox: "0 0 24 24",
    paths: [
      "M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6Zm9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    ],
  },
  youtube: {
    viewBox: "0 0 24 24",
    paths: [
      "M21.58 7.19a2.75 2.75 0 0 0-1.94-1.95C17.93 4.75 12 4.75 12 4.75s-5.93 0-7.64.49a2.75 2.75 0 0 0-1.94 1.95A28.7 28.7 0 0 0 2 12a28.7 28.7 0 0 0 .42 4.81 2.75 2.75 0 0 0 1.94 1.95c1.71.49 7.64.49 7.64.49s5.93 0 7.64-.49a2.75 2.75 0 0 0 1.94-1.95A28.7 28.7 0 0 0 22 12a28.7 28.7 0 0 0-.42-4.81ZM10 15.11V8.89L15.4 12 10 15.11Z",
    ],
  },
  bilibili: {
    viewBox: "0 0 24 24",
    stroke: true,
    paths: [
      "M7 4l3 3",
      "M17 4l-3 3",
      "M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
      "M9 12v3",
      "M15 12v3",
    ],
  },
  xiaohongshu: {
    viewBox: "0 0 16 16",
    paths: [
      "M8 4.6C6.9 3.7 5.3 3.2 3.4 3.2v8.4c1.9 0 3.5.5 4.6 1.4 1.1-.9 2.7-1.4 4.6-1.4V3.2C10.7 3.2 9.1 3.7 8 4.6Zm-.9 1.6c-.8-.5-1.8-.8-2.8-.9v6.1c1 .1 2 .4 2.8.9V6.2Zm1.8 0c.8-.5 1.8-.8 2.8-.9v6.1c-1 .1-2 .4-2.8.9V6.2Z",
    ],
  },
  threads: {
    viewBox: "0 0 16 16",
    paths: [
      "M9.9 7.5a3.7 3.7 0 0 0-1.2-.5c-.1-1.1-.6-1.8-1.5-1.8-.6 0-1.1.3-1.4.9l1 .6c.2-.3.4-.4.5-.4.4 0 .6.3.7 1a6 6 0 0 0-1.2.2C5.6 7.8 4.9 8.6 5 9.6c0 1.2 1 1.9 2.1 1.8 1-.1 1.7-.7 1.9-1.6.3.2.6.4.8.7.5.7.5 1.7-.3 2.4-.6.6-1.5.9-2.4.8-1.8-.1-3-1.2-3-3.7s1.2-3.6 3.1-3.7c1.3-.1 2.2.4 2.7 1.2Z",
    ],
  },
  linkedin: {
    viewBox: "0 0 24 24",
    paths: [
      "M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14Zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75ZM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68Zm1.39 9.94v-8.37H5.5v8.37h2.77Z",
    ],
  },
  substack: {
    viewBox: "0 0 24 24",
    paths: [
      "M4 4h16v2.5H4V4Zm0 4.5h16V11H4V8.5Zm0 4.5h16v9l-8-4.5-8 4.5v-9Z",
    ],
  },
  web: {
    viewBox: "0 0 24 24",
    stroke: true,
    paths: [
      "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
      "M2 12h20",
      "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z",
    ],
  },
};

/** Source attribution mark for social platforms and generic web links. */
export function SocialPlatformMark({
  platform,
  variant = "icon",
  size = 15,
  className,
  title,
}: SocialPlatformMarkProps) {
  const key = normalizeSocialPlatform(platform);
  const spec = PATHS[key] ?? PATHS.web;
  const glyphSize = variant === "circle-badge" ? Math.max(12, Math.round(size * 0.85)) : size;

  const svg = (
    <svg
      width={glyphSize}
      height={glyphSize}
      viewBox={spec.viewBox}
      fill={spec.stroke ? "none" : "currentColor"}
      stroke={spec.stroke ? "currentColor" : "none"}
      strokeWidth={spec.stroke ? "1.8" : undefined}
      strokeLinecap={spec.stroke ? "round" : undefined}
      strokeLinejoin={spec.stroke ? "round" : undefined}
      aria-hidden="true"
    >
      {spec.paths.map((d, idx) => (
        <path key={idx} d={d} />
      ))}
    </svg>
  );

  return (
    <span
      className={className}
      data-platform-mark={key}
      data-variant={variant}
      aria-label={title}
      title={title}
    >
      {svg}
    </span>
  );
}
