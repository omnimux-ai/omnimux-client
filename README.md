# OmniMux Client

OmniMux 桌面客户端与产品插件的单一代码仓库。

**属于你的内容电商团队** —— 一套内容电商系统与桌面 Agent 工作台，用于可带货视频拆解、商品/人物资产创建、参考视频复刻与定时发布。

## 目录

```text
app/        Electron 桌面壳（deepseek-harness 之上），含 dsh-desktop-next、dsh-plugin-desktop、
            dsh-community-fabric、dsh-community-market、patches、assets、config、docs
plugins/    产品插件（omnimux 及 20 个能力插件、3 个共享包），随桌面版一起发布
```

仓库根是**插件工作区的唯一 pnpm workspace 根**（单一 `pnpm-lock.yaml`），`app/` 仍是独立的 Yarn 4 工作区；桌面依赖通过 `link:` 指向本仓 `plugins/plugins/*`，因此同一个 PR 可以同时改壳和插件并在打包时消费本仓源码。

## 构建

```bash
# 插件工作区（仓库根；先装依赖，再构建插件产物）
corepack pnpm install --frozen-lockfile
corepack pnpm --dir plugins run build:all

# 工作区元数据校验（dsh-version.json / bundle.lock.json）
node scripts/workspace-check.mjs --check

# 桌面壳（打包前置会自动再跑一次插件构建与新鲜度校验）
cd app && corepack enable && corepack yarn install --immutable && corepack yarn workspace dsh-desktop-next dist:mac
```

`app/deepseek-harness` 是 submodule，pin 记录在 `PROVENANCE.json`；首次检出后执行
`git submodule update --init app/deepseek-harness`。

## 来源与追溯

本仓首次导入时由两份**已公开**的源码树合成，逐项记录在 [`PROVENANCE.json`](./PROVENANCE.json)：

| 目录 | 来源仓 | 导入 commit |
|---|---|---|
| `app/` | 私有桌面开发仓（已归档只读） | `70324365` |
| `plugins/` | `omnimux-ai/omnimux-dsh` | `1ec38f08a` |

私有开发历史不带入本仓；旧仓只读归档。

## 不在本仓

- **服务端网关**（Go，new-api fork）：[`omnimux-ai/omnimux-gateway`](https://github.com/omnimux-ai/omnimux-gateway)，仅因 AGPL 义务公开
- 托管服务的渠道凭据、定价账本、部署与运维物料：私有仓，不公开

## 许可

OmniMux 部分为 AGPL-3.0。上游组件保留其原始许可：桌面壳基于 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)（MIT），harness 为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），插件网关部分基于 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)。详见各处 `LICENSE` 与 `NOTICE`。
