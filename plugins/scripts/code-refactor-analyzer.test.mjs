/**
 * @file scripts/code-refactor-analyzer.test.mjs
 * CRSA 代码重构与简化分析工具单元测试集
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeSource,
  analyzeProject,
  analyzeFile,
  collectFiles,
  classifyFile,
  matchesIgnore,
  formatReport,
  DEFAULT_THRESHOLDS,
} from './code-refactor-analyzer.mjs';

describe('CRSA (Code Refactor & Simplification Analyzer) 核心测试', () => {

  describe('1. 代码行数过多情况分析 (Code Bloat)', () => {
    it('应正确计算 SLOC、注释行与空行', () => {
      const code = `
        // 单行注释
        /* 多行
           注释 */
        function hello() {
          const a = 1;
          
          return a;
        }
      `;
      const result = analyzeSource(code, 'test.js');
      assert.equal(result.metrics.blankLines >= 2, true);
      assert.equal(result.metrics.commentLines >= 3, true);
      assert.equal(result.metrics.sloc >= 4, true);
    });

    it('应检测出超长函数并给出 Extract Function 重构建议', () => {
      // 构造超过 10 行的函数 (设置阈值为 5)
      const lines = ['function megaFunction() {'];
      for (let i = 0; i < 15; i++) {
        lines.push(`  const step${i} = ${i} * 2;`);
      }
      lines.push('  return step0;');
      lines.push('}');
      const code = lines.join('\n');

      const result = analyzeSource(code, 'megaFunc.js', { maxFuncLines: 5 });
      assert.equal(result.functions.length, 1);
      assert.equal(result.functions[0].sloc > 5, true);

      const longFuncSmell = result.smells.find(s => s.type === 'LONG_FUNCTION');
      assert.ok(longFuncSmell, '应捕获 LONG_FUNCTION 异味');
      assert.equal(longFuncSmell.category, 'CODE_BLOAT');
      assert.match(longFuncSmell.recommendation, /Extract Function/);
    });

    it('应检测出单文件体积过大并给出 Split Module 建议', () => {
      const lines = [];
      for (let i = 0; i < 50; i++) {
        lines.push(`const var_${i} = ${i};`);
      }
      const code = lines.join('\n');

      const result = analyzeSource(code, 'bigFile.js', { maxFileLines: 20 });
      const bigFileSmell = result.smells.find(s => s.type === 'LARGE_FILE');
      assert.ok(bigFileSmell, '应捕获 LARGE_FILE 异味');
      assert.match(bigFileSmell.recommendation, /Split Module/);
    });
  });

  describe('2. 业务逻辑混乱情况分析 (Chaotic Logic)', () => {
    it('应准确计算圈复杂度 (Cyclomatic Complexity) 并告警', () => {
      const code = `
        function complexLogic(a, b, c, d) {
          if (a > 1) {
            if (b && c) {
              for (let i = 0; i < 5; i++) {
                while (d) {
                  return 1;
                }
              }
            }
          } else if (b || c) {
            return 2;
          }
          return 0;
        }
      `;
      const result = analyzeSource(code, 'complex.js', { maxCyclomatic: 4 });
      assert.equal(result.functions.length, 1);
      assert.ok(result.functions[0].cyclomatic > 4, '圈复杂度应大于 4');

      const ccSmell = result.smells.find(s => s.type === 'HIGH_CYCLOMATIC_COMPLEXITY');
      assert.ok(ccSmell, '应捕获 HIGH_CYCLOMATIC_COMPLEXITY 异味');
      assert.match(ccSmell.recommendation, /Lookup Table|Strategy Pattern/);
    });

    it('应检测深层嵌套 (Deep Nesting) 并给出 Guard Clauses 重构建议', () => {
      const code = `
        function deeplyNested(x) {
          if (x > 0) {
            if (x > 10) {
              if (x > 20) {
                if (x > 30) {
                  return 'deep';
                }
              }
            }
          }
          return 'shallow';
        }
      `;
      const result = analyzeSource(code, 'deep.js', { maxDepth: 3 });
      const depthSmell = result.smells.find(s => s.type === 'DEEP_NESTING');
      assert.ok(depthSmell, '应捕获 DEEP_NESTING 异味');
      assert.match(depthSmell.recommendation, /Guard Clauses/);
    });

    it('应检测高密度布尔条件并给出 Decompose Conditional 建议', () => {
      const code = `
        function validate(user) {
          if (user.active && user.age > 18 && user.verified && user.role === 'admin') {
            return true;
          }
          return false;
        }
      `;
      const result = analyzeSource(code, 'boolean.js', { maxBooleanDensity: 2 });
      const boolSmell = result.smells.find(s => s.type === 'HIGH_BOOLEAN_DENSITY');
      assert.ok(boolSmell, '应捕获 HIGH_BOOLEAN_DENSITY 异味');
      assert.match(boolSmell.recommendation, /Decompose Conditional/);
    });

    it('应检测多层嵌套三元表达式 (Nested Ternary)', () => {
      const code = `
        function getStatus(code) {
          return code === 200 ? 'OK' : code === 404 ? 'Not Found' : 'Error';
        }
      `;
      const result = analyzeSource(code, 'ternary.js');
      const ternarySmell = result.smells.find(s => s.type === 'NESTED_TERNARY');
      assert.ok(ternarySmell, '应捕获 NESTED_TERNARY 异味');
    });

    it('应检测超长参数列表 (Long Parameter List)', () => {
      const code = `
        function createAccount(username, email, password, phone, role, department) {
          return { username, email };
        }
      `;
      const result = analyzeSource(code, 'params.js', { maxParams: 3 });
      const paramSmell = result.smells.find(s => s.type === 'LONG_PARAMETER_LIST');
      assert.ok(paramSmell, '应捕获 LONG_PARAMETER_LIST 异味');
      assert.match(paramSmell.recommendation, /Parameter Object/);
    });

    it('应支持 async 箭头函数与 TypeScript/JSX 语法解析', () => {
      const tsxCode = `
        export const UserProfile = async (props: { id: string }) => {
          const { id } = props;
          if (!id) {
            return null;
          }
          return <div>User: {id}</div>;
        };
      `;
      const result = analyzeSource(tsxCode, 'UserProfile.tsx');
      assert.equal(result.functions.length, 1);
      assert.equal(result.functions[0].name, 'UserProfile');
      assert.equal(result.healthLevel, 'A');
    });
  });

  describe('3. 健康度评分与评级 (Health Score & Grade)', () => {
    it('整洁代码应获得等级 A 与高分', () => {
      const cleanCode = `
        export function add(a, b) {
          return a + b;
        }
        export function multiply(a, b) {
          return a * b;
        }
      `;
      const result = analyzeSource(cleanCode, 'clean.js');
      assert.equal(result.healthLevel, 'A');
      assert.equal(result.healthScore >= 95, true);
      assert.equal(result.smells.length, 0);
    });

    it('重度异味与混乱代码应降级至 D 或 F', () => {
      const badLines = ['function godFunction(a, b, c, d, e, f) {'];
      for (let i = 0; i < 60; i++) {
        badLines.push(`  if (a > ${i} && b > ${i} && c > ${i}) {`);
        badLines.push(`    if (d > ${i}) {`);
        badLines.push(`      if (e > ${i}) {`);
        badLines.push(`        return a ? (b ? (c ? 1 : 2) : 3) : 4;`);
        badLines.push('      }');
        badLines.push('    }');
        badLines.push('  }');
      }
      badLines.push('}');
      const badCode = badLines.join('\n');

      const result = analyzeSource(badCode, 'disaster.js');
      assert.equal(['D', 'F'].includes(result.healthLevel), true);
      assert.equal(result.healthScore < 60, true);
      assert.equal(result.smells.length >= 3, true);
    });
  });

  describe('4. 多格式报表导出验证', () => {
    it('应支持 JSON 与 Markdown 格式导出', () => {
      const code = `function foo() { return 1; }`;
      const single = analyzeSource(code, 'foo.js');
      const projectReport = {
        summary: {
          totalFiles: 1,
          totalSLOC: 1,
          totalFunctions: 1,
          totalSmells: 0,
          avgHealthScore: 100,
          projectLevel: 'A',
          analyzedAt: new Date().toISOString(),
        },
        files: [single],
      };

      const jsonStr = formatReport(projectReport, 'json');
      const parsed = JSON.parse(jsonStr);
      assert.equal(parsed.summary.avgHealthScore, 100);

      const mdStr = formatReport(projectReport, 'markdown');
      assert.match(mdStr, /# 代码重构与简化分析报表/);
      assert.match(mdStr, /100 \/ 100/);
    });
  });

  describe('5. ignore 与自研源码分桶', () => {
    it('matchesIgnore 命中 lib / openreel / min 产物', () => {
      assert.equal(matchesIgnore('plugins/omnimux/lib/client.js'), true);
      assert.equal(matchesIgnore('plugins/omnimux-clip/src/client/openreel/App.tsx'), true);
      assert.equal(matchesIgnore('vendor/foo.min.js'), true);
      assert.equal(matchesIgnore('plugins/omnimux-products/src/client/ProductFormDialog.jsx'), false);
    });

    it('classifyFile 区分 source / generated / vendor / tests', () => {
      assert.equal(
        classifyFile('plugins/omnimux-products/src/client/ProductFormDialog.jsx', 'export function ProductFormDialog() {}'),
        'source',
      );
      assert.equal(
        classifyFile('plugins/omnimux-market/src/client.js', 'window.__ModuleLoader__.load({ id: "omnimux-market" });\n'),
        'generated',
      );
      assert.equal(
        classifyFile('plugins/omnimux-clip/src/client/openreel/Timeline.tsx', 'export const x = 1;\n'),
        'vendor',
      );
      assert.equal(
        classifyFile('plugins/omnimux-products/src/library.test.js', 'import assert from "node:assert";\n'),
        'tests',
      );
    });

    it('collectFiles 跳过 lib / openreel，保留自研源码', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crsa-buckets-'));
      try {
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.mkdirSync(path.join(root, 'vendor', 'openreel'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const n = 1;\n');
        fs.writeFileSync(path.join(root, 'src', 'app.test.js'), 'export const t = 1;\n');
        fs.writeFileSync(
          path.join(root, 'src', 'client.js'),
          'window.__ModuleLoader__.load({ id: "demo" });\nexport const bundled = true;\n',
        );
        fs.writeFileSync(path.join(root, 'lib', 'client.js'), 'export const generated = true;\n');
        fs.writeFileSync(path.join(root, 'vendor', 'openreel', 'App.js'), 'export const vendor = true;\n');

        const collected = collectFiles(root, [], { root }).map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
        assert.deepEqual(collected, ['src/app.js', 'src/app.test.js', 'src/client.js']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('analyzeProject 的 projectLevel 只聚合 source，tests/generated 进分桶', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crsa-project-'));
      try {
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export function ok() { return 1; }\n');
        fs.writeFileSync(
          path.join(root, 'src', 'client.js'),
          'window.__ModuleLoader__.load({ id: "demo" });\nfunction mega(a, b, c, d, e, f) {\n  if (a && b && c) { if (d) { if (e) { return a ? b : c; } } }\n}\n',
        );
        const testLines = ['function god(a, b, c, d, e, f) {'];
        for (let i = 0; i < 40; i++) {
          testLines.push(`  if (a > ${i} && b > ${i}) { if (c > ${i}) { return 1; } }`);
        }
        testLines.push('}');
        fs.writeFileSync(path.join(root, 'src', 'app.test.js'), `${testLines.join('\n')}\n`);
        fs.writeFileSync(path.join(root, 'lib', 'client.js'), 'export const generated = true;\n');

        const report = analyzeProject(root);
        assert.equal(report.summary.buckets.source.files, 1);
        assert.equal(report.summary.buckets.generated.files, 1);
        assert.equal(report.summary.buckets.tests.files, 1);
        assert.equal(report.summary.totalFiles, 1);
        assert.equal(report.summary.projectLevel, 'A');
        assert.equal(report.files.some((f) => f.filename.endsWith('lib/client.js') || f.filename.endsWith('lib\\client.js')), false);

        const sourceFile = report.files.find((f) => f.bucket === 'source');
        assert.equal(sourceFile.healthLevel, 'A');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('ProductFormDialog.jsx 仍归 source 桶', () => {
      const target = 'plugins/omnimux-products/src/client/ProductFormDialog.jsx';
      if (!fs.existsSync(target)) return;
      const report = analyzeFile(target);
      assert.equal(report.bucket, 'source');
    });
  });

});
