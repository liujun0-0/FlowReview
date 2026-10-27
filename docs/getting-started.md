# FlowReview 安装与使用

FlowReview 包含两个配套部分：`skills/code-change-review` 指导支持 SKILL.md 的 AI 工具分析代码并生成 JSON；本地阅读器采集 Git 源码快照并展示流程、差异和解释。阅读器不内置模型，也不要求配置模型 API Key。生成解释需要你自己的 AI 工具及其模型权限；只阅读已有报告不消耗模型 token。

## 1. 安装阅读器

准备 Git、Node.js（推荐 22.12+ 或 24 LTS，含 npm）、Python 3.10+。构建依赖 Vite 7，Node 18 不满足本项目构建要求。下列命令在 Windows PowerShell、macOS 或 Linux 终端均可分行执行；Python 命令按设备改为 `python3` 或 `py -3`。

```sh
git clone --branch custom https://github.com/liujun0-0/FlowReview.git
cd FlowReview
npm ci
npm run build
```

Windows 也可进入项目双击 `setup-review.cmd` 安装和构建。只在首次安装或依赖更新时运行 npm ci；阅读器源码更新后重新 build。当前未发布到 npm，不要用上游 `npx @baggiiiie/yadiff` 代替 FlowReview。

## 2. 安装配套 skill

在 FlowReview 根目录执行：

```sh
python tools/install_skill.py
```

默认安装至 `~/.agents/skills/code-change-review`。请确认你的 AI 工具会扫描此目录；否则用 `--skills-dir` 指定它实际扫描的 **skills 父目录**，然后重载该工具的技能列表或新开会话：

```sh
python tools/install_skill.py --skills-dir "/path/to/your/skills"
```

安装器复制仓库自带 skill，并在安装副本内记录配套 FlowReview 的位置，不上传信息、不改全局环境变量。已有同名 skill 默认拒绝覆盖；只有此安装器管理的副本才能用 `--update` 更新。个人旧 skill 请先备份并移走或选其他目录，避免悄悄覆盖。也可直接让 AI 读取仓库内的 `skills/code-change-review/SKILL.md`，无需复制安装。

## 3. 让 AI 生成报告

在 AI 工具可访问的业务代码工作区中明确引用 `code-change-review`（支持 `$skill-name` 的工具可用 `$code-change-review`），例如：

> 使用 code-change-review 评审 /path/to/business-repo 的 main..feature 变更。先还原入口到落库/下游的完整功能链，再标出变化。生成 JSON、固定源码快照并打开 FlowReview；重点检查修改原因、异常分支和影响范围。

跨项目时逐个提供 Git 根目录和版本范围。默认报告需要 JSON 的 `repositories`、功能链 `flowPoints`、方法节点和经核对的关系；格式见 [report-format.md](../skills/code-change-review/references/report-format.md)。skill 不依赖本项目维护者的工作区规则或个人目录。Java 方法解析最完整；其他语言仍能阅读源码和差异，但不承诺同等方法定位与调用跳转能力。

JSON 中的业务说明由 AI 分析生成，源码和 diff 从本地 Git 采集。调用、同名定义候选及对象匹配的证据边界会保留；图不是运行时追踪，不能代替测试或独立审查。

## 4. 打开、校验和重开报告

在 FlowReview 根目录运行（参数用实际路径替换）：

```sh
# 一步采集并打开：报告应指定实际 repositories
npm run review -- --review "/path/to/review.json"

# 分步交付：输出目录必须尚不存在
python skills/code-change-review/scripts/open_reader.py "/path/to/review.json" --out "/path/to/new-snapshot" --build-only
python skills/code-change-review/scripts/check_sequence.py "/path/to/new-snapshot/manifest.json" --strict
python skills/code-change-review/scripts/open_reader.py --snapshot "/path/to/new-snapshot"

# 无图形环境先打印地址；浏览器需运行在同一设备
node bin/flowreview.js --snapshot "/path/to/new-snapshot" --no-open
node bin/flowreview.js --stop
```

Windows 可将报告 JSON 拖到 `open-review.cmd`。正常结果是 `http://127.0.0.1:端口/review/...#凭证`，不是旧版单文件 HTML。服务只监听本机，默认端口 5188，页面持续发送心跳；没有心跳五分钟后退出。服务重启后地址中的凭证可能变化，应使用本次输出的新地址。

