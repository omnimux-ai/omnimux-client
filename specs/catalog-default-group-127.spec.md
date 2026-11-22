# 模型目录的默认线路和展示顺序

工单 [#127](https://github.com/omnimux-ai/omnimux-client/issues/127)。采用 [网关 #64](https://github.com/omnimux-ai/omnimux-gateway/issues/64) 已实现的 [`/api/pricing` 契约](https://github.com/omnimux-ai/omnimux-gateway/blob/530a30ef7680ac8df549619d81a1ac35077dd408/controller/pricing.go)。

## 假设

- 网关按模型下发 `group_order`，按调用者可用线路返回 `default_group`。网关明确返回空字符串时，该模型对当前调用者没有默认线路。
- 旧目录可能省略这两个字段。客户端保留 `enable_groups` 的到达顺序。存在 `group_order` 时，先列出其中仍在售的线路，再按原顺序补齐遗漏的在售线路，防止目录缺项导致已有选择失效。
- 客户端在目录接缝保留现有 `channelGroups` 结构。显式默认必须属于可用候选。只有缺少 `default_group` 时，才使用 `group_order` 中第一条可用线路。非法默认在目录刷新时记录日志。
- 老调用显式传入分辨率时继续匹配已有线路约束。使用组级视频能力的生成请求仍携带选定线路，以便在提交时复验组价和能力。

## 验收标准

1. 合成目录包含 `seedance-2-5`、`gpt-image-2.5`、`wan-3.0` 和 `minimax-h3-video`。平铺模型目录和各类型目录输出相同的线路顺序和默认标记。媒体路由选定同一条默认线路，显式选线优先。
2. 覆盖缺省、空串、非法默认和调用者不可用默认。覆盖缺失、缺项、重复和含下线线路的顺序。清除本地 `MODEL_CHANNEL_GROUPS` 对默认的声明。
3. 新节点使用有效默认。当前线路仍可用时，目录刷新保留用户选择。原线路下线时，采用有效默认并迁移参数，落实固定值和不支持的参数清理。自动迁移的结果由控件展示。无可用默认时提示重选。
4. 在同样的合成目录上对照真实浏览器中的线路下拉顺序、刷新前后的节点值与反馈。离线夹具验证目录投影、路由和迁移。真实网关及模型调用另记录结果。

## 证伪方式

- 将默认线路设置在 `group_order` 中间。若客户端选到第一条、复活已下线线路或更改仍可用的用户选择，则验收失败。
- 将 `default_group` 分别移除、清空和设为未知线路。只有缺字段且顺序包含可用候选时应出现兼容默认。非法默认应同时产生目录诊断日志。
- 在打开的节点保留原分辨率、出图数量或质量后更新目录。若新线路仍带有不合法参数、自动迁移重复播报，或没有迁移目标时缺少重选入口，则验收失败。

## 旧标准变更

- `plugins/plugins/omnimux/src/catalog/cloud/snapshot.test.js` :: `is insensitive to upstream array order (digest stability)`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `returns defined channel groups for seedance-2-0`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `returns the 480p economy and 720p standard(default) lines for seedance-2-5`
- `plugins/plugins/omnimux/src/media/audio.test.js` :: `defaults to Suno on the openai-media row`
- `plugins/plugins/omnimux/src/media/candidate-intent-constraints.test.js` :: `3312: the delisted H3 series exposes no channel groups while the listed multi-line model resolves legal heads`
- `plugins/plugins/omnimux/src/media/gpt-image-gateway-3071.test.js` :: `standard and economy are distinct routes and explicit selection cannot widen`
- `plugins/plugins/omnimux/src/media/gpt-image-gateway-3071.test.js` :: `default execute uses beta-compatible request once and stores synchronous result`
- `plugins/plugins/omnimux/src/media/route.test.js` :: `auto-pins the default line when a model declares one and the caller gave no intent`
- `plugins/plugins/omnimux/src/media/route.test.js` :: `defaults to the OmniMux openai-media video row`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.test.mjs` :: `resolves exactly the lines the hub directory publishes for a model`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.test.mjs` :: `resolves the full spec of the lines the node routes to`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `hover remains preview-only and legacy brand clicks select a real model row`

快照指纹继续忽略模型行和端点的无关排列，并辨认影响显示的线路顺序变化。旧套件从捆绑目录推断了固定默认线路。捆绑目录省略两个新字段，因此测试断言不再标记默认，并继续校验线路、价格和约束。需要运行在默认线路上的音频、视频和图像用例注入明确的网关默认。请求载荷测试继续核对该线路对应的提交协议及参数。显式选择的请求继续锁定选中的线路。

画布用例继续核对中枢给出的可选线路和触发悬停时的只读预览。图像和视频参数继承目录标记的默认线路约束。菜单点击测试改为校验有效默认直接生效、无默认时可以手选单条线路。
