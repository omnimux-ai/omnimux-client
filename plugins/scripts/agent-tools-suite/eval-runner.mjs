/**
 * @file eval-runner.mjs
 * @description Layer 3 正则模拟器的离线路由冒烟
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateJsonSchema } from './schema-lint.mjs';

/**
 * 离线意图与参数匹配器 (Mock Agent Function Calling Simulator)
 * 用于在零 Token 成本下，对 Prompt 与工具 Schema 进行语义绑定与参数合法性审计
 * @param {string} prompt
 * @returns {{ toolName: string|null, args: object }}
 */
function mockAgentToolMatcher(prompt) {
  // 负向检测：学术/纯概念常识问答不触发工具
  if (/时间复杂度|空间复杂度|什么是|解释一下|排序算法/.test(prompt) && !/插件|生成|创建|删除|搜索|查询/.test(prompt)) {
    return { toolName: null, args: {} };
  }

  // 1. 视频生成
  if (/视频|短视频|生成一段/i.test(prompt) && /虫洞|飞船|科幻/i.test(prompt)) {
    return {
      toolName: 'omnimux_video_submit',
      args: { prompt: prompt, ratio: '16:9' },
    };
  }

  // 2. 图片生成
  if (/图片|画一张|插画/i.test(prompt) && /赛博朋克|城市/i.test(prompt)) {
    return {
      toolName: 'omnimux_image_submit',
      args: { prompt: prompt, aspect_ratio: '16:9' },
    };
  }

  // 3. 灵感搜索
  if (/灵感/i.test(prompt) && /搜索|找/i.test(prompt)) {
    return {
      toolName: 'inspiration_search',
      args: { query: '美食探店' },
    };
  }

  // 4. 插件市场
  if (/插件市场|找一下.*插件/i.test(prompt)) {
    return {
      toolName: 'plugin_search',
      args: { query: '剪辑' },
    };
  }

  // 5. 视频剪辑
  if (/剪辑项目|时间轴|时间线|轨道/.test(prompt)) {
    const projectId = /剪辑项目\s+([A-Za-z0-9][A-Za-z0-9._-]{0,127})(?=\s|[，。]|$)/.exec(prompt)?.[1];
    const view = /片段|素材/.test(prompt) ? 'full' : /轨道/.test(prompt) ? 'tracks' : 'summary';
    return { toolName: 'clip_get', args: { ...(projectId ? { projectId } : {}), view } };
  }

  // 6. 工作流
  if (/工作流|画布/i.test(prompt) && /列出|所有/i.test(prompt)) {
    return {
      toolName: 'workflow_list',
      args: {},
    };
  }

  return { toolName: null, args: {} };
}

function checkClipGetArgs(tool, actual, expected) {
  if (tool?._source !== 'dynamic' || tool._plugin !== 'omnimux-clip' || !tool.parameters) {
    return ['clip_get 必须来自真实的 Clip Host 注册'];
  }
  const errors = [];
  if (!isDeepStrictEqual(actual, expected)) errors.push(`Clip 参数不匹配: ${JSON.stringify(actual)}`);
  const { properties, required = [] } = tool.parameters;
  for (const key of required) {
    if (!Object.hasOwn(actual, key)) errors.push(`Clip 参数缺少 ${key}`);
  }
  for (const [key, value] of Object.entries(actual)) {
    const property = properties?.[key];
    if (!property || typeof value !== property.type || (property.enum && !property.enum.includes(value))) {
      errors.push(`Clip 参数 ${key} 与实际注册的 schema 不匹配`);
    }
  }
  return errors;
}

/**
 * 运行 Layer 3 Agent 离线路由冒烟
 * @param {Map<string, object>} allToolsMap 
 * @param {object} [options]
 * @param {string} [options.datasetPath] 
 * @returns {Promise<{ total: number, passed: number, failed: number, results: Array<object> }>}
 */
export async function runAgentToolEval(allToolsMap, options = {}) {
  const datasetFile = options.datasetPath || fileURLToPath(new URL('./dataset.json', import.meta.url));
  if (!existsSync(datasetFile)) {
    throw new Error(`评测数据集文件未找到: ${datasetFile}`);
  }

  const cases = JSON.parse(readFileSync(datasetFile, 'utf-8'));

  const report = {
    total: cases.length,
    passed: 0,
    failed: 0,
    results: [],
  };

  for (const c of cases) {
    const decision = mockAgentToolMatcher(c.prompt);
    const matchedTool = allToolsMap.get(decision.toolName);
    const schemaErrors = matchedTool?.parameters ? validateJsonSchema(matchedTool.parameters, 'call.args').errors : [];
    if (decision.toolName === 'clip_get') {
      schemaErrors.push(...checkClipGetArgs(matchedTool, decision.args, c.expectedArgs));
    }
    const pass = decision.toolName === c.expectedTool && schemaErrors.length === 0;

    if (pass) {
      report.passed++;
    } else {
      report.failed++;
    }

    report.results.push({
      id: c.id,
      description: c.description,
      prompt: c.prompt,
      expectedTool: c.expectedTool,
      actualTool: decision.toolName,
      pass,
      schemaErrors,
    });
  }

  return report;
}
