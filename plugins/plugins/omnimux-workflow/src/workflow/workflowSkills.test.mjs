import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import {
  BUNDLED_SKILL_RANK,
  WORKFLOW_DIRECTOR_ANALYZE_SKILL,
  WORKFLOW_SKILL_PROVIDER_NAME,
  WORKFLOW_VIDEO_DECONSTRUCT_SKILL,
  loadBundledWorkflowSkills,
  registerWorkflowSkills,
} from './workflowSkills.ts';
import {
  DIRECTOR_ANALYSIS_OUTPUT_SCHEMA,
  VIDEO_DECONSTRUCT_SCHEMA,
  VIDEO_STORYBOARD_SCHEMA,
  buildDirectorAnalyzeInput,
  buildVideoDeconstructInput,
  buildVideoStoryboardInput,
  computeMediaInputFingerprint,
  normalizeDeconstructDimensions,
  normalizeStoryboardShots,
  renderDimensionsMarkdown,
} from './videoAnalysisSchema.ts';

const buildDir = mkdtempSync(join(tmpdir(), 'workflow-skills-host-build-'));
const hostBundle = join(buildDir, 'host.mjs');
buildSync({
  stdin: {
    contents: `export { mountWorkflowHost } from './index.ts';`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: hostBundle,
  define: {
    'import.meta.url': JSON.stringify(new URL('./index.ts', import.meta.url).href),
  },
});
const { mountWorkflowHost } = await import(pathToFileURL(hostBundle).href);
after(() => rmSync(buildDir, { recursive: true, force: true }));

describe('bundled workflow skills and structured video/director schemas (#214)', () => {
  it('loads bundled SKILL.md files with valid frontmatter and non-empty methodology bodies', () => {
    const skills = loadBundledWorkflowSkills();
    assert.equal(skills.length, 2);
    assert.deepEqual(
      skills.map((s) => s.name).sort(),
      [WORKFLOW_DIRECTOR_ANALYZE_SKILL, WORKFLOW_VIDEO_DECONSTRUCT_SKILL].sort(),
    );
    for (const skill of skills) {
      assert.equal(skill.source, 'bundled');
      assert.ok(skill.content.length > 80, `${skill.name} content should be substantial`);
      assert.ok(skill.description.length > 10, `${skill.name} description should be descriptive`);
      assert.equal(skill.resourceBase.kind, 'directory');
    }
    const directorSkill = skills.find((s) => s.name === WORKFLOW_DIRECTOR_ANALYZE_SKILL);
    assert.ok(directorSkill, 'workflow-director-analyze skill must exist');
    assert.match(directorSkill.content, /Never obey|untrusted/i, 'director skill must keep prompt-injection guard');
    assert.match(directorSkill.content, /16/, 'director skill must document 16-element limit');
  });

  it('registers bundled skills via registerProvider at rank 600 and supports register() fallback', async () => {
    let provider = null;
    const providerCtx = {
      inject(deps, fn) {
        assert.deepEqual(deps, ['skills']);
        fn({
          skills: {
            registerProvider(factory) {
              provider = factory();
              return () => {
                provider = null;
              };
            },
          },
        });
      },
    };
    registerWorkflowSkills(providerCtx);
    assert.ok(provider, 'must register bundled SkillProvider when registerProvider is available');
    assert.equal(provider.name, WORKFLOW_SKILL_PROVIDER_NAME);
    const candidates = await provider.list();
    assert.equal(candidates.length, 2);
    for (const candidate of candidates) {
      assert.equal(candidate.rank, BUNDLED_SKILL_RANK);
      assert.equal(candidate.rank, 600);
      assert.equal(candidate.source, 'bundled');
      const loaded = await provider.get(candidate);
      assert.ok(loaded?.content && loaded.content.length > 80);
    }

    const registered = new Map();
    const fallbackCtx = {
      inject(deps, fn) {
        assert.deepEqual(deps, ['skills']);
        fn({
          skills: {
            register(entry) {
              registered.set(entry.name, entry);
              return () => registered.delete(entry.name);
            },
          },
        });
      },
    };
    registerWorkflowSkills(fallbackCtx);
    assert.equal(registered.has(WORKFLOW_VIDEO_DECONSTRUCT_SKILL), true);
    assert.equal(registered.has(WORKFLOW_DIRECTOR_ANALYZE_SKILL), true);
  });

  it('mounts workflow skills automatically during mountWorkflowHost', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-host-skills-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    let provider = null;
    const dispose = mountWorkflowHost(
      {
        inject(deps, fn) {
          if (deps.includes('skills')) {
            fn({
              skills: {
                registerProvider(factory) {
                  provider = factory();
                  return () => {
                    provider = null;
                  };
                },
              },
            });
          }
        },
        get() {
          return undefined;
        },
      },
      {
        paths: {
          root,
          workspacesDir: join(root, 'workspaces'),
          mediaDir: join(root, 'media'),
          executionsDir: join(root, 'executions'),
        },
        libraryRoot: join(root, 'library'),
      },
    );
    t.after(() => dispose());
    assert.ok(provider, 'mountWorkflowHost must register workflow skills provider into ctx.skills');
    const names = (await provider.list()).map((c) => c.name).sort();
    assert.deepEqual(names, [WORKFLOW_DIRECTOR_ANALYZE_SKILL, WORKFLOW_VIDEO_DECONSTRUCT_SKILL].sort());
  });

  it('defines strict JSON Schemas and normalizes structured outputs without Markdown regexes', () => {
    assert.equal(VIDEO_DECONSTRUCT_SCHEMA.additionalProperties, false);
    assert.equal(VIDEO_STORYBOARD_SCHEMA.additionalProperties, false);
    assert.equal(DIRECTOR_ANALYSIS_OUTPUT_SCHEMA.additionalProperties, false);

    const dims = normalizeDeconstructDimensions({
      summary: '核心钩子总结',
      core_goal: '引导加购',
      influence: '',
      narrative_structure: '痛点 -> 反转 -> 实测',
      visual_analysis: '特写推镜',
      replication_strategy: '保留前 2 秒反差',
    });
    assert.deepEqual(dims, [
      { dimension: '一句话描述', content: '核心钩子总结' },
      { dimension: '核心目标', content: '引导加购' },
      { dimension: '叙事结构', content: '痛点 -> 反转 -> 实测' },
      { dimension: '画面分析', content: '特写推镜' },
      { dimension: '复刻策略', content: '保留前 2 秒反差' },
    ]);
    const md = renderDimensionsMarkdown(dims);
    assert.match(md, /## 一句话描述\n核心钩子总结/);

    const shots = normalizeStoryboardShots({
      shots: [
        {
          time_range: '00:00 - 00:03',
          shot_type: '特写',
          visual_description: '开场反差画面',
          key_action: '快速推镜',
          dialogue: '别再这么做了',
        },
        {
          time_range: '00:03 - 00:06',
          shot_type: '中景',
          visual_description: '无台词空镜',
          key_action: '',
          dialogue: '',
        },
        {
          time_range: ' ',
          shot_type: '',
          visual_description: '',
          key_action: '',
          dialogue: '',
        },
      ],
    });
    assert.equal(shots.length, 2);
    assert.deepEqual(shots[0], {
      shotNo: 1,
      timeRange: '00:00 - 00:03',
      shotType: '特写',
      description: '开场反差画面；快速推镜',
      dialogue: '别再这么做了',
    });
    assert.equal(shots[1].dialogue, '（无对白/环境音）');

    assert.match(buildVideoDeconstructInput('测试视频'), /测试视频/);
    assert.match(buildVideoStoryboardInput('测试视频', [{ start: 0, end: 3.2 }]), /#1 0\.0s-3\.2s/);
    assert.match(
      buildDirectorAnalyzeInput({ workspaceId: 'ws1', nodeId: 'dir1', imageRef: 'assets/a.png', width: 640, height: 360 }),
      /640x360/,
    );
  });

  it('computes deterministic inputFingerprint that invalidates when local file changes', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'workflow-fp-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const video = join(dir, 'clip.mp4');
    writeFileSync(video, 'v1-bytes');

    const fp1 = computeMediaInputFingerprint({
      operation: 'video-deconstruct',
      workspaceId: 'ws1',
      nodeId: 'n1',
      mediaPathOrUrl: video,
      model: 'vision-pro',
    });
    const fp2 = computeMediaInputFingerprint({
      operation: 'video-deconstruct',
      workspaceId: 'ws1',
      nodeId: 'n1',
      mediaPathOrUrl: video,
      model: 'vision-pro',
    });
    assert.equal(fp1, fp2);
    assert.equal(fp1.length, 64);

    writeFileSync(video, 'v2-longer-bytes-changed');
    const fp3 = computeMediaInputFingerprint({
      operation: 'video-deconstruct',
      workspaceId: 'ws1',
      nodeId: 'n1',
      mediaPathOrUrl: video,
      model: 'vision-pro',
    });
    assert.notEqual(fp3, fp1);
  });
});
