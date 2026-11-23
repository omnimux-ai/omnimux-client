# 开源公示与第三方项目致谢 (Acknowledgements & Third-Party Notices)

OmniMux 的诞生与演进离不开全球开源社区与先锋项目的杰出贡献。我们在开发过程中遵循开源社区的署名与共享精神，对直接 Fork、深度二开、Vendorize 引入或深度集成的第三方开源项目进行公开公示，并致以最诚挚的感谢！

---

## 一、直接 Fork 与深度二次开发的模块 (Forked & Vendorized Subsystems)

### 1. `omnimux-market` (插件与技能市场)
* **上游原始项目**：[@cocofhu/skillhub](https://github.com/cocofhu/skillhub) (v0.2.13)
* **原始作者 / 维护者**：[@cocofhu](https://github.com/cocofhu)
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位与改造**：
  * 基于 SkillHub 进行 Fork 二次开发，升级为 OmniMux 专属的扩展中枢；
  * 重构扩展为四大功能 Tab：**技能 (Skills) · 插件 (Plugins) · 专家 (Experts) · 连接器 (Connectors)**；
  * 深度适配 DSH 原生主题变量（`--dsw-*`）与中枢设置页。
* **致谢辞**：感谢 @cocofhu 打造的高效优雅的 Agent 技能检索与管理架构，为 OmniMux 扩展生态奠定了坚实基础。

---

### 2. `omnimux-clip` (OpenReel 视频剪辑工坊)
* **上游原始项目**：[Augani/openreel-video v1.0.0](https://github.com/Augani/openreel-video/tree/v1.0.0)
* **原始作者 / 维护团队**：Augani 及 OpenReel Contributors
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位与改造**：
  * 引入官方编辑器及剪辑引擎，包括三栏工作区、多轨时间轴、属性检查器与素材库。[OpenReel 引入契约](docs/contracts/openreel-vendor-contract.md)
  * 封装 WebCodecs / WebGPU 导出管线，与 OmniMux 工作流画布实现 JSON 事件双向打通；
  * 映射官方 CSS 样式至 DSH `--dsw-*` 原生 Token 体系。
* **致谢辞**：致敬 Augani 团队在 Web 端非线性视频编辑（NLE）与 WebCodecs 高性能渲染领域的开创性工作！

---

### 3. `app/` (OmniMux Desktop 桌面客户端底座)
* **上游原始项目**：[anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)
* **原始作者 / 维护团队**：Anywhere Labs
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位与改造**：
  * 作为 OmniMux 桌面端（Electron Shell）发布与物化的底座；
  * 注入 OmniMux 专属品牌 Chrome、多插件预装 Profile、统一开发与同步流水线（`yarn omnimux:*`）。
* **致谢辞**：感谢 Anywhere Labs 团队构建的极简且高性能的 DSH 桌面壳工程底座。

---

### 4. `omnimux-viewer` (全能媒体渲染与视频播放器插件)
* **上游原始项目**：[Crosery/dsh-viewer](https://github.com/Crosery/dsh-viewer)
* **原始作者 / 维护团队**：Crosery
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位与状态**：
  * `omnimux-viewer` 的源码已迁入本仓 `plugins/plugins/omnimux-viewer/`，随产品一起构建与发布；上游基准与二次开发约定见该目录 `VENDOR.md`；
  * 为 OmniMux 媒体渲染与画布成果即时回放交互奠定了重要基础。
* **致谢辞**：致敬 Crosery 为 DSH 生态贡献的开箱即用、极度丝滑的全能媒体渲染底座！

---

### 5. `omnimux-browser` (浏览器协同与媒体采集插件)
* **上游原始项目**：[omdsh-dev/dsh-browser](https://github.com/omdsh-dev/dsh-browser)（原 `Lum1104/dsh-browser`）；源码已迁入本仓 `plugins/plugins/omnimux-browser/`
* **原始作者 / 维护团队**：Yuxiang Lin
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位与改造**：
  * 作为 OmniMux 的浏览器伴侣插件与 Chrome 扩展底座，通过 WebSocket 双向安全桥接打通宿主与浏览器；
  * 支持电商商品页一键解析、社媒带货爆款视频直链嗅探，以及悬停媒体一键直达灵感库；
  * 深度集成侧边栏对话面板与多账号安全隔离发布通道。
* **致谢辞**：感谢 Yuxiang Lin 在浏览器双向交互与扩展通信架构上的开创性开源贡献！

---

### 6. `omnimux-workflow` 中的导演台组件 (BeefTV Director & Quaternius 3D 模型)
* **上游原始项目**：[glanderness/BeefTV](https://github.com/glanderness/BeefTV)（锁定 MIT 提交 `5e2ad6022addd387001d08a478e3316ee2266524`）及 [Quaternius Universal Base Characters — Standard](https://quaternius.itch.io/universal-base-characters)
* **原始作者 / 维护团队**：@beefnoode、BeefTV Contributors（代码）与 Quaternius（3D 角色模型）
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)（BeefTV `5e2ad602` 及之前提交）；[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)（Quaternius Standard 免费基础模型）
* **在 OmniMux 中的定位与合规边界**：
  * 仅适配 BeefTV `5e2ad602`（2026-10-13，MIT）版本中的导演台组件与场景交互能力，以及 Quaternius CC0 免费基础人物模型，完整声明与路径范围见 [`plugins/omnimux-workflow/THIRD-PARTY-NOTICES-director.md`](plugins/omnimux-workflow/THIRD-PARTY-NOTICES-director.md)；
  * **严格禁止同步 BeefTV 自 `6b30abfe`（2026-10-19 UTC）起改为 Source Available 许可的后续提交**，除非另行取得权利人书面商业授权。
* **致谢辞**：感谢 BeefTV 团队与 Quaternius 在开源 3D 导演台交互与 CC0 基础角色资产上的贡献！

---

## 二、底层宿主与核心基础设施 (Core Host & Infrastructure)

### 1. DeepSeek Harness (DSH)
* **官方项目**：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
* **出品方**：DeepSeek AI 团队
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位**：
  * OmniMux 的核心插件运行底座与 Agent 工具调用宿主（当前锁定 `0.2.1-rc.3`）；
  * OmniMux 严格遵循 DSH 插件规范开发，不修改 harness 核心源码，全量复用其沙箱、会话与上下文调度能力。
* **致谢辞**：向 DeepSeek 团队开源如此卓越的 Agent 运行时与 Harness 架构致以崇高敬意！

### 2. Cordis & Koishi.js 生态
* **官方项目**：[cordiverse/cordis](https://github.com/cordiverse/cordis) · [Koishi.js](https://koishi.chat/)
* **开源许可证**：[MIT License](https://opensource.org/licenses/MIT)
* **在 OmniMux 中的定位**：
  * 为 DeepSeek Harness 与 OmniMux 桌面插件体系提供依赖注入、服务缝位（Seam）与热插拔组合能力。
* **致谢辞**：感谢 Cordis 与 Koishi.js 社区在插件化架构与生态工程实践上的长期贡献！

---

## 三、核心开源依赖与引擎 (Core Dependencies & Engines)

| 项目名称 | 来源仓库 | 许可证 | 在 OmniMux 中的应用 |
| :--- | :--- | :---: | :--- |
| **Augani/openreel-video (OpenReel)** | [Augani/openreel-video](https://github.com/Augani/openreel-video) | MIT | `omnimux-clip` 专业微应用多轨时间轴、WebCodecs 与硬件加速剪辑引擎 |
| **React Flow (@xyflow/react)** | [xyflow/xyflow](https://github.com/xyflow/xyflow) | MIT | `omnimux-workflow` 无限画布节点连接与 DAG 拓扑编排引擎 |
| **Umami Analytics** | [umami-software/umami](https://github.com/umami-software/umami) | MIT | `omnimux-analytics` 隐私友好的插件使用指标与社媒运营数据计算 |
| **Blobatar** | [joshglendenning/blobatar](https://github.com/joshglendenning/blobatar) | MIT | `omnimux` 执行中枢账号与 Agent 动态色彩头像哈希生成 |
| **AIGC Provider Runtime Kit** | [laozhong86/aigc-provider-runtime-kit](https://github.com/laozhong86/aigc-provider-runtime-kit) | MIT | `omnimux` 多模态流式协议通信与运行时统一适配工具库 |
| **Dagre** | [dagrejs/dagre](https://github.com/dagrejs/dagre) | MIT | 工作流画布有向图自动分层布局算法 |

---

## 四、商业模式与产品架构灵感致敬 (Inspirations & Tributes)

* **[n8n (n8n-io/n8n)](https://n8n.io)**：
  * 启发了节点级可视化编排的产品思想。（OmniMux 早期曾参照其 Sustainable Source 许可；自 2026-10-28 起改为 AGPL-3.0 + 商业授权双轨，与 new-api 一致。）
* **[OpenReel Video (Augani/openreel-video)](https://github.com/Augani/openreel-video)**：
  * 为 OmniMux 提供了强大的开源多轨时间轴剪辑内核，让 AI 视频生成摆脱了不可控的模板拼装，迈入工业级精剪与微调。

---

## 五、开源许可证合规说明 (License Compliance Notice)

OmniMux 严格尊重上述所有开源项目的原作者知识产权与开源许可证条款：
1. 本项目中包含的所有第三方源代码或分发包均保留其原始的版权声明（Copyright Notices）与许可证文本；
2. OmniMux 自行编写的代码采用 AGPL-3.0；**本项目中所有独立引入的第三方 MIT / Apache 2.0 / MPL-2.0 等组件，其上游原始代码保持原有许可证权利不变**。

*如有任何版权归属疑问或遗漏，欢迎联系 `hello@omnimux.ai`，我们将第一时间核实并更新致谢清单！*
