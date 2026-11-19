# 画布创建项目弹窗

## 范围

- 画布与项目库继续使用同一个创建弹窗。标题显示文件夹图标，名称与保存位置合为一组。选中目录后显示完整路径、可更改或移除。未选目录时显示默认项目库。
- 独立提示区预留状态高度。目录检查结果决定是否可以创建、直接打开、重建或修复。保留原生目录选择、名称规则、键盘提交及现有创建接口。
- 跟随客户端主题。窄窗口下保存位置与路径分行，操作仍可见。沿用当前画布项目能力。

## 假设

新安装用户可以使用产品的默认项目库，画布入口可以带入当前工作区。若目录无法读取，弹窗显示失败状态并暂时禁止提交，用户可更换目录后重试。

## 证伪方式

从实际画布入口打开弹窗，分别在亮暗主题和窄屏检查名称、目录路径与按钮。切换到已有项目或不可读目录时，如果仍可误建项目，或移除目录后失去默认库创建能力，则不通过。

## 文档影响

项目创建接口与存储语义沿用现有实现。共享弹窗的标题图标属性在组件库 README 中记录。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/client/projects/NewLocalProjectDialog.test.mjs` :: `empty initialPath renders drop zone, not picked card`
- `plugins/plugins/omnimux-workflow/src/client/projects/NewLocalProjectDialog.test.mjs` :: `initialPath renders removable folder card`

原用例检查选目录按钮、目录卡片和移除入口。新版继续检查这些入口，并额外检查默认项目库名称与所选目录的完整文本。

- `plugins/plugins/omnimux-workflow/src/client/projects/NewLocalProjectDialog.test.mjs` :: `preflight 中性状态与明确动作：open/rebuild/repair 不再红字`
- `plugins/plugins/omnimux-workflow/src/client/projects/NewLocalProjectDialog.test.mjs` :: `preflight 失败：中性失败提示 + 禁用提交，不回退成独立项目`

原用例通过旧表单错误类名判断提示样式。新版通过提示区的错误属性区分可继续的目录状态和读取失败，保留失败时禁用提交的断言，并增加同目录重试的检查。

- `plugins/plugins/omnimux-workflow/src/client/projects/pickDirectory.test.mjs` :: `keeps initialPath state and empty/picked folder cards with native picker`
- `plugins/plugins/omnimux-workflow/src/client/projects/pickDirectory.test.mjs` :: `uses create-project copy for title, location, choose folder, change and remove`

初始目录仍从入口带入，但每次选择现在有独立检查，断言随状态形状更新。保存位置的中文标签按新稿更新，原生选择器、已有目录与移除入口继续纳入检查。

- `plugins/plugins/omnimux-workflow/src/client/projects/project-locales.test.mjs` :: `covers B2 independent/linked projects and two-level delete copy`

中文版创建状态和英文重建状态换成画布用户能直接理解的简短文案，断言随新文案更新。项目打开、删除和中英词条完整性继续纳入检查。
