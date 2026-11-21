/**
 * @file execution-guard.mjs
 * @description Layer 2 隔离调用测试器：验证工具在内存沙箱中的执行稳健度、边界处理与输出格式
 */

import assert from 'node:assert/strict';
import { CLIP_FIXTURE } from './loader.mjs';
import { createMockToolContext } from './mock-context.mjs';

const { projectId, title, trackId, clipId, mediaId } = CLIP_FIXTURE;
const clipCases = {
  clip_list: {
    args: { limit: 100 }, emptyError: null,
    check(result) {
      assert.equal(result.count, result.projects.length);
      const row = result.projects.find((item) => item.id === projectId);
      assert.ok(row, 'The saved native project must appear in the list');
      assert.deepEqual([row.projectName, row.mode, row.revision, row.durationSec], [title, 'standalone', 1, 2.5]);
      assert.deepEqual(result.unavailableProjects, []);
      assert.equal(result.unavailableCount, 0);
    },
  },
  clip_create: {
    args: { name: 'Empty Smoke Project', resolution: 'square', fps: 24 },
    check(result, tool) {
      assert.match(result.projectId, /^clip_[0-9a-f-]{36}$/);
      assert.deepEqual([result.mode, result.revision, result.durationSec, result.aspectRatio, result.fps], ['standalone', 1, 0, '1:1', 24]);
      const { project, revision } = tool._clipStore.load(result.projectId);
      assert.equal(revision, result.revision);
      assert.equal(project.name, 'Empty Smoke Project');
      assert.deepEqual([project.settings.width, project.settings.height, project.settings.frameRate], [1080, 1080, 24]);
      assert.equal(project.timeline.duration, 0);
      assert.deepEqual(project.timeline.tracks.map((track) => [track.type, track.clips.length]), [['video', 0], ['audio', 0], ['text', 0]]);
    },
  },
  clip_get: {
    args: { projectId, view: 'full' }, emptyError: 'EDITOR_OFFLINE',
    check(result) {
      assert.deepEqual([result.projectId, result.mode, result.revision, result.view, result.durationSec], [projectId, 'standalone', 1, 'full', 2.5]);
      assert.deepEqual(result.tracks.map((track) => track.id), [trackId]);
      assert.deepEqual(result.clips.map((clip) => [clip.id, clip.trackId, clip.mediaId, clip.startSec, clip.endSec]), [[clipId, trackId, mediaId, 0.25, 2.5]]);
      assert.deepEqual(result.media.map((item) => [item.mediaId, item.missing]), [[mediaId, true]]);
    },
  },
  clip_diagnostics: {
    args: { projectId },
    check(result) {
      assert.deepEqual([result.projectId, result.revision, result.ok, result.issueCount], [projectId, 1, false, 2]);
      const [missing, gap] = result.issues;
      assert.deepEqual([missing.code, missing.clipId, missing.mediaId], ['media_missing', clipId, mediaId]);
      assert.deepEqual([gap.code, gap.fromSec, gap.toSec], ['timeline_gap', 0, 0.25]);
    },
  },
  clip_open: { args: { projectId }, error: 'EDITOR_OFFLINE' },
  clip_edit: {
    args: { projectId, baseRevision: 1, description: 'Add a video track', operations: [{ type: 'add_track', trackType: 'video' }], validateOnly: true },
    error: 'EDITOR_OFFLINE',
  },
  clip_view: { args: { projectId, action: 'seek', toSec: 0.5 }, error: 'EDITOR_OFFLINE' },
  clip_snapshot: { args: { projectId, times: [0.5] }, emptyError: 'EDITOR_OFFLINE', error: 'EDITOR_OFFLINE' },
  clip_export: { args: { projectId, baseRevision: 1, confirm: true }, error: 'EDITOR_OFFLINE' },
};

