#!/usr/bin/env node
/**
 * @file scripts/code-refactor-analyzer.mjs
 * OmniMux 代码重构与简化分析工具 (Code Refactor & Simplification Analyzer - CRSA)
 * 
 * 核心目标：
 * 1. 深度分析代码行数过多情况（文件级、函数级、组件级体积膨胀，切点定位）。
 * 2. 深度分析业务逻辑混乱情况（圈复杂度、认知复杂度、深层嵌套、布尔密度、散弹返回、反模式检测）。
 * 3. 自动生成确定性的重构模式建议（Guard Clauses, Lookup Table, Extract Function, Decompose Conditional 等）。
 * 4. 支持 CLI 终端富文本展示、JSON 结构化输出、CI 门禁检查及 Node.js 编程式 API 导入。
 *
 * 用法：
 *   node scripts/code-refactor-analyzer.mjs [路径/glob...] [选项]
 *   node scripts/code-refactor-analyzer.mjs src/ --check
 *   node scripts/code-refactor-analyzer.mjs plugins/ --format json --output report.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认分析阈值配置
export const DEFAULT_THRESHOLDS = {
  maxFileLines: 400,          // 单文件有效代码行数 (SLOC) 阈值
  maxFuncLines: 45,           // 单函数有效代码行数阈值
  maxCyclomatic: 10,          // 圈复杂度告警阈值
  maxCognitive: 15,           // 认知复杂度告警阈值
  maxDepth: 4,                // 最大嵌套深度阈值 (0-indexed base, 4 表示嵌套第 4 层)
  maxParams: 4,               // 最大形参数量阈值
  maxBooleanDensity: 3,       // 单条件语句中最大逻辑运算符数量
  maxReturns: 4,              // 单函数分散 return 数量阈值
  failOnLevel: 'D',           // 门禁阻断最低等级 ('B' | 'C' | 'D' | 'F')
};

export const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.vue'
]);

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/lib/**',
  '**/dist-harness/**',
  '**/openreel/**',
];

export const TEST_FILE_RE = /(?:^|[./\\])[^/\\]*\.(?:test|spec)\.[^/\\]+$/;
export const MODULE_LOADER_MARK = 'window.__ModuleLoader__';
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'lib',
  'coverage',
  'dist-harness',
  'openreel',
]);

const emptyBucket = () => ({ files: 0, sloc: 0, smells: 0, scoreSum: 0 });

function toPosix(filePath) {
  return String(filePath).split(path.sep).join('/');
}

/**
 * Convert a simple glob (`*`, `**`, literals) into a anchored RegExp.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let i = 0;
  let out = '^';
  const text = String(pattern);
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      if (text[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 3;
        continue;
      }
      out += '.*';
      i += 2;
      continue;
    }
    if (text[i] === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (text[i] === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += text[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  out += '$';
  return new RegExp(out);
}

/**
 * @param {string} relPath posix-ish path relative to the walk root or cwd
 * @param {string[]} [patterns=DEFAULT_IGNORE_PATTERNS]
 */
