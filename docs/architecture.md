# FlowReview 项目结构

## 产品边界

默认产品是功能链评审阅读器。代码分析规范随 skill 分发，本地工具采集固定 Git 源码，前端沿流程展示方法与变化。yadiff 原查看器作为可选兼容功能维护；无需通过它调用源码渲染器。

## 目录职责

- src/app：应用选择、默认首页。评审及兼容界面按需加载，避免首页直接初始化无关 API。
- src/features/review：流程画布、业务概览、源码侧栏与评审状态。
- src/shared：共享主题、偏好、基础类型及 @pierre/diffs 配置，不依赖 legacy 或评审业务代码。
- src/legacy/yadiff：原版 Git/jj/PR 查看器及其专用组件和样式。
- lib/cli/review.js：FlowReview CLI 正式实现，负责参数、快照启动和运行进程。
- lib/review：服务、固定快照、Java 方法索引、图模型与布局适配；本轮维持现有模块路径以稳定报告协议。
- lib/legacy/yadiff：原 CLI 与 Git/jj/PR 后端适配器。
- bin：公开命令，FlowReview 及旧命令的薄入口；skills、tools、test、licenses 分别维护配套资源。

## 入口与兼容

/ 显示 FlowReview 使用引导；/review/:id 打开已注册的固定报告；原版查看器由自己的 CLI 服务在 /legacy 提供原有 API。FlowReview 报告服务不承诺提供原版 API，两个服务不混用。

npm run dev 启动 FlowReview 前端开发首页，默认仅监听本机。它只提供前端热更新，不启动报告 API；查看真实报告仍通过 npm run review / flowreview 命令启动本地阅读服务。原版全栈开发用 npm run dev:legacy。

旧命令 yadiff-review 仍可采集/打开报告，旧 yadiff 保留 Git/jj/PR 功能以及 --review/--snapshot 的转发。JSON、manifest、快照、报告地址路径和状态目录不在本轮迁移。重启服务的访问凭证可能变化，使用新输出地址。

## 本轮验收

类型检查和正式构建通过；新旧 CLI 帮助及 Git 适配器验证；既有阅读器回归、skill 安装测试通过；浏览器核对首页和真实报告的流程与源码侧栏；分发清单包含共享/兼容实现及来源说明。

后续在独立任务中拆分超大阅读器组件、服务与图模型，不与这轮目录迁移混做。来源及版权依据见 ../UPSTREAM.md。

## 源码查看器边界

评审业务只使用 src/shared/source-viewer 的公开 SourceViewer、SourceViewerProvider 与自有 types。输入为修改前后源码、原始范围、显示模式、主题和 ReactNode 说明；点击返回 text/old或new侧/原始快照行号。业务层保留取码权限、版本状态、方法配对是否可靠、关系检索与跳转决策，不交给渲染器推测。

默认 PierreRenderer 位于 adapters/pierre，内部处理第三方类型、行内说明位置、Worker、高亮与虚拟滚动。方法差异解析位于 lib/source-viewer/pierre，只有适配层及其专项测试使用返回的库专用结构。原版兼容界面也使用该适配层的配置，但暂不重写其独立交互。

SourceViewerProvider 可接受自有 SourceRendererAdapter（Renderer 与可选 Provider），替换引擎时更改 adapters/default.ts 的选择或传入适配器，不需把库专用对象传入业务组件。原版 legacy 查看器仍直接使用 Pierre，不代表整个项目可以立即卸载该依赖。PlainTextRenderer 可作为独立适配器，也用于同步渲染错误时的降级；明确不具备语法高亮、精确差异和标识符跳转。React 边界不保证捕获异步 Worker 或事件回调中的所有错误。

完整源码自动定位及片段点击行号由适配器映射；片段原始范围不变。当前视觉行号仍可能是片段内编号，点击事件统一使用原始快照坐标。未来引擎不具备的能力必须明确呈现，不能制造等价行为。协议由类型检查、同一份数据换用纯文本适配器的渲染测试、坐标及依赖边界检查保护。

## 阅读状态与安装更新

阅读器的 API、源码缓存、阅读状态队列和返回位置分别位于 features/review 的 api、useSource、useReadingState、useSourceNavigation 模块。源码缓存按文件数量限制为24项，并避免切换文件时短暂显示上一个文件的内容。图过滤及节点选择回调保持稳定，差异计算依据快照内容与范围而非临时对象引用。

进度采用 PATCH /state 按节点字段提交 changes 和 expected 原值。不同节点或不同字段可合并；同一字段被其他页面修改时返回409，不覆盖远端内容。浏览器保留未保存草稿并提示复制后核对，离开页面时有未保存提醒，未完成保存时不允许直接停止服务。旧PUT整份替换需要当前baseRevision（首次revision=0兼容旧页面），防止旧页面静默覆盖新进度。状态文件仍兼容原marks，另加revision；报告和源码快照格式不变。视图位置允许最后一次导航生效，不参与疑问字段冲突判定。

SourceViewer 使用 view.kind/source/diff 与 diff.scope 区分请求，源码模式不能同时指定对照布局。完整文件接入全部关联节点说明，旧侧定位显式使用删除侧坐标；在渲染回调与下一帧就绪后定位，不以固定等待时间判定就绪。

安装器先在同一父目录暂存，复制完成再切换。切换失败恢复旧目录；切换中断留下的受管理备份在下次安装时恢复。仅清理 managedFiles 已登记但新版本移除的文件，个人补充文件保留；旧安装记录没有文件清单时不猜测删除。Windows瞬时目录占用有限重试，持续失败则保留旧安装并报告错误。安装路径或其内部管理资源含越界链接时拒绝覆盖。
