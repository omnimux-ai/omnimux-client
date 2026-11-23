# OmniMux · 产品插件子树（plugins）

> 项目完整介绍、桌面端下载与快速开始请见仓库主页：[**OmniMux README（English）**](../README.md) · [**简体中文**](../docs/README.zh-CN.md)。本页聚焦 `plugins/` 插件工作区的架构边界、构建、验收与许可说明。

---

## 简介

**OmniMux 是属于你的本地 AI 内容电商团队——面向内容电商与品牌增长的一站式桌面 Agent 工作台，让商品卖点与视觉资产贯穿每一次出片。** 本目录（`plugins/`）是 `omnimux-client` 仓库中的产品插件工作区。

围绕「商品与资产 → 灵感拆解 → 画布编排与多模态生成 → 时间轴剪辑 → 复盘」工作流，本目录包含执行中枢（`omnimux`），以及商品库（`omnimux-products`）、创作资产库（`omnimux-assets`）、灵感库（`omnimux-inspiration`）、无限画布（`omnimux-workflow`）、视频剪辑工坊（`omnimux-clip`）、浏览器伴侣（`omnimux-browser`）、技能与插件市场（`omnimux-market`）、表单辅助（`omnimux-forms`），以及持续演进中的账号/发布/复盘与视频辅助插件（`omnimux-accounts`、`omnimux-publish`、`omnimux-analytics`、`omnimux-video`）。

各插件当前发布档位以 [`app/config/plugin-tiers.json`](../app/config/plugin-tiers.json) 和 [插件生命周期清单](plugins/omnimux/src/plugin-lifecycle.json) 为准。不承诺保证爆款、保证销量、防封号或尚未实现的国内平台（抖音/小红书/视频号/快手/B站）自动分发。

## 工程结构与能力状态

执行中枢负责身份、凭证、模型路由与媒体执行；领域插件管理各自的素材、灵感、画布和剪辑职责。结构与术语见 CONTEXT.md，调用边界见中枢合同。

已有账号、发布、运营分析等插件保留其技术职责，但不因存在源码而成为当前对外承诺。安装阶段以[插件生命周期清单](plugins/omnimux/src/plugin-lifecycle.json)为准，真实可用性以能力记录及当前验收为准，不维护第二份正式可用徽章或素材数量表。

## 文档入口

