import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_VIDEO_DECONSTRUCT_SKILL = 'workflow-video-deconstruct';
export const WORKFLOW_DIRECTOR_ANALYZE_SKILL = 'workflow-director-analyze';

export const BUNDLED_SKILL_RANK = 600;
export const WORKFLOW_SKILL_PROVIDER_NAME = 'omnimux-workflow';

const BUNDLED_SKILL_NAMES = [
  WORKFLOW_VIDEO_DECONSTRUCT_SKILL,
  WORKFLOW_DIRECTOR_ANALYZE_SKILL,
] as const;

export interface BundledWorkflowSkill {
  name: string;
  description: string;
  whenToUse?: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  content: string;
  path: string;
  source: 'bundled';
  resourceBase: { kind: 'directory'; path: string };
}

interface SkillCandidate {
  name: string;
  description: string;
  whenToUse?: string;
  path: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  source: 'bundled';
  provider: string;
  rank: number;
  resourceBase: { kind: 'directory'; path: string };
  locator: string;
}

interface SkillRegistryLike {
  registerProvider?: (
    factory: () => {
      name: string;
      list: () => Promise<SkillCandidate[]>;
      get: (candidate?: { name?: string }) => Promise<
        | {
            name: string;
            description: string;
            whenToUse?: string;
            path: string;
            invocation: { modelInvocable: boolean; userInvocable: boolean };
            source: 'bundled';
            provider: string;
            resourceBase: { kind: 'directory'; path: string };
            content: string;
          }
        | undefined
      >;
    },
  ) => unknown;
  register?: (entry: BundledWorkflowSkill) => unknown;
}

export interface WorkflowSkillContextLike {
  skills?: SkillRegistryLike;
  get?: (name: string) => unknown;
  inject?: (deps: string[], callback: (subCtx: { skills?: SkillRegistryLike; get?: (name: string) => unknown }) => void) => void;
}

function resolvePhysicalDir(dir: string): string {
  const unpacked = dir.replace(/(^|[\\/])([^\\/]*\.asar)(?=[\\/]|$)/iu, '$1$2.unpacked');
  return unpacked !== dir && existsSync(unpacked) ? unpacked : dir;
}

function parseFrontmatterBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(value)) return true;
  if (['false', 'no', 'off', '0'].includes(value)) return false;
  return undefined;
}

function parseFrontmatter(raw: string): { metadata: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: raw.trim() };
  const metadata: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) metadata[key] = value;
  }
  return { metadata, body: (match[2] ?? '').trim() };
}

function parseInvocationPolicy(metadata: Record<string, string>): { modelInvocable: boolean; userInvocable: boolean } {
  const disableModelInvocation = parseFrontmatterBoolean(metadata['disable-model-invocation']);
  const userInvocable = parseFrontmatterBoolean(metadata['user-invocable']);
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  };
}

function resolveDefaultSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled host artifact: dist/index.js -> ../skills
    join(here, '..', 'skills'),
    // Source tree: src/workflow/workflowSkills.ts -> ../../skills
    join(here, '..', '..', 'skills'),
    // Deeper test bundle or nested module fallback
    join(here, '..', '..', '..', 'skills'),
  ];
  for (const candidate of candidates) {
    if (BUNDLED_SKILL_NAMES.some((name) => existsSync(join(candidate, name, 'SKILL.md')))) {
      return candidate;
    }
  }
  return candidates[0]!;
}

/**
 * Load bundled workflow skills from `skills/<name>/SKILL.md`.
 */
export function loadBundledWorkflowSkills(skillsRoot: string = resolveDefaultSkillsRoot()): BundledWorkflowSkill[] {
  const loaded: BundledWorkflowSkill[] = [];
  for (const skillName of BUNDLED_SKILL_NAMES) {
    const dir = resolvePhysicalDir(join(skillsRoot, skillName));
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const { metadata, body } = parseFrontmatter(raw);
    if (!body) continue;
    loaded.push({
      name: metadata.name || skillName,
      description: metadata.description || skillName,
      ...(metadata.whenToUse ? { whenToUse: metadata.whenToUse } : {}),
      invocation: parseInvocationPolicy(metadata),
      content: body,
      path: file,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: dir },
    });
  }
  return loaded;
}

/**
 * Register bundled workflow skills into DSH native `ctx.skills` so Hub
 * `headlessSkill` and foreground Agent chat share the exact same source of truth.
 *
 * Prefers `skills.registerProvider` at `BUNDLED_SKILL_RANK` (600) so user
 * overrides in `$DSH_HOME/skills` keep higher precedence, and falls back to
 * `skills.register` for minimal test registries. Both DSH methods already bind
 * Cordis fiber disposal, so no duplicate outer `ctx.effect` disposer is attached.
 */
export function registerWorkflowSkills(ctx: WorkflowSkillContextLike | undefined | null, skillsRoot?: string): void {
  const skills = loadBundledWorkflowSkills(skillsRoot);
  if (!skills.length || !ctx) return;

  const mountInto = (registry: SkillRegistryLike | undefined | null): void => {
    if (!registry) return;
    if (typeof registry.registerProvider === 'function') {
      const byName = new Map(skills.map((entry) => [entry.name, entry]));
      const candidates: SkillCandidate[] = skills.map((entry) => ({
        name: entry.name,
        description: entry.description,
        ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
        path: entry.path,
        invocation: entry.invocation,
        source: 'bundled',
        provider: WORKFLOW_SKILL_PROVIDER_NAME,
        rank: BUNDLED_SKILL_RANK,
        resourceBase: entry.resourceBase,
        locator: entry.name,
      }));
      registry.registerProvider(() => ({
        name: WORKFLOW_SKILL_PROVIDER_NAME,
        list: async () => candidates,
        get: async (candidate) => {
          const entry = candidate?.name ? byName.get(candidate.name) : undefined;
          if (!entry) return undefined;
          return {
            name: entry.name,
            description: entry.description,
            ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
            path: entry.path,
            invocation: entry.invocation,
            source: 'bundled',
            provider: WORKFLOW_SKILL_PROVIDER_NAME,
            resourceBase: entry.resourceBase,
            content: entry.content,
          };
        },
      }));
      return;
    }
    if (typeof registry.register === 'function') {
      for (const entry of skills) registry.register(entry);
    }
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['skills'], (subCtx) => {
      const registry = (subCtx?.skills ?? subCtx?.get?.('skills')) as SkillRegistryLike | undefined;
      mountInto(registry);
    });
    return;
  }

  const direct = (typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills) as SkillRegistryLike | undefined;
  mountInto(direct);
}
