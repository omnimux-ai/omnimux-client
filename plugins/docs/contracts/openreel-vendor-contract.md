---
title: "OpenReel 剪辑工坊引入契约"
id: "contract-openreel-vendor"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-21"
updated: "2026-11-22"
---

# OpenReel 剪辑工坊引入契约

剪辑工坊在 OmniMux 工作台中嵌入 OpenReel 的编辑器和渲染管线。该入口和画布合成节点使用同一套剪辑界面。固定上游版本见 [UPSTREAM_SHA](../../plugins/omnimux-clip/src/client/openreel/UPSTREAM_SHA)，许可与随包素材见 [第三方声明](../../plugins/omnimux-clip/THIRD_PARTY_NOTICES.md)。

## 1. 同步范围

更新上游时以固定提交对比上游旧版、上游新版和 OmniMux 实际改动。逐项核查本地安全补丁、画布桥、打包、项目兼容和应用内语言。上游布局和入口变动按当前工单的验收项处理。

工程导入、加载和恢复清空自定义表达式的执行授权。代码表达式的审批属于当前工程。独立 Motion Creator 随上游 1.0 退出工作区，现有工程的表达式计算沿用审批规则。

## 2. 宿主接口

Clip 路由保存在编辑器内部。构建脚本将导入的样式限定在 `.openreel-studio-root`。宿主提供主题和语言，菜单和浮层使用 Clip 内部容器。用户编写的内容和文件格式标准名保留原文。

画布合成通过宿主预约版本化 MP4，用浏览器支持的编码选项保留 seek 和 truncate，再上传原始字节。宿主校验并保存成片后按固定画布绑定提交下游。手工和 Agent 共用导出世代与任务顺序。手工导出可显式取消上传和 Host 任务，退出 Portal 后已预约的任务可继续。旧 `/save-export` 继续服务兼容调用。独立剪辑工坊提供各编码器支持的文件导出选项。[阶段 2 的 MP4 契约](clip-live-control.md#mp4-与画布提交)

供应商请求、密钥和模型路由由执行中心负责。OmniMux 宿主禁用上游浏览器剪辑对话、自备密钥直连、第三方生成提交与轮询，以及外部协作邀请和房间。旧设置迁移移除连接字段，旧生成占位素材按本地媒体恢复，缺少源文件时可重新链接。现有本地编辑、浏览器端媒体处理和宿主 Clip 工具继续通过原入口工作。

## 3. Vendor 根

上游实现位于 `plugins/omnimux-clip/src/client/openreel/`（相对插件工作区）。[插件静态扫描](../../scripts/auto-qa-scan.mjs)识别此目录和退役的 `src/client/engine/openreel/` 路径，用于识别上游渲染颜色。宿主桥、应用入口和宿主 token 映射仍按产品规则检查。

## 4. 验收

合入前以工作树候选构建验证宿主样式、亮暗菜单和弹窗、窄屏、中英文切换、旧工程加载、空时间轴首个视频入轨和画布导出。时间轴调整、拖动和修剪期间检查宿主 `body` 的内联样式。画布分别核对源流重封装和逐帧编码输出，检查浏览器播放、`moov`、回执及关联节点。真实浏览器结果、构建和单测分别记录。[插件开发与交付](../../README.md#本地开发与交付)