阅读顺序建议：先看链路来源、输入输出和第一处变化 → 在方法画布读步骤和分支 → 点击方法标题查看完整方法，点击流程引用看目标源码 → 对照变化解释，标记看过或记录疑问。支持过滤测试代码、缩略图、缩放、自动排列及定位当前方法。

## 5. 路径、存储与更新

- `open_reader.py` 查找顺序：`--tool-dir` → `FLOWREVIEW_HOME`（兼容 `YADIFF_REVIEW_HOME`）→ 仓库相邻位置 → 安装副本的 `.flowreview-install.json`。明确指定的错误位置会报错，不静默改用另一套版本。
- 首次安装记录只在你的机器生成，不应提交到公共仓库。项目目录搬动后，重新运行 `python tools/install_skill.py --update`，自定义安装目录还需传原 `--skills-dir`。
- 默认快照位于输入报告旁的 `reader-snapshots/<时间>/`；包含源代码和差异，按业务仓库权限保存，勿当成公开示例上传。旧快照不会自动随当前代码改变。
- 运行注册、访问凭证和阅读进度为兼容保存在用户目录 `.yadiff-review`。可用 `FLOWREVIEW_RUNTIME` 覆盖（兼容 `YADIFF_REVIEW_RUNTIME`）。项目与 skill 可以共用，运行状态和业务报告分别保存。
- 更新：停止服务 → `git pull --ff-only` → 依赖变化时 `npm ci` → `npm run build` → `python tools/install_skill.py --update`。直接引用仓库 skill 的用户无需复制更新。
- 卸载：停止服务，从 AI 工具的 skills 目录移走安装副本；按需保留快照和阅读进度。无需删除业务仓库。

## 6. 常见问题

- skill 未被发现：确认安装到了该 AI 工具实际扫描的目录，重载后显式引用名称或 SKILL.md 路径。
- 找不到阅读器：重跑安装器 `--update`，或用 `--tool-dir` 指向有 `package.json` 和 `bin/flowreview.js` 的根目录。
- 尚未构建或引擎版本不符：检查 Node 版本，在项目根目录执行 npm ci 和 npm run build。
- JSON 缺 repositories：这是旧报告或离线示例，需补齐真实仓库与比较范围；不能拿示例自带代码冒充已采集的业务源码。
- 方法/关系缺失：按检查器诊断补齐 JSON 的方法行号、过程或证据并生成新快照；结构检查通过不证明业务结论正确。
- 启动失败：查看完整命令错误；如默认端口被占用，用 `node bin/flowreview.js --snapshot <目录> --port 5189`。不要自动退回旧版 HTML。

商用和再分发须同时遵守原项目及依赖协议，见 [licensing.md](licensing.md)。

## 项目开发入口

`npm run dev` 打开 FlowReview 前端开发首页（仅前端，无报告 API）；完整报告继续用 `npm run review -- --review <JSON>`。原版 Git/jj/PR 查看器位于兼容模块，使用 `npm run dev:legacy`，页面地址为其服务的 `/legacy`。结构与维护边界见 [architecture.md](architecture.md) 和 [UPSTREAM.md](../UPSTREAM.md)。

## 多窗口阅读与安全更新

同一报告可在多个窗口阅读，不同标记和疑问字段分别保存。若两个页面同时修改同一条疑问的文本，页面会提示冲突，后一次内容不会静默覆盖已保存文本；本页草稿仍在，请复制内容后刷新核对。网络失败也会保留草稿并提示，未保存时关闭/刷新会触发浏览器提醒，停止服务按钮会先检查是否已保存。长疑问单条最多10000字符，超过时明确拒绝，不截断后声称保存成功。

更新到此版本时，先按正常流程保存并停止服务，构建后重新启动，并刷新所有旧页面。新进度接口防止旧页面整份覆盖，因此旧页面可能提示需要刷新。既有源码快照和阅读标记无需重新生成。

skill --update 会暂存新文件再切换，失败时自动恢复旧副本，并保留个人补充文件。只清理安装记录中已登记的过期文件。若上次切换意外中断，重跑同一命令会先恢复受管理备份；无法确认归属的备份会停止并提示人工核对，不直接删除。


