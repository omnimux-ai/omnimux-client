# 修复断链的 skill-prefill e2e：迁移到真实组件所在插件并恢复真实执行

## 背景与根因

`plugins/plugins/omnimux/tests/e2e/skill-prefill-slug.e2e.test.mjs` 的 esbuild 入口指向
`plugins/plugins/omnimux/src/client/session-guide/SessionGuide.jsx`，该文件在本仓任何历史中都不存在；
首页会话引导的真实实现位于 `plugins/plugins/omnimux-inspiration/src/explore/SessionGuide.jsx`。

同时 `plugins/plugins/omnimux/package.json` 的 `test:e2e` 脚本 glob 为 `tests/e2e/*.e2e.test.js`，
而目录内文件实际后缀为 `.e2e.test.mjs`，因此该用例既不随 `npm test`（只收集 `src/**/*.test.js`）执行，
也无法被 `test:e2e` 匹配，长期处于「文件存在但从未运行」的死链状态。

## 实施范围

1. 将 `skill-prefill-slug.e2e.test.mjs` 迁移为
   `plugins/plugins/omnimux-inspiration/src/explore/skill-prefill-slug.e2e.test.js`：
   - esbuild 入口改为同目录的 `./SessionGuide.jsx`；
   - 用例名与断言意图不变（点击 Skills 卡片只预填说明请求、不注入斜杠指令、点亮技能药丸）；
   - 该路径命中 `omnimux-inspiration` 的 `src/explore/*.e2e.test.js` 测试范围，恢复真实执行。
2. 迁移后技能 slug 保持 Phase 4 的 `replicate-viral-video` / `复刻爆款视频`。
3. 其余 4 个同样引用不存在 `SessionGuide.jsx` 的遗留 e2e 文件本次不迁移：其描述的滚动吸底/热门入门行为
   已由 `omnimux-inspiration/src/explore/composer-docking.test.js` 与 `component.test.js` 覆盖，
   留待独立清理任务评估删除或重写。

## 验证

- `node --test src/explore/skill-prefill-slug.e2e.test.js`（omnimux-inspiration 目录）：1 pass / 0 fail
- `npm test`（omnimux-inspiration）：1928 + 263 pass / 0 fail（含迁移用例）
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`：声明校验通过

## 旧标准变更

- `plugins/plugins/omnimux/tests/e2e/skill-prefill-slug.e2e.test.mjs` :: `点击 Skills 货架上的技能卡片，输入框只出现说明请求`
  - 原断言：点击首张技能卡后断言 `window.__omnimuxActiveSkill?.slug === 'replicate-viral-video'`、名称为「复刻爆款视频」，输入框只预填说明请求且不含斜杠指令。
  - 变更理由：该文件入口 `omnimux/src/client/session-guide/SessionGuide.jsx` 不存在且 `test:e2e` glob 后缀不匹配，用例从未执行；真实组件在同仓 `omnimux-inspiration/src/explore/SessionGuide.jsx`。迁移到真实组件所在包并纳入 `src/explore/*.e2e.test.js` 测试范围，断言意图与全部断言保持不变。
  - 新期望证据：迁移后 `node --test src/explore/skill-prefill-slug.e2e.test.js` 1 pass，且 `omnimux-inspiration` 全量测试 0 fail。
