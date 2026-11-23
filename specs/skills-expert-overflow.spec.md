# 技能专家页右侧溢出修复

## 背景

在宽窗口打开「技能专家」页时，主内容区整体向右越界，右侧第五列卡片和搜索框被页面容器裁切。截图中的红色区域覆盖的就是被裁掉的 40px。

根因是市场页统一容器 `.sh-mkt` 同时声明了 `width: 100%` 和 `padding: 12px 20px 32px`，但自身没有 `box-sizing: border-box`。CSS 默认 `content-box` 下，宽度为父级 100% 后再额外加上左右各 20px 内边距，容器实际比父级宽 40px；`.sh-plaza-body` 的 `overflow-x: hidden` 把这个越界部分裁掉，于是五列网格的最后一列被切掉。

`.sh-mkt *` 已为所有子元素声明 `border-box`，但不会作用于 `.sh-mkt` 自身，所以子卡片按容器内容宽度正常排，外层容器却越界。

## 目标

- 技能专家页（以及其他使用 `.sh-plaza-body .sh-mkt` 的市场 Tab）无横向溢出。
- 1600px 应用宽度、五列布局时，左右各保留 20px 内容边距，第五列完整可见。
- 不影响窄屏响应式列数、卡片尺寸和现有间距。

## 方案

给 `.sh-mkt` 自身补 `box-sizing: border-box`，让 `width: 100%` 的宽度包含左右内边距。只改容器盒模型，不改栅格、断点和卡片样式。

## 验收

1. 真实页面布局探针：`.sh-plaza-body` 的 `scrollWidth === clientWidth`，无横向溢出。
2. 1600px 视口、五列网格：第五列右边缘距容器右边缘 20px，不是负值。
3. 修复前同一探针 `scrollWidth` 比 `clientWidth` 大 40px，新增回归测试必须真实失败；修复后通过。
4. 亮/暗主题、窄屏断点下复走页面，确认无新的挤压或列数异常。
5. 与 `ui-demo/skills-expert-overflow-demo.html` 的修改前/修改后对照一致。