### 沿链连续阅读

功能链默认进入「全链路画布」，可以切换到「沿链阅读」：按报告业务步骤保留原有处理过程，变化方法展示真实方法差异及代码旁说明，未修改方法先展示主要功能，可按需展开源码。执行过程里的方法引用可以定位到链上对应方法，并返回上个阅读位置；「侧栏查看完整方法」打开独立源码面板，不改变主阅读区位置。

可切换前后对比、修改前/后源码、代码旁说明，以及隐藏测试代码。对象引用仍从首次同名出现的位置关联，属于静态定位，需核对实际类型。需要查看分支拓扑时切换「全链路画布」或「业务步骤图」。业务步骤顺序不代表异步、分支的真实运行时顺序；未采集实现会保留提示。旧报告缺少业务步骤时展示已有方法路径，不推测完整链路。源码按滚动位置加载，仍来自固定快照，无需 skill 内嵌源码或重新生成报告。


### 每个功能的全链路画布（默认）

左侧仍按功能分区。选中一个功能后，默认展示这个功能自己的「入口 → 项目内业务步骤 → 最终结果」画布，标注各步骤的新增、修改、删除和原有状态，以及报告中首个变化步骤。展开项目后显示该项目的方法框、嵌套执行步骤与对象引用；已定位的调用线从具体执行步骤连到下游方法，未展开的下游项目先作为调用目标，展开后连接到具体方法。

点击方法标题查看完整方法，点击方法内部的调用查看目标方法，源码始终在右侧展示。项目内业务分支、异常、表和下游说明来自报告；项目归属、入口及结果关联以虚线区分，不能当作已证实的直接方法调用。功能没有完整链路数据时明确提示，不凭方法排列猜入口和结果。可以随时切换「沿链阅读」或「业务步骤图」。切换功能会回到该功能自己的项目总览。


### 找得到 skill 但读取时“拒绝访问”

更新 FlowReview 后重新执行安装器的 `--update`。Windows 安装暂存目录继承 skills 父目录权限，避免临时目录的仅所有者 ACL 随重命名成为正式安装权限。无需给 Everyone 授权。应在实际使用的普通执行环境中读取安装后的 SKILL.md 与启动脚本验证；不能仅以管理员环境安装成功认定可用。

权限失败不等于文件不存在；不要切换 Downloads 或备份中的旧同名 skill。新版 render.py 只保留摘要/校验及显式 `--legacy-html` 模式，默认启动入口为 open_reader.py，错误使用旧 HTML 命令会明确报错。


### 画布交互与入口/结果示例

对象引用线按对象状态区分：新增绿色、修改蓝色、删除红色；颜色表示目标对象的变化，虚线含义保持不变。项目展开、收起及自动排列保留当前缩放并保持当前项目的视觉锚点，只有首次总览或主动“适应全图”才缩放。框内非按钮/输入/折叠控件区域都可拖动，无需瞄准小拖动柄。

入口根据匹配到的接口方法显示新增/修改/删除/未修改，未能唯一匹配时显示待核对，不依据下游新增业务步骤猜测。点击“查看参数示例”或“查看结果示例”，在右侧阅读 report 中 journey.source.requestExamples / responseExamples 的内容及依据。旧报告未提供示例时保留输入/结果说明和缺口提示，不生成伪造 JSON；无请求体的接口可按已有入口和明确无 body 说明展示调用形式。新报告的示例采集要求已写入配套 skill。


总览连线仅显示一层关系：已有业务连线时优先展示业务流转；没有业务连线时按已核对方法关系汇总项目调用。同一对项目的方法调用在总览合并，展开后查看具体调用位置；真实业务分支条件仍分别保留。未连线步骤不再一律直连功能入口/结果，“对应实现”由项目外框表达，不额外画箭头，避免被误认为重复调用。

### 同一功能有多个接口

全链路画布支持多个入口，工具栏可筛选单个接口；公共下游方法只展示一次，点击入口/结果查看当前接口示例。新版 skill 通过 journey.entries 关联到真实入口方法；旧报告可从已有 endpoint 与确定调用关系展示局部链路，缺失参数、结果和未关联方法会明确提示，不自动重做源码分析。
