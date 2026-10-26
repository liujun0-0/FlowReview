# 上游来源与维护边界

FlowReview 是功能链代码评审产品，基于 yadiff 的代码起步，并直接使用 @pierre/diffs 展示源码和差异。

## 固定来源

- 上游：https://github.com/baggiiiie/yadiff
- 引入基准：138de3b（Hydrate local diffs for context expansion）。保留该提交及其之前的 Git 历史。
- 原版权：根 LICENSE 中的 Copyright (c) 2026 yingchao，MIT 原文保留。GitHub 上游维护者 baggiiiie 与许可正文署名分别如实记录。
- 原查看器前端已迁入 src/legacy/yadiff，Git/jj/PR 适配器和 CLI 已迁入 lib/legacy/yadiff。

## 提取的共享能力

src/shared/useTheme.ts、preferences.ts、theme.css 和 code/diffs.ts 由上游主题、偏好、基础样式与高亮/worker 配置提取并适配。保留 yd-* CSS 变量、yadiff:preferences 等存储名称以兼容已有数据，不视为产品入口或项目身份。

## FlowReview 的实现

src/app 是产品入口与使用引导；src/features/review 是评审界面；lib/review 是快照、解析、图模型和报告服务；lib/cli/review.js 是正式 CLI 实现；skills/code-change-review 与 tools/install_skill.py 负责分析规范和安装绑定。这些目录由 FlowReview 开发，不宣称属于上游原版。

bin/flowreview.js 是正式入口。bin/yadiff-review.js 与 bin/yadiff.js 只保留兼容转发；原查看器使用 /legacy 路径和 npm run dev:legacy。共享模块不得反向依赖兼容业务模块。

同步上游时记录来源提交，优先局部迁移到兼容目录，人工核对共享模块改动，不对整个项目自动覆盖。代码移动与功能改动尽量分别核对；路径与行为差异通过 Git diff -M、测试及浏览器回归检查。

第三方渲染、布局和解析组件另见 THIRD-PARTY-LICENSES 与 docs/licensing.md。目录归属用于说明维护边界，不替代各文件实际来源和许可证。
