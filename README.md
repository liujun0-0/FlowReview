# FlowReview · 功能链代码评审

沿完整业务流程理解代码和变化：方法框内展示执行过程，引用连接目标方法或对象，点击后在侧栏阅读完整源码、真实差异与修改说明。

## 本地使用

```powershell
npm ci
npm run build
npm run review -- --review <review.json>
# 或使用已有快照
node bin/flowreview.js --snapshot <snapshot-directory>
```

Windows 可将 JSON 拖到 `open-review.cmd`。依赖安装一次，之后随用随启；源码固定为本地快照，阅读进度独立保存。详见 [安装和使用说明](docs/custom-reader.md)。当前改名后的包尚未发布 npm。

支持方法流程画布、分支与循环说明、变更状态、对象引用、源码侧栏和测试代码过滤。旧 `yadiff` / `yadiff-review` 命令与已有 skill 启动脚本继续兼容。

## 来源与上游用法

基于 [baggiiiie/yadiff](https://github.com/baggiiiie/yadiff) 开发，保留作者署名、MIT 许可证及第三方许可证。以下为上游工具说明；其中 npm 命令安装的是原版 yadiff，并非 FlowReview。

<img src="assets/screenshot.png" alt="screenshot" width="800" />

> Huge shoutout to [pierrecomputer](https://github.com/pierrecomputer/pierre). Inspired by [diffshub](https://diffshub.com/), this tool is only possible thanks to the incredibly beautiful and high-performance diff and tree packages. All credit goes to the team!

A browser diff viewer for local git/jj diffs and GitHub PRs. It uses [pierrecomputer](https://github.com/pierrecomputer/pierre)'s open-source packages:

- [`@pierre/diffs`](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs) for parsing/rendering diffs
- [`@pierre/trees`](https://github.com/pierrecomputer/pierre/tree/main/packages/trees) for the file tree

## Usage

Run directly with `npx`:

```bash
npx @baggiiiie/yadiff
npx @baggiiiie/yadiff <git-ref-or-range>/<jj-revset>/<github-pr-url>
npx @baggiiiie/yadiff --working/--staged/--dirty
```

Or install globally:

```bash
npm install -g @baggiiiie/yadiff
yadiff HEAD
```

The command starts a local server in the background, opens the browser, acquires a diff from the selected source, and serves the patch to the browser. With no target, it defaults to `--working` (`jj @` in a jj workspace, otherwise `git diff`). The shell command exits after launch. When there are no browser sessions for one minute, the local server exits automatically.

Use `--foreground` to keep the server attached to the current terminal.

### Examples:

Git:

```bash
npx @baggiiiie/yadiff
npx @baggiiiie/yadiff HEAD
npx @baggiiiie/yadiff main..feature
npx @baggiiiie/yadiff main...HEAD --repo ../some-repo
npx @baggiiiie/yadiff --working/--staged/--dirty
```

jj:

```bash
npx @baggiiiie/yadiff @ --repo ../some-jj-repo
npx @baggiiiie/yadiff 'mine() & mutable()' --vcs jj
```

GitHub:

```bash
npx @baggiiiie/yadiff https://github.com/oven-sh/bun/pull/30412
```

Passing bun test:

https://github.com/user-attachments/assets/aeef9e88-5626-4799-9333-c4b9088282c8

## potential future improvement

- add a button to sync review to github, with `gh` cli?
- copy filename
- support for private repo and enterprise, with `gh` cli
- stdin support

## License

[MIT](./LICENSE).