async function executeWithTimeout(tool, args, ctx) {
  let timer;
  try {
    return await Promise.race([
      tool.execute(args, ctx),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tool execution timeout (>3s)')), 3000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function testClipExecution(tool, ctx, clipCase) {
  const execute = (args) => executeWithTimeout(tool, args, ctx);
  const expectError = (args, code) => assert.rejects(() => execute(args), (error) => {
    assert.equal(error.name, 'ClipDomainError');
    assert.equal(error.code, code);
    assert.ok(error.message.startsWith(`[${code}] `), 'The Host registration must preserve the domain code in the error message');
    return true;
  });
  const expectResult = async (args) => {
    const result = await execute(args);
    assert.deepEqual(findUndefinedPaths(result), [], 'Clip must return lossless JSON');
    clipCase.check(result, tool);
  };
  try {
    if (clipCase.emptyError === null) await expectResult({});
    else await expectError({}, clipCase.emptyError ?? 'invalid-json');

    if (clipCase.error) await expectError(clipCase.args, clipCase.error);
    else await expectResult(clipCase.args);

    if (tool.name === 'clip_get') {
      await expectError({ projectId: 'clip_node_offline_fixture' }, 'project-not-materialized');
    }
    if (tool.name === 'clip_export') {
      await expectError({ projectId, confirm: false }, 'CONFIRMATION_REQUIRED');
    }
    return { ok: true, toolName: tool.name, phase: 'passed' };
  } catch (error) {
    return { ok: false, toolName: tool.name, phase: 'clip_fixture', error: error.message };
  }
}

/**
 * 递归深度扫描值中是否含有 undefined 或数组稀疏空洞 (Non-lossless JSON)
 * @param {unknown} value
 * @param {string} path
 * @param {Set<unknown>} seen
 * @returns {string[]} 违背无损 JSON 的属性路径列表
 */
export function findUndefinedPaths(value, path = '$', seen = new Set()) {
  const violations = [];
  if (value === undefined) {
    violations.push(path);
    return violations;
  }
  if (value === null || typeof value !== 'object') {
    return violations;
  }
  if (seen.has(value)) {
    return violations;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        violations.push(`${path}[${i}] (hole)`);
      } else {
        violations.push(...findUndefinedPaths(value[i], `${path}[${i}]`, seen));
      }
    }
    return violations;
  }
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      violations.push(`${path}.${key}`);
    } else {
      violations.push(...findUndefinedPaths(value[key], `${path}.${key}`, seen));
    }
  }
  return violations;
}

/**
 * 检查错误消息是否反映了“已提供的必填参数仍被报缺失”的签名/读取错位问题
 * @param {string} errorText
 * @param {string[]} requiredKeys
 * @param {Record<string, unknown>} providedArgs
 * @returns {string | null} 命中的被误判缺失的参数名
 */
export function detectFalseMissingRequiredParam(errorText, requiredKeys, providedArgs) {
  if (!errorText || typeof errorText !== 'string') return null;
  for (const reqKey of requiredKeys) {
    if (providedArgs[reqKey] !== undefined) {
      const pattern = new RegExp(`(missing|required).*\\b${reqKey}\\b|缺少.*${reqKey}|${reqKey}.*未提供`, 'i');
      if (pattern.test(errorText)) {
        return reqKey;
      }
    }
  }
  return null;
}

/**
 * 根据 JSON Schema 的 required 与 properties 构造最小可用 mock 入参
 * @param {object} parametersSchema 
 * @returns {object}
 */
export function generateMockArgs(parametersSchema) {
  const args = {};
  if (!parametersSchema || !parametersSchema.properties) return args;

  const required = new Set(parametersSchema.required || []);
  for (const [key, prop] of Object.entries(parametersSchema.properties)) {
    if (!required.has(key)) continue;

    switch (prop.type) {
      case 'string':
        args[key] = prop.enum ? prop.enum[0] : `mock_${key}`;
        break;
      case 'number':
      case 'integer':
        args[key] = prop.minimum !== undefined ? prop.minimum : 1;
        break;
      case 'boolean':
        args[key] = true;
        break;
      case 'array':
        args[key] = [];
        break;
      case 'object':
        args[key] = {};
        break;
      default:
        args[key] = `mock_${key}`;
        break;
    }
  }
  return args;
}

/**
 * 测试单个工具的隔离调用
 * @param {object} tool 
 * @returns {Promise<{ ok: boolean, toolName: string, phase: string, error?: string }>}
 */
