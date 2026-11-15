# 灵感库详情 · 轮播图预览（多图渲染 + 左右切换）

## 背景

线上灵感库记录 `907`（glow up secrets dialogue series）是一条轮播图帖：云端目录返回
`media_keys` 三张（`slide-1/2/3.jpg`，标签含 `carousel_tutorial`），但详情页只渲染了封面
「图片 1」。`getPostMedia()` 只读 `media_items` / `media_urls`，忽略 `media_keys`；
详情页媒体区是纵向堆叠，没有轮播容器、箭头、圆点或键盘切换；大图灯箱也没有上一张/下一张。

## 范围

1. `analysisMediaItems()`（`src/analysis-input.js`）：图片类记录在没有 `media_items` /
   `media_urls` 时，按原顺序读取 `media_keys`，复用 `legacyImageUrl` 归一化，去重后返回。
2. 新增 `src/client/PostMediaCarousel.jsx`：纯展示组件，接收图片 assets、当前尺寸、
   打开/分析/选参考回调；提供横向轨道、箭头、圆点、计数、键盘 ←/→、指针拖动。
3. `InspirationPostDetail.jsx`：纯图片且多于 1 张时用轮播；单图、视频、混合素材维持现有
   纵向堆叠与播放器行为。灯箱增加上一张/下一张与计数，键盘 ←/→ 同步。
4. 样式加在 `src/client/styles.js`，沿用现有 `--dsw-alias-*` token。
5. 测试：`post-detail.test.js` 补 `media_keys` 解析；新增
   `src/client/post-media-carousel.e2e.test.js`（esbuild + jsdom 渲染真实组件）。

不做：改云端取图地址；`media_keys` 的 404 属于数据/地址映射问题，本次只在 UI 与解析层
按原 key 归一化，不伪造 URL。

## 假设

- `media_keys` 是云端目录对轮播图的权威顺序数组，元素可以是 host 相对 key 或 http(s) 直链；
  同一 key 重复出现只应展示一次。
- 只有图片类记录（type/content_shape/media_kind 指示 image/photo/gallery）才把
  `media_keys` 当图片序列解析；视频记录不因此多出图片。
- 轮播只在「全部素材都是图片且数量大于 1」时启用，视频与混合素材保持原行为，避免把视频
  播放器塞进横向轨道造成播放/拖动冲突。

## 证伪方式

- 单测：`getPostMedia({ type:'image', media_keys:[a,b,c] })` 必须返回 3 个 image 且顺序为
  a,b,c；重复 key 去重；`type:'video'` 带 media_keys 不产生图片。
- E2E：挂载 `PostMediaCarousel` 3 张图，断言 3 个 slide、计数 `1 / 3`；点下一张后轨道
  `translateX(-100%)`、计数 `2 / 3`、第二个圆点为选中；点第 2 张图触发 `onOpen` 且传入第 2 个
  asset；`ArrowRight` 键再前进一张。
- 反向验证：把 `media_keys` 解析分支注释掉，单测应失败；把轮播换成单图，E2E 的 slide 数量
  断言应失败。

## 验收

- `cd plugins && corepack pnpm install --frozen-lockfile && corepack pnpm -r build`
- `corepack pnpm --filter omnimux-inspiration test`
- 浏览器验收：详情页 3 张可拖动/箭头/键盘切换，点图后灯箱可前后翻页；单图帖行为不变。