export function matchesIgnore(relPath, patterns = DEFAULT_IGNORE_PATTERNS) {
  const rel = toPosix(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
  return patterns.some((pattern) => {
    const re = globToRegExp(pattern);
    return re.test(rel) || re.test(`${rel}/`);
  });
}

/**
 * Classify a file into the CRSA reporting bucket.
 * Path-based vendor/generated still win even if the file was passed explicitly.
 * @param {string} filePath
 * @param {string} [source='']
 * @returns {'source'|'generated'|'vendor'|'tests'}
 */
export function classifyFile(filePath, source = '') {
  const rel = toPosix(filePath);
  if (/(?:^|\/)openreel(?:\/|$)/i.test(rel) || matchesIgnore(rel, ['**/openreel/**'])) {
    return 'vendor';
  }
  if (matchesIgnore(rel, ['**/lib/**', '**/dist/**', '**/dist-harness/**', '**/build/**'])) {
    return 'generated';
  }
  if (String(source).slice(0, 2048).includes(MODULE_LOADER_MARK)) {
    return 'generated';
  }
  if (TEST_FILE_RE.test(rel)) return 'tests';
  return 'source';
}

function levelFromScore(avgHealthScore) {
  if (avgHealthScore < 40) return 'F';
  if (avgHealthScore < 60) return 'D';
  if (avgHealthScore < 75) return 'C';
  if (avgHealthScore < 90) return 'B';
  return 'A';
}

/**
 * ANSI 颜色输出工具
 */
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function c(color, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return String(text);
  return `${colors[color] || ''}${text}${colors.reset}`;
}

/**
 * 核心源码解析与指标分析
 * @param {string} source 源码字符串
 * @param {string} [filename='anonymous.js'] 文件名或路径
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [customThresholds={}] 自定义阈值
 * @returns {FileAnalysisResult}
 */
export function analyzeSource(source, filename = 'anonymous.js', customThresholds = {}) {
  const config = { ...DEFAULT_THRESHOLDS, ...customThresholds };
  const lines = source.split(/\r?\n/);
  const totalLOC = lines.length;

  let sloc = 0;
  let blankLines = 0;
  let commentLines = 0;
  let inBlockComment = false;

  // 正则定义
  const FUNC_DECL_REGEX = /(?:(?:async\s+)?function(?:\s+([\w$]+))?\s*\(|(?:\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)|(?:\b([\w$]+)\s*\([^)]*\)\s*\{))/;
  const DECISION_KEYWORDS_REGEX = /\b(if|else\s+if|for|while|do|case|catch)\b/g;
  const LOGICAL_OPS_REGEX = /(&&|\|\||\?\?)/g;
  const TERNARY_REGEX = /\?/g;
  const RETURN_REGEX = /\breturn\b/g;

  // 第一遍：计算行级总体指标
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      blankLines++;
      continue;
    }
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
      commentLines++;
      continue;
    }
    sloc++;
  }

  // 第二遍：流式状态栈分析
  const functions = [];
  const smells = [];
  let currentDepth = 0;
  let maxDepthInFile = 0;
  let currentFunc = null;
  const funcStack = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const rawLine = lines[lineIdx];
    
    // 剔除字符串与注释后做控制流分析
    let cleanLine = rawLine
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      .replace(/(["'`])(?:\\.|[^\\])*?\1/g, '""');
    const trimmed = cleanLine.trim();

    if (!trimmed) continue;

    // 1. 函数定义与捕获 (排除 control keywords 如 if / else if / for / while / switch / catch)
    const normalizedTrimmed = trimmed.replace(/^[\}\s]+/, '');
    const isControlKeyword = /^(if|else\s+if|else|for|while|switch|catch)\b/.test(normalizedTrimmed);
    const funcMatch = !isControlKeyword ? normalizedTrimmed.match(FUNC_DECL_REGEX) : null;
    
    if (funcMatch && !isControlKeyword) {
      const funcName = funcMatch[1] || funcMatch[2] || funcMatch[3] || `<anonymous_L${lineNum}>`;
      
      // 提取入参数量
      const paramStrMatch = trimmed.match(/\(([^)]*)\)/);
      const paramCount = paramStrMatch && paramStrMatch[1].trim()
        ? paramStrMatch[1].split(',').map(s => s.trim()).filter(Boolean).length
        : 0;

      const newFunc = {
        name: funcName,
        startLine: lineNum,
        endLine: -1,
        loc: 0,
        sloc: 0,
        cyclomatic: 1,
        cognitive: 0,
        maxDepth: 0,
        returnCount: 0,
        paramCount,
        nestingLevelAtStart: currentDepth,
      };

      if (paramCount > config.maxParams) {
        smells.push({
          type: 'LONG_PARAMETER_LIST',
          category: 'COMPLEXITY',
          line: lineNum,
          message: `函数 "${funcName}" 形参数量过多 (${paramCount} > ${config.maxParams})`,
          recommendation: '使用参数对象 (Parameter Object / Options) 封装入参，提高可读性与扩展性。',
        });
      }

      if (currentFunc) {
        funcStack.push(currentFunc);
      }
      currentFunc = newFunc;
      functions.push(newFunc);
    }

    // 2. 跟踪括号与嵌套深度
    const openBraces = (cleanLine.match(/\{/g) || []).length;
    const closeBraces = (cleanLine.match(/\}/g) || []).length;

    if (openBraces > 0) {
      for (let i = 0; i < openBraces; i++) {
        currentDepth++;
        if (currentDepth > maxDepthInFile) maxDepthInFile = currentDepth;
        if (currentFunc) {
          const relDepth = currentDepth - currentFunc.nestingLevelAtStart;
          if (relDepth > currentFunc.maxDepth) {
            currentFunc.maxDepth = relDepth;
          }
        }
      }
    }

    // 3. 嵌套深度超标异味
    if (currentDepth >= config.maxDepth) {
      // 避免单行重复告警，仅在深层逻辑处告警
      if (trimmed.startsWith('if') || trimmed.startsWith('for') || trimmed.startsWith('while') || trimmed.includes('=>')) {
        smells.push({
          type: 'DEEP_NESTING',
          category: 'CHAOTIC_LOGIC',
          line: lineNum,
          message: `第 ${lineNum} 行嵌套深度达 ${currentDepth} 层 (阈值: ${config.maxDepth})`,
          recommendation: '使用 Guard Clauses (卫语句提前返回) 或将内层嵌套块提炼为独立函数 (Extract Function)。',
        });
      }
    }

    // 4. 复杂度与控制流异味计算 (基于当前函数作用域)
    if (currentFunc) {
      currentFunc.loc++;
      if (trimmed) currentFunc.sloc++;

      // 圈复杂度累加 (McCabe)
      const decisionMatches = cleanLine.match(DECISION_KEYWORDS_REGEX) || [];
      const logicalMatches = cleanLine.match(LOGICAL_OPS_REGEX) || [];
      const ternaryMatches = cleanLine.match(TERNARY_REGEX) || [];

      currentFunc.cyclomatic += decisionMatches.length + logicalMatches.length + ternaryMatches.length;

      // 认知复杂度累加 (SonarQube-aligned: 基础打断 + 嵌套深度加权)
      const relativeNesting = Math.max(0, currentDepth - currentFunc.nestingLevelAtStart - 1);
      for (let d = 0; d < decisionMatches.length; d++) {
        currentFunc.cognitive += (1 + relativeNesting);
      }
      for (let t = 0; t < ternaryMatches.length; t++) {
        currentFunc.cognitive += (1 + relativeNesting);
      }
      currentFunc.cognitive += logicalMatches.length;

      // 条件布尔密度检查 (Boolean Operator Density)
      if (logicalMatches.length >= config.maxBooleanDensity) {
        smells.push({
          type: 'HIGH_BOOLEAN_DENSITY',
          category: 'CHAOTIC_LOGIC',
          line: lineNum,
          message: `第 ${lineNum} 行存在高密度布尔运算 (${logicalMatches.length} 个逻辑运算符)`,
          recommendation: '使用 Decompose Conditional (条件分解)，将复合表达式提取为语义明确的具名 boolean 变量。',
        });
      }

      // 复杂多重三元表达式检测
      if (ternaryMatches.length >= 2 && cleanLine.includes(':')) {
        smells.push({
          type: 'NESTED_TERNARY',
          category: 'CHAOTIC_LOGIC',
          line: lineNum,
          message: `第 ${lineNum} 行存在嵌套三元表达式 (Nested Ternary)`,
          recommendation: '改用标准 if-else 语句或 Lookup Table (查表映射) 替换嵌套三元运算符。',
        });
      }

      // Return 出口捕获
      const returnMatches = cleanLine.match(RETURN_REGEX) || [];
      currentFunc.returnCount += returnMatches.length;
    }

    // 5. 括号闭合与函数退出处理
    if (closeBraces > 0) {
      for (let i = 0; i < closeBraces; i++) {
        currentDepth = Math.max(0, currentDepth - 1);
        if (currentFunc && currentDepth <= currentFunc.nestingLevelAtStart) {
          currentFunc.endLine = lineNum;

          // 函数级体积与逻辑健康度审查
          if (currentFunc.sloc > config.maxFuncLines) {
            smells.push({
              type: 'LONG_FUNCTION',
              category: 'CODE_BLOAT',
              line: currentFunc.startLine,
              message: `函数 "${currentFunc.name}" 代码行数过多 (${currentFunc.sloc} 行 SLOC > ${config.maxFuncLines} 行)`,
              recommendation: `识别单一职责子逻辑，执行 Extract Function (提炼函数) 或抽离业务子模块。`,
            });
          }

          if (currentFunc.cyclomatic > config.maxCyclomatic) {
            smells.push({
              type: 'HIGH_CYCLOMATIC_COMPLEXITY',
              category: 'CHAOTIC_LOGIC',
              line: currentFunc.startLine,
              message: `函数 "${currentFunc.name}" 圈复杂度过高 (${currentFunc.cyclomatic} > ${config.maxCyclomatic})`,
              recommendation: '使用 Lookup Table (查表法) 或 Strategy Pattern (策略模式) 替换复杂分支控制流。',
            });
          }

          if (currentFunc.cognitive > config.maxCognitive) {
            smells.push({
              type: 'HIGH_COGNITIVE_COMPLEXITY',
              category: 'CHAOTIC_LOGIC',
              line: currentFunc.startLine,
              message: `函数 "${currentFunc.name}" 认知复杂度超标 (${currentFunc.cognitive} > ${config.maxCognitive})`,
              recommendation: '拍平嵌套结构，引入 Guard Clauses (卫语句提前返回) 降低心智负担。',
            });
          }

          if (currentFunc.returnCount > config.maxReturns && currentFunc.maxDepth >= 3) {
            smells.push({
              type: 'SCATTERED_RETURNS',
              category: 'CHAOTIC_LOGIC',
              line: currentFunc.startLine,
              message: `函数 "${currentFunc.name}" 存在 ${currentFunc.returnCount} 处深层分散 return 语句`,
              recommendation: '收敛函数出口或在函数顶部统一处理前置条件拦截。',
            });
          }

          currentFunc = funcStack.length > 0 ? funcStack.pop() : null;
        }
      }
    }
  }

  // 6. 文件级别异味检测 (代码行数过多 / God File)
  if (sloc > config.maxFileLines) {
    smells.push({
      type: 'LARGE_FILE',
      category: 'CODE_BLOAT',
      line: 1,
      message: `文件总体积过大 (${sloc} 行 SLOC > ${config.maxFileLines} 行)`,
      recommendation: '按业务领域或功能层级进行文件拆分 (Split Module / Extract Components / Move to Services)。',
    });
  }

  // 7. 综合健康度打分模型 (Health Scoring Model: 100 扣分制)
  let penalty = 0;
  for (const s of smells) {
    switch (s.type) {
      case 'LARGE_FILE': penalty += 15; break;
      case 'LONG_FUNCTION': penalty += 8; break;
      case 'HIGH_CYCLOMATIC_COMPLEXITY': penalty += 10; break;
      case 'HIGH_COGNITIVE_COMPLEXITY': penalty += 10; break;
      case 'DEEP_NESTING': penalty += 5; break;
      case 'NESTED_TERNARY': penalty += 6; break;
      case 'HIGH_BOOLEAN_DENSITY': penalty += 4; break;
      case 'LONG_PARAMETER_LIST': penalty += 3; break;
      case 'SCATTERED_RETURNS': penalty += 4; break;
      default: penalty += 3;
    }
  }

  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  let healthLevel = 'A';
  if (healthScore < 40) healthLevel = 'F';
  else if (healthScore < 60) healthLevel = 'D';
  else if (healthScore < 75) healthLevel = 'C';
  else if (healthScore < 90) healthLevel = 'B';

  return {
    filename,
    metrics: {
      totalLOC,
      sloc,
      blankLines,
      commentLines,
      maxDepth: maxDepthInFile,
      functionCount: functions.length,
      avgCyclomatic: functions.length ? +(functions.reduce((acc, f) => acc + f.cyclomatic, 0) / functions.length).toFixed(1) : 1,
      avgCognitive: functions.length ? +(functions.reduce((acc, f) => acc + f.cognitive, 0) / functions.length).toFixed(1) : 0,
    },
    healthScore,
    healthLevel,
    functions,
    smells,
  };
}

