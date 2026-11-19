# 额度预检与工具字段传递

## 目标

复用额度处理和错误提示。按既有动作策略检查余额，重试时复核失效拒绝。补齐音乐风格与纯音乐参数。

## 假设

缓存的零余额会让已恢复额度的用户继续被拒。复用旧结果适合后台轮询，用户主动重试时需要重新查询。音乐工具可以复用页面的执行器传递显式设置。

## 证伪方式

在缓存期内将测试余额从零改为正数，连续发起两次重试。如果仍被拒或出现两次状态请求，重试策略未达到目标。用同一份音乐参数走工具和页面入口，逐项比对执行器收到的风格与开关。

## 已实现的行为与验收

| 操作 | 决策与预期结果 | 验证入口 |
|---|---|---|
| 余额从零恢复后再次提交或点击重试 | 用户动作即时复核旧的零余额；同时发起的复核共用一次状态请求。正余额及后台轮询继续使用 30 秒缓存。 | [中枢预检测试](../plugins/plugins/omnimux/src/client/quota-precheck.test.js)、[账号操作测试](../plugins/plugins/omnimux-accounts/src/client/api.test.js) |
| 退出或切换账号，前一账号的余额查询仍在进行 | 额度缓存和查询绑定当前登录状态。旧应答停止原动作，新账号按自己的余额判断。因登录状态切换而中止的写操作须重新发起。 | [跨账号及过期应答测试](../plugins/plugins/omnimux/src/client/quota-precheck.test.js)、[灵感账号写操作测试](../plugins/plugins/omnimux-inspiration/src/client/api.test.js) |
| 分析看板加载、筛选、重试或同步 | 整页只预检一次，筛选用账号列表和各数据分块直接读取。某个分块报告额度不足时保留其他已返回数据；普通权限或业务错误沿原路径返回。 | [看板请求测试](../plugins/plugins/omnimux-analytics/src/client/api.test.js)、[数据状态测试](../plugins/plugins/omnimux-analytics/src/client/store.test.js) |
| 分析看板预检弹出登录窗，或点击看板的登录按钮 | 复用中枢登录窗。取消后留在原页面，登录成功只读取一次看板数据。 | [登录交互回归](../plugins/plugins/omnimux-analytics/src/client/analytics-login-action.test.js) |
| 点击画布节点的生成按钮 | 发起提交的同时检查额度；同一节点连续点击只创建一次任务。 | [画布提交测试](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/submitNode.test.mjs) |
| 从 Agent 工具提交音乐 | 工具和页面将显式的风格和纯音乐开关交给同一执行器。关闭开关保留为 `false`，发给模型的字段按该操作声明映射。 | [工具与执行器测试](../plugins/plugins/omnimux/src/media/mount.test.js) |

浏览器验收使用本地可控账户与额度响应，覆盖缓存期内恢复、部分数据失败及登录成功与取消。线上账户扣费和真实音乐生成单独验收。

## 运行时规则责任清单

下表按桌面壳和 13 个产品插件列出本次沿调用路径核对的代表性规则。每行的责任方掌握判定所需的事实。“保留”指该边界有独立目的，“收拢”列出目标状态。范围是用户操作时的检查，不含 CI、发布流程及第三方依赖内部。

| 组件与规则入口 | 调用场景 | 判定责任与处置 |
|---|---|---|
| [桌面权限](../app/dsh-desktop-next/src/electron-permissions.ts) | 桌面页面申请屏幕、麦克风等原生能力 | 桌面主进程核对请求来源，操作系统决定是否授予权限。保留两处检查。 |
| [执行中枢 omnimux](../plugins/plugins/omnimux/src/media/execute.js) | 画布、Agent、媒体 HTTP 请求 | 网关按操作声明模型输入，中枢据此准入并映射实际请求。收拢各入口的字段必填规则。工具显式传递音乐风格及纯音乐开关；账本继续防重复提交。 |
| [工作流 omnimux-workflow](../plugins/plugins/omnimux-workflow/src/shared/validation/executionReadiness.ts) | 画布按钮、HTTP/Agent 启动和排队执行 | 工作流判定节点与上游素材就绪。收拢同一请求的重复解析。队列取到实际素材后复核，已受理任务按原任务标识恢复。 |
| [账号 omnimux-accounts](../plugins/plugins/omnimux-accounts/src/client/api.js) | 账号页面查询和修改 | 凡既有动作需要预检，复用中枢额度接口及错误识别；动作授权及账号元数据仍归账号服务。 |
| [发布 omnimux-publish](../plugins/plugins/omnimux-publish/src/submit.js) | 发布页面准备、后台队列派发 | 共用额度预检。派发器在执行时复核账号状态，因为排队期间授权可变。保留内容与平台适配检查。 |
| [灵感 omnimux-inspiration](../plugins/plugins/omnimux-inspiration/src/http-routes.js) | 页面检索、采集和本地写入 | 复用中枢额度错误处理；Host 保留对写入来源的检查，本地素材和采集请求继续使用各自访问规则。 |
| [商品 omnimux-products](../plugins/plugins/omnimux-products/src/library.js) | 手工创建草稿、Agent 新增商品 | 两个入口共用商品库，Agent 创建额外要求内容。保留现有行为；调整时需先明确草稿与可用商品的业务区别。 |
| [素材 omnimux-assets](../plugins/plugins/omnimux-assets/src/ingest.js) | 本地素材导入和写盘 | 导入服务在写入前检查可用空间；此时才掌握素材大小、目标磁盘和剩余容量。保留。 |
| [剪辑 omnimux-clip](../plugins/plugins/omnimux-clip/src/paths.js) | 打开项目、读写或导出项目文件 | 项目路径模块核对标识并将文件限制在对应根目录。保留，文件访问入口复用同一模块。 |
| [表单 omnimux-forms](../plugins/plugins/omnimux-forms/src/store.js) | 工作区草稿读取和保存 | HTTP 入口核对来源，草稿存储校验字段及预期修订号，防止并发覆盖。保留。 |
| [浏览器 omnimux-browser](../plugins/plugins/omnimux-browser/src/pairing.ts) | 浏览器扩展配对 | 配对服务核对请求与用户授予的连接许可。保留，模型的调用资格不能代替用户授权。 |
| [市场 omnimux-market](../plugins/plugins/omnimux-market/src/install-validation.ts) | 从市场安装包 | 市场安装器接触实际文件后校验内容和目录结构。保留，列表中的可选状态只用于选择。 |
| [视频 omnimux-video](../plugins/plugins/omnimux-video/src/understand/pack-video.js) | 视频分析和逆向拆解 | 两种操作共用本地视频检查，核对文件可读性与大小。保留在首次读取文件处。 |
| [分析看板](../plugins/plugins/omnimux-analytics/src/client/api.js)与[事件上报](../plugins/plugins/omnimux-analytics/src/stage-events.js) | 读取看板、手动同步、上报页面打开与关闭 | 看板共用中枢的额度与登录结果。事件上报由 Host 核对事件与字段白名单。 |