| 需要了解什么 | 入口 |
| --- | --- |
| 当前产品方向与宣传边界 | 产品定位：属于你的内容电商团队 |
| 角色视频制作的目标与验收 | 角色生成与视频复刻指南 |
| 开发文档与适用合同 | 文档导航、[智能体约束](AGENTS.md) |
| 灵感库合集整理与能力状态 | [灵感插件说明](plugins/omnimux-inspiration/README.md#本地灵感合集)、能力记录 |
| 中枢接口目录快照 | 接口面板，不是部署状态或上游能力真源 |
| 软件使用与商业授权 | [许可原文](LICENSE)、商业授权说明，不等于生成免费 |
| 第三方来源与许可 | [致谢与第三方声明](ACKNOWLEDGEMENTS.md) |

## 💼 许可

OmniMux 自行编写的插件代码采用 **[AGPL-3.0](LICENSE)**，另附 [NOTICE](NOTICE) 中的 AGPLv3 第 7 条署名要求；同时提供商业授权，与 [new-api](https://github.com/QuantumNous/new-api) 的做法相同。

| 用法 | AGPL-3.0（免费） | 商业授权 |
| :--- | :---: | :---: |
| 个人、团队或企业使用、修改、自行部署，包括商业用途 | ✅ | ✅ |
| 修改后对外提供服务或分发，且公开修改后的源码 | ✅ | ✅ |
| 修改后对外提供服务或分发，但不公开修改 | ❌ | ✅ |
| 移除 `Powered by OmniMux` 署名，以自有品牌发布 | ❌ | ✅ |

从上游 fork 或引入的代码保留原许可（多为 MIT），见 CONTRIBUTING.md 第 4 节与 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。2026-10-28 之前发布的版本按其发布时的许可证授权。许可不等于生成免费，详见 COMMERCIAL.md。

公开源码（AGPL-3.0）发布在本仓 [omnimux-ai/omnimux-client](https://github.com/omnimux-ai/omnimux-client)（桌面壳 + 产品插件）；配套服务端源码见独立公开仓 [omnimux-ai/omnimux-gateway](https://github.com/omnimux-ai/omnimux-gateway)。

## 🚀 快速启动 (Quickstart)

### 环境要求
* **Node.js**：`^22.19 || >=24`
* **pnpm**：`>=9`
* **DeepSeek Harness (DSH)**：通过 `npx @deepseek-ai/dsh` 或本地 DSH 环境运行。

### 本地开发与交付

从仓库根运行 `corepack pnpm --dir plugins run build:all`。全量构建使用各插件声明的 `build`，工作流会一起构建 Host、客户端、画布和导演台。

需求确认后先按[研究与决策指引](../docs/development-research.md)选择案例、核实证据并确定方案，再按[插件规则](AGENTS.md)选验证项，依照[仓库规则](../AGENTS.md#合并与复核)交付。

1. 在任务工作树运行受影响插件的静态检查和测试，完成代码审查。在隔离测试环境从真实入口走完本次变更的用户流程，记录待合入版本、验收项与实际结果。纯开发文档按文档验证项检查。
2. 本地验收通过后，Agent 跟进 GitHub 必需检查并通过 PR 合入 `main`。必验项失败时，自行修复并复测。
3. 合入后快进本地 `main`，保留已有的未提交改动。涉及已安装插件时，从对齐最新 `origin/main` 的干净检出进入 `app/`，执行 `corepack yarn omnimux:sync <插件名>`。物化预检自行准备临时 `DSH_HOME`。需要重新加载宿主时执行 `corepack yarn omnimux:restart dev`。
4. 桌面 Bot 核对运行中的 Dev 与物化产物的指纹，重走受影响流程并记录结果。负责合并的 Agent 在原任务中跟到复核通过，保留证据后清理任务工作树。

合前测试使用隔离环境，共享 Dev 只接收已合入的版本。纯开发文档无需安装或重启应用。生产 `~/.omnimux`、`--prod`、`--all` 与正式发布须另获授权。

#### 重建并升级共享 macOS Dev

共享 Dev 缺少托管插件源时，可用同一提交打包的开发版重建依赖并升级桌面壳。先在干净的任务检出构建插件，再在 `app/` 下设置 `OMNIMUX_PLUGINS_DIR` 为该检出的 `plugins/plugins` 绝对路径，执行 `corepack yarn package:dev --fresh-preset`。打包从独立的预设目录读取新产物。

在 `app/` 下执行以下步骤，`<batch>` 使用已挂载的 SMB 或 NFS 上尚不存在的批次目录绝对路径，其父目录须已存在。

1. 运行 `corepack yarn omnimux:profile upgrade-dev --app <frozen-dev.app> --recovery-dir <batch> --dry-run`，核对构建提交、依赖来源和恢复位置。
2. 正常退出 Dev，等 Host 和其他 App 子进程退出。去掉 `--dry-run` 执行切换，脚本在改动应用和依赖之前会直接向 NAS 归档并校验原状态。
3. 打开共享 Dev，核对版本、原有会话、项目和已启用插件，并实测受影响的入口。验收后运行 `corepack yarn omnimux:profile accept-dev --recovery-dir <batch>`。首启失败或切换中断时，退出 Dev 后运行 `corepack yarn omnimux:profile recover-dev --recovery-dir <batch>`，验证旧版启动。

#### 隔离浏览器冒烟

本机需安装 OmniMux Dev 和 Chrome 或 Chromium。在任务工作树根目录运行 `corepack pnpm --dir plugins run verify:app --mode=ui`。此入口每次都从安装包预设和插件创建一次性配置，自动启用「灵感」并连接本机模拟服务，无需复制正在使用的 Dev 配置或手动启用插件。

[验收脚本](scripts/worktree-app-qa.mjs)通过浏览器检查空白会话引导、Explore 区域和卡片，以及从会话打开素材库，并保存报告和截图。报告用 `packaged-smoke` 标记基于安装包的冒烟结果。普通冒烟的插件版本取自安装包，工作树源码的验收需另有运行版本证据。

带 `--journey` 的普通 UI 验收也会在隔离配置启用「灵感」。`--request` 仍由任务声明验收所需的插件。`live` 模式沿用其环境准备流程。

---

## 💬 社区交流与开发者群 (Community)

可选择常用的平台参与讨论，交流 AI 视频出片技巧、探讨插件二次开发、反馈需求与跟踪最新进展：

<table>
  <thead>
    <tr>
      <th align="center" width="50%">微信 / 企业微信开发者交流群</th>
      <th align="center" width="50%">全球社交媒体与开发者频道</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" valign="middle">
        <img src="../app/assets/community-wechat-group.png" alt="OmniMux 微信 / 企业微信开发者交流群" width="220"><br>
        <sub>扫码加入 <strong>OmniMux 开发者交流群</strong><br>（微信或企业微信均可扫码进入）</sub>
      </td>
      <td align="center" valign="middle">
        <p>
          <a href="https://discord.gg/uNPBDz3WNC"><img src="https://img.shields.io/badge/Discord-Join%20OmniMux-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
        </p>
        <p>
          <a href="https://x.com/OmniMuxai"><img src="https://img.shields.io/badge/X%20(Twitter)-Follow%20@OmniMuxai-black?style=for-the-badge&logo=x&logoColor=white" alt="Twitter"></a>
        </p>
        <p>
          <a href="https://github.com/omnimux-ai/omnimux-client/discussions"><img src="https://img.shields.io/badge/GitHub-Discussions-0969DA?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Discussions"></a>
        </p>
        <sub>欢迎提交 Issue、参与功能共建或在 Discord / X 与全球开发者互动！</sub>
      </td>
    </tr>
  </tbody>
</table>

---

## 🤝 贡献与共建 (Contributing)

我们非常欢迎开发者参与共建！无论是修复 Bug、编写文档，还是为 OmniMux 贡献新的 Agent Skills 或插件：
1. 查阅 [CONTRIBUTING.md](../CONTRIBUTING.md) 了解代码规范与 PR 提交流程。
2. 遵守 [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) 行为准则。
3. 发现安全问题请按照 [SECURITY.md](../SECURITY.md) 私密通报。

---

## 🙏 开源公示与致谢 (Acknowledgements & Third-Party Credits)

OmniMux 的构建与演进站在了开源巨人的肩膀上，我们对以下直接 Fork、深度二开或集成的开源先锋项目致以由衷的敬意与感谢：

* **[@cocofhu/skillhub](https://github.com/cocofhu/skillhub)** (MIT License, by [@cocofhu](https://github.com/cocofhu))：`omnimux-market` 插件市场（技能/插件/专家/连接器四 Tab 架构）的 Fork 二开真源。
* **[Augani/openreel-video](https://github.com/Augani/openreel-video)** (MIT License, by Augani)：`omnimux-clip` 剪辑工坊全套 WebCodecs/WebGPU 时间轴与微应用 Vendorize 真源。
* **[Crosery/dsh-viewer](https://github.com/Crosery/dsh-viewer)** (MIT License, by Crosery)：历史归属说明：`omnimux-viewer` 曾作为全能媒体渲染器插件来源，当前不在本仓 `plugins/` 内构建或内置。
* **[omdsh-dev/dsh-browser](https://github.com/omdsh-dev/dsh-browser)** (MIT License, by Yuxiang Lin)：`omnimux-browser` 浏览器伴侣插件与 Chrome 扩展的来源；源码已迁入本仓 `plugins/plugins/omnimux-browser/`，随产品一起构建与发布。
* **[glanderness/BeefTV](https://github.com/glanderness/BeefTV)** (MIT License，锁定基线 `5e2ad602`，by @beefnoode & BeefTV Contributors) 与 **[Quaternius](https://quaternius.itch.io/universal-base-characters)** (CC0 1.0)：`omnimux-workflow` 导演台组件与免费基础 3D 角色模型来源；严格不同步 `6b30abfe` 及之后的 Source Available 提交，详见 [`THIRD-PARTY-NOTICES-director.md`](plugins/omnimux-workflow/THIRD-PARTY-NOTICES-director.md)。
* **[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)** (MIT License, by DeepSeek AI)：官方核心 Agent 运行底座与 Harness 插件规范。
* **[anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)** (MIT License, by Anywhere Labs)：OmniMux 桌面端 Electron Shell 的 Fork 底座。
* **[@xyflow/react (React Flow)](https://github.com/xyflow/xyflow)** (MIT License, by xyflow)：`omnimux-workflow` 无限画布 DAG 节点连接与编排引擎。
* **[Umami Analytics](https://github.com/umami-software/umami)** (MIT License)：`omnimux-analytics` 隐私友好的插件指标与社媒运营分析。
* **[Blobatar](https://github.com/joshglendenning/blobatar)** (MIT License, by Josh Glendenning)：`omnimux` 账号与 Agent 动态色彩头像生成。
* **模式致敬**：感谢 **[n8n](https://n8n.io)**（可视化节点编排与可持续源码许可）的产品与商业化启发。

*完整第三方开源项目清单与许可证声明详见 **[ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)**。*

---

## 📄 许可与商业授权 (License & Commercial)

* **许可**：OmniMux 自行编写的代码采用 **[AGPL-3.0](LICENSE)**，附 [NOTICE](NOTICE) 中的第 7 条署名要求。可以免费使用、修改、自行部署，包括商业用途；修改后对外提供服务或分发时须公开对应源码，并保留署名。
* **商业授权**：不想公开修改、需要移除 OmniMux 品牌，或公司政策不接受 AGPL 时，请联系 `hello@omnimux.ai` 或查阅 **COMMERCIAL.md**。

---

<p align="center">
  <sub>Copyright © 2026 OmniMux Project and Contributors. Licensed under AGPL-3.0.</sub>
</p>