/**
 * 分析指定文件
 * @param {string} filePath 文件绝对或相对路径
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [thresholds={}]
 * @returns {FileAnalysisResult}
 */
export function analyzeFile(filePath, thresholds = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const report = analyzeSource(content, filePath, thresholds);
  report.bucket = classifyFile(filePath, content);
  return report;
}

/**
 * 递归收集目标路径下符合条件的文件列表
 * @param {string} targetPath 目录或文件路径
 * @param {string[]} [customIgnore=[]]
 * @param {{ root?: string }} [options={}]
 * @returns {string[]}
 */
export function collectFiles(targetPath, customIgnore = [], options = {}) {
  const ignore = [...DEFAULT_IGNORE_PATTERNS, ...customIgnore];
  const root = options.root || process.cwd();
  const stat = fs.statSync(targetPath);

  const relOf = (abs) => {
    const rel = toPosix(path.relative(root, abs) || path.basename(abs));
    return rel.replace(/^\.\//, '');
  };

  if (stat.isFile()) {
    const ext = path.extname(targetPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return [];
    if (matchesIgnore(relOf(targetPath), ignore)) return [];
    return [targetPath];
  }

  const results = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP_DIR_NAMES.has(entry.name)) continue;

    const rel = relOf(fullPath);
    if (entry.isDirectory()) {
      if (matchesIgnore(`${rel}/`, ignore) || matchesIgnore(rel, ignore)) continue;
      results.push(...collectFiles(fullPath, customIgnore, { root }));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    if (matchesIgnore(rel, ignore)) continue;
    results.push(fullPath);
  }
  return results;
}

/**
 * 批量分析工程或目录
 * @param {string|string[]} targets
 * @param {Partial<typeof DEFAULT_THRESHOLDS> & { includeGenerated?: boolean, ignore?: string[] }} [thresholds={}]
 * @returns {ProjectAnalysisReport}
 */
export function analyzeProject(targets, thresholds = {}) {
  const { includeGenerated = false, ignore: customIgnore = [], ...metricThresholds } = thresholds;
  const targetList = Array.isArray(targets) ? targets : [targets];
  const allFiles = [];

  for (const t of targetList) {
    if (fs.existsSync(t)) {
      allFiles.push(...collectFiles(t, customIgnore));
    }
  }

  // 去重
  const uniqueFiles = Array.from(new Set(allFiles));
  const fileReports = [];
  const buckets = {
    source: emptyBucket(),
    generated: emptyBucket(),
    vendor: emptyBucket(),
    tests: emptyBucket(),
  };

  for (const file of uniqueFiles) {
    try {
      const report = analyzeFile(file, metricThresholds);
      fileReports.push(report);
      const bucket = buckets[report.bucket] || buckets.source;
      bucket.files += 1;
      bucket.sloc += report.metrics.sloc;
      bucket.smells += report.smells.length;
      bucket.scoreSum += report.healthScore;
    } catch (err) {
      console.error(`[CRSA Error] 分析文件失败 ${file}: ${err.message}`);
    }
  }

  const scoring = includeGenerated
    ? fileReports.filter((f) => f.bucket === 'source' || f.bucket === 'generated')
    : fileReports.filter((f) => f.bucket === 'source');
  const scoreSum = scoring.reduce((acc, f) => acc + f.healthScore, 0);
  const totalSLOC = scoring.reduce((acc, f) => acc + f.metrics.sloc, 0);
  const totalFunctions = scoring.reduce((acc, f) => acc + f.metrics.functionCount, 0);
  const totalSmells = scoring.reduce((acc, f) => acc + f.smells.length, 0);
  const avgHealthScore = scoring.length ? Math.round(scoreSum / scoring.length) : 100;
  const projectLevel = levelFromScore(avgHealthScore);

  const bucketSummary = Object.fromEntries(
    Object.entries(buckets).map(([name, stats]) => [
      name,
      {
        files: stats.files,
        sloc: stats.sloc,
        smells: stats.smells,
        avgHealthScore: stats.files ? Math.round(stats.scoreSum / stats.files) : 100,
      },
    ]),
  );

  return {
    summary: {
      totalFiles: scoring.length,
      scannedFiles: fileReports.length,
      totalSLOC,
      totalFunctions,
      totalSmells,
      avgHealthScore,
      projectLevel,
      analyzedAt: new Date().toISOString(),
      includeGenerated,
      buckets: bucketSummary,
    },
    files: fileReports,
  };
}

/**
 * 格式化生成报表输出
 * @param {ProjectAnalysisReport} report
 * @param {'console'|'json'|'markdown'} [format='console']
 * @returns {string}
 */
export function formatReport(report, format = 'console') {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  if (format === 'markdown') {
    let md = `# 代码重构与简化分析报表 (CRSA Report)\n\n`;
    md += `**分析时间**: ${report.summary.analyzedAt}\n`;
    md += `**工程综合健康评分**: \`${report.summary.avgHealthScore} / 100\` (等级: **${report.summary.projectLevel}**，仅自研 source)\n`;
    md += `**计入等级的文件**: ${report.summary.totalFiles} | **扫描文件**: ${report.summary.scannedFiles ?? report.summary.totalFiles} | **代码有效行 (SLOC)**: ${report.summary.totalSLOC} | **函数总数**: ${report.summary.totalFunctions} | **代码异味总数**: ${report.summary.totalSmells}\n`;
    if (report.summary.buckets) {
      const b = report.summary.buckets;
      md += `**分桶**: source ${b.source?.files ?? 0} | generated ${b.generated?.files ?? 0} | vendor ${b.vendor?.files ?? 0} | tests ${b.tests?.files ?? 0}\n\n`;
    } else {
      md += `\n`;
    }

    md += `## 待重构文件与问题清单\n\n`;
    for (const f of report.files) {
      if (f.smells.length === 0 && f.healthLevel === 'A') continue;
      md += `### 📄 \`${f.filename}\` (健康分: ${f.healthScore}, 评级: ${f.healthLevel})\n\n`;
      md += `- **SLOC**: ${f.metrics.sloc} | **函数**: ${f.metrics.functionCount} | **最大嵌套**: ${f.metrics.maxDepth}\n\n`;
      if (f.smells.length > 0) {
        md += `| 行号 | 类别 | 问题描述 | 重构简化建议 |\n`;
        md += `| :--- | :--- | :--- | :--- |\n`;
        for (const s of f.smells) {
          md += `| L${s.line} | \`${s.category}\` | ${s.message} | ${s.recommendation} |\n`;
        }
        md += `\n`;
      }
    }
    return md;
  }

  // 默认控制台富文本表格格式 (console)
  const lines = [];
  lines.push('');
  lines.push(c('bold', c('cyan', '╔════════════════════════════════════════════════════════════════════════════════════════╗')));
  lines.push(c('bold', c('cyan', '║             🔍 OmniMux 代码重构与简化分析报告 (Code Refactor Analyzer)             ║')));
  lines.push(c('bold', c('cyan', '╚════════════════════════════════════════════════════════════════════════════════════════╝')));
  lines.push('');

  const s = report.summary;
  const levelColor = s.projectLevel === 'A' ? 'green' : s.projectLevel === 'B' ? 'cyan' : s.projectLevel === 'C' ? 'yellow' : 'red';
  
  lines.push(`  ${c('bold', '工程健康总评分:')} ${c(levelColor, c('bold', `${s.avgHealthScore} / 100`))} [${c(levelColor, c('bold', `等级 ${s.projectLevel}`))}] ${c('gray', '(仅自研 source)')}`);
  lines.push(`  ${c('gray', '计入等级:')} ${c('bold', s.totalFiles)}  |  ${c('gray', '扫描文件:')} ${c('bold', s.scannedFiles ?? s.totalFiles)}  |  ${c('gray', '源码行数 (SLOC):')} ${c('bold', s.totalSLOC)} 行  |  ${c('gray', '函数总量:')} ${c('bold', s.totalFunctions)}  |  ${c('gray', '异味/重构点:')} ${c(s.totalSmells > 0 ? 'yellow' : 'green', c('bold', s.totalSmells))}`);
  if (s.buckets) {
    const b = s.buckets;
    lines.push(`  ${c('gray', '分桶:')} source ${b.source?.files ?? 0}  generated ${b.generated?.files ?? 0}  vendor ${b.vendor?.files ?? 0}  tests ${b.tests?.files ?? 0}`);
  }
  lines.push('');

  // 严重与告警文件展开
  const problemFiles = report.files.filter(f => f.smells.length > 0 || f.healthLevel !== 'A');

  if (problemFiles.length === 0) {
    lines.push(c('green', '  ✓ 未发现明显的代码行数过多或业务逻辑混乱问题，代码结构整洁！'));
    lines.push('');
  } else {
    lines.push(c('bold', '┌─────────────────────────────────────────────────────────────────────────────────────────┐'));
    lines.push(c('bold', '│ ⚠️  待重构优化文件与问题切点详情                                                         │'));
    lines.push(c('bold', '└─────────────────────────────────────────────────────────────────────────────────────────┘'));
    lines.push('');

    for (const f of problemFiles) {
      const fileColor = f.healthLevel === 'A' ? 'green' : f.healthLevel === 'B' ? 'cyan' : f.healthLevel === 'C' ? 'yellow' : 'red';
      lines.push(`  ${c('bold', c('magenta', '📄 ' + f.filename))}`);
      lines.push(`     ${c('gray', '健康分:')} ${c(fileColor, f.healthScore)} [${c(fileColor, f.healthLevel)}] | ${c('gray', 'SLOC:')} ${f.metrics.sloc} | ${c('gray', '最大嵌套深度:')} ${f.metrics.maxDepth} | ${c('gray', '平均圈复杂度:')} ${f.metrics.avgCyclomatic}`);
      
      for (const smell of f.smells) {
        const catBadge = smell.category === 'CODE_BLOAT' 
          ? c('blue', '[体积膨胀]') 
          : c('yellow', '[逻辑混乱]');
        lines.push(`     ${c('red', '•')} ${c('gray', `L${smell.line}`.padEnd(5))} ${catBadge} ${c('bold', smell.message)}`);
        lines.push(`       ${c('green', '↳ 重构建议:')} ${smell.recommendation}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 解析 CLI 命令行参数
 */
function parseCliArgs(args) {
  const options = {
    targets: [],
    format: 'console',
    output: null,
    check: false,
    failOnLevel: 'D',
    includeGenerated: false,
    thresholds: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' || arg === '-f') {
      options.format = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--include-generated') {
      options.includeGenerated = true;
    } else if (arg === '--fail-on-level') {
      options.failOnLevel = args[++i].toUpperCase();
    } else if (arg === '--max-file-lines') {
      options.thresholds.maxFileLines = parseInt(args[++i], 10);
    } else if (arg === '--max-func-lines') {
      options.thresholds.maxFuncLines = parseInt(args[++i], 10);
    } else if (arg === '--max-cyclomatic') {
      options.thresholds.maxCyclomatic = parseInt(args[++i], 10);
    } else if (arg === '--max-cognitive') {
      options.thresholds.maxCognitive = parseInt(args[++i], 10);
    } else if (arg === '--max-depth') {
      options.thresholds.maxDepth = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      options.targets.push(arg);
    }
  }

  if (options.targets.length === 0) {
    options.targets.push('src', 'plugins', 'scripts');
  }

  return options;
}

function printHelp() {
  console.log(`
${c('bold', 'OmniMux 代码重构与简化分析工具 (CRSA CLI)')}

${c('bold', '用法:')}
  node scripts/code-refactor-analyzer.mjs [路径...] [选项]

${c('bold', '选项:')}
  -f, --format <console|json|markdown>  报表输出格式 (默认: console)
  -o, --output <file>                  输出到文件
  --check                              CI 门禁模式 (达不到目标等级时以退出码 1 退出)
  --include-generated                  把 generated 桶并进工程等级 (默认只算 source)
  --fail-on-level <B|C|D|F>            门禁失败最低健康等级 (默认: D)
  --max-file-lines <N>                 单文件有效代码行 (SLOC) 阈值 (默认: 400)
  --max-func-lines <N>                 单函数有效代码行阈值 (默认: 45)
  --max-cyclomatic <N>                 单函数圈复杂度阈值 (默认: 10)
  --max-cognitive <N>                  单函数认知复杂度阈值 (默认: 15)
  --max-depth <N>                      最大嵌套深度阈值 (默认: 4)
  -h, --help                           显示帮助信息

${c('bold', '示例:')}
  node scripts/code-refactor-analyzer.mjs scripts/
  node scripts/code-refactor-analyzer.mjs plugins/omnimux --check --fail-on-level C
  node scripts/code-refactor-analyzer.mjs . --format json --output crsa-report.json
`);
}

/**
 * CLI 执行入口
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseCliArgs(args);

  const report = analyzeProject(options.targets, {
    ...options.thresholds,
    includeGenerated: options.includeGenerated,
  });
  const outputText = formatReport(report, options.format);

  if (options.output) {
    fs.writeFileSync(options.output, outputText, 'utf8');
    console.log(c('green', `✓ 分析报表已写入: ${options.output}`));
  } else {
    console.log(outputText);
  }

  if (options.check) {
    const levelOrder = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'F': 4 };
    const currentScore = levelOrder[report.summary.projectLevel] ?? 0;
    const failScore = levelOrder[options.failOnLevel] ?? 3;

    if (currentScore >= failScore) {
      console.error(c('red', `✗ [CRSA Gate Failure] 工程健康等级为 ${report.summary.projectLevel}，低于允许门禁等级 ${options.failOnLevel}！请根据重构建议优化代码。`));
      process.exit(1);
    } else {
      console.log(c('green', `✓ [CRSA Gate Pass] 工程健康等级为 ${report.summary.projectLevel}，通过门禁检查 (${options.failOnLevel})。`));
    }
  }
}

// 当作为 CLI 脚本直接运行时调用 main
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
