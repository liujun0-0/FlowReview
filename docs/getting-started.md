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