export async function testToolExecution(tool) {
  const mockCtx = createMockToolContext();

  try {
    if (tool._plugin === 'omnimux-clip' && Object.hasOwn(clipCases, tool.name)) {
      return await testClipExecution(tool, mockCtx, clipCases[tool.name]);
    }

    // 1. 空参数冒烟测试 (Empty Args Smoke Test)
    let emptyArgsHandled = false;
    try {
      const emptyResult = await executeWithTimeout(tool, {}, mockCtx);
      emptyArgsHandled = true;

      // 空参执行成功时，强制校验无损 JSON
      if (emptyResult !== undefined) {
        const undefPaths = findUndefinedPaths(emptyResult);
        if (undefPaths.length > 0) {
          return {
            ok: false,
            toolName: tool.name,
            phase: 'lossless_json_empty_args',
            error: `空参数 execute({}) 返回值不符合 DSH 无损 JSON (lossless JSON) 规范：检测到属性值为 undefined -> ${undefPaths.slice(0, 3).join(', ')}`,
          };
        }
      }
    } catch (err) {
      // 如果工具对空参数抛出参数缺失错误，属于正常且健康的防御性检查
      const msg = err?.message || String(err);
      if (msg.includes('required') || msg.includes('missing') || msg.includes('Invalid') || msg.includes('not found')) {
        emptyArgsHandled = true;
      } else {
        // 记录非预期的异常但继续尝试 mock 入参
      }
    }

    // 2. 最小合法参数测试 (Mock Required Args Test)
    const mockArgs = generateMockArgs(tool.parameters);
    const requiredKeys = tool.parameters?.required || [];
    try {
      const result = await executeWithTimeout(tool, mockArgs, mockCtx);

      if (result === undefined) {
        return {
          ok: false,
          toolName: tool.name,
          phase: 'mock_args',
          error: 'execute() 返回了 undefined，DSH 工具执行体必须返回 JSON 对象或有效结果',
        };
      }

      // 深度校验返回值是否符合 DSH 无损 JSON 规范 (严禁包含 undefined 或数组空洞)
      const undefPaths = findUndefinedPaths(result);
      if (undefPaths.length > 0) {
        return {
          ok: false,
          toolName: tool.name,
          phase: 'lossless_json',
          error: `execute(mockArgs) 返回值不符合 DSH 无损 JSON (lossless JSON) 规范：检测到属性值为 undefined -> ${undefPaths.slice(0, 3).join(', ')}`,
        };
      }

      // 必填参数消费校验：若返回了包含参数缺失的错误对象，但该参数实际上已在 mockArgs 中提供
      if (result && typeof result === 'object' && result.ok === false && typeof result.error === 'string') {
        const falseMissing = detectFalseMissingRequiredParam(result.error, requiredKeys, mockArgs);
        if (falseMissing) {
          return {
            ok: false,
            toolName: tool.name,
            phase: 'argument_consumption',
            error: `execute() 返回参数缺失错误 "${result.error}"，但该必填参数 "${falseMissing}" 已在 mockArgs 中提供！表明工具实现未从首参读取 args`,
          };
        }
      }
    } catch (err) {
      const msg = err?.message || String(err);

      // 若抛出参数缺失异常，但该参数实际上已在 mockArgs 中提供
      const falseMissing = detectFalseMissingRequiredParam(msg, requiredKeys, mockArgs);
      if (falseMissing) {
        return {
          ok: false,
          toolName: tool.name,
          phase: 'argument_consumption',
          error: `execute() 抛出参数缺失异常 "${msg}"，但该必填参数 "${falseMissing}" 已在 mockArgs 中提供！表明工具实现未从首参读取 args`,
        };
      }

      // 受控领域错误（比如重名已存在、需要挂载界面、参数校验失败、未装载 hub、缺少具体参数等）属于预期安全行为
      const isControlled = /not found|unsupported|offline|invalid|failed|error|mock|needs-hub|does not exist|must be|requires|is required|未装载|失败|未提取|already exists|not mounted|非空/i.test(msg);
      if (!isControlled) {
        return {
          ok: false,
          toolName: tool.name,
          phase: 'mock_args',
          error: `非受控崩溃: ${msg}`,
        };
      }
    }

    return {
      ok: true,
      toolName: tool.name,
      phase: 'passed',
    };
  } finally {
    mockCtx.cleanup();
  }
}
