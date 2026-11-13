/**
 * 默认项目库路径：视频已知文件夹 + OmniMux/Projects。
 *
 * 对齐 MiniMax `app.getPath("videos")` 策略，品牌目录用 OmniMux。
 * 解析只发生在 host（os.homedir）；web 客户端禁止写死 Movies。
 *
 * 测试可用环境变量 OMNIMUX_VIDEOS_DIR 覆盖 videos 根。
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { join as posixJoin } from 'node:path/posix';
import { join as win32Join } from 'node:path/win32';

export const LIBRARY_BRAND_DIR = 'OmniMux';
export const LIBRARY_PROJECTS_DIR = 'Projects';
export const VIDEOS_DIR_ENV = 'OMNIMUX_VIDEOS_DIR';

export interface LibraryPathOptions {
  platform?: NodeJS.Platform;
  homedir?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

function homeOf(opts: LibraryPathOptions): string {
  return opts.homedir ?? osHomedir();
}

function envOf(opts: LibraryPathOptions): NodeJS.ProcessEnv {
  return opts.env ?? process.env;
}

function existsOf(opts: LibraryPathOptions): (path: string) => boolean {
  return opts.exists ?? existsSync;
}

function joinFor(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === 'win32' ? win32Join(...parts) : posixJoin(...parts);
}

/**
 * 解析「视频」已知文件夹（非项目库根）。
 *
 * - darwin → `<homedir>/Movies`
 * - win32 → `<homedir>/Videos`
 * - 其它 → `<homedir>/Videos` 若存在，否则 `<homedir>`
 * - `OMNIMUX_VIDEOS_DIR` 非空则优先（测试/异常环境）
 */
export function resolveVideosDir(opts: LibraryPathOptions = {}): string {
  const override = envOf(opts)[VIDEOS_DIR_ENV];
  if (typeof override === 'string' && override.trim() !== '') {
    return override.trim();
  }
  const home = homeOf(opts);
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') return joinFor(platform, home, 'Movies');
  if (platform === 'win32') return joinFor(platform, home, 'Videos');
  const videos = joinFor(platform, home, 'Videos');
  return existsOf(opts)(videos) ? videos : home;
}

/** 默认项目库：`<videos>/OmniMux/Projects`。 */
export function defaultProjectLibrary(opts: LibraryPathOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  return joinFor(platform, resolveVideosDir(opts), LIBRARY_BRAND_DIR, LIBRARY_PROJECTS_DIR);
}

/**
 * 确保库根存在（host 可 recursive：一次建 OmniMux + Projects）。
 * 客户端 `workspaces.createDirectory` 一次只建一层，不能用来建整条库链。
 */
export function ensureLibraryRoot(opts: LibraryPathOptions = {}): string {
  // 实际 mkdir 用运行时 path.join（宿主 OS）；defaultProjectLibrary 已按 platform 拼好。
  const libraryRoot = join(resolveVideosDir(opts), LIBRARY_BRAND_DIR, LIBRARY_PROJECTS_DIR);
  mkdirSync(libraryRoot, { recursive: true });
  return libraryRoot;
}

/** 把绝对路径展示成 `~/…`（P1 弹窗用；P0 GET library 一并返回）。 */
export function displayHomePath(absPath: string, home: string = osHomedir()): string {
  if (absPath === home) return '~';
  const prefix = home.endsWith('/') || home.endsWith('\\') ? home : home + (absPath.includes('\\') ? '\\' : '/');
  if (absPath.startsWith(prefix) || absPath.startsWith(home + '/') || absPath.startsWith(home + '\\')) {
    return `~${absPath.slice(home.length)}`;
  }
  return absPath;
}
