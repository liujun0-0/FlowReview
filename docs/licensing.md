# 许可证、修改与商用

## yadiff 原项目

已核对本仓库继承的 [LICENSE](../LICENSE) 与 [上游 yadiff](https://github.com/baggiiiie/yadiff) 的 MIT 标识。原文保留 `Copyright (c) 2026 yingchao`。

MIT 允许使用、修改、合并、发布、分发、再许可、销售副本，也可用于商业产品；不要求公开自己的修改。条件是分发副本或软件实质部分时保留原版权及完整许可声明。改名不会免除该条件，也不代表获得上游商标、背书或额外权利。软件按现状提供，没有适用性等担保。依据：[OSI MIT 正文](https://opensource.org/license/mit)。

仓库新增的配套 skill 按本项目根 LICENSE 的 MIT 条款分发；第三方组件保留各自许可证。不要把项目 package.json 的 MIT 字段理解为所有依赖都能改成 MIT。

## FlowReview 的第三方组件

- React Flow（@xyflow/react 12.12.0）：MIT，原文在 [licenses/react-flow-MIT.txt](../licenses/react-flow-MIT.txt)，界面保留 attribution。
- @pierre/diffs、@pierre/trees、java-parser、Chevrotain：Apache-2.0。保留适用版权、许可与 NOTICE，修改这些第三方文件时须标注；许可原文副本见 [licenses/Apache-2.0.txt](../licenses/Apache-2.0.txt)，具体声明见 [THIRD-PARTY-LICENSES](../THIRD-PARTY-LICENSES)。
- elkjs 0.12.0：选择其 **EPL-2.0** 许可选项，原文在 [licenses/elkjs-EPL-2.0.md](../licenses/elkjs-EPL-2.0.md)。当前仅通过独立模块接口使用未修改的布局引擎。

EPL-2.0 允许商业分发，但分发受其覆盖的程序时须保留通知，并告知接收者源码在 EPL 下可用及获取方式。修改 ELK 受覆盖部分后分发，也需提供相应源码，不能仅留下自己的 MIT 声明。单独通过接口使用不等于所有应用代码自动变为 EPL；最终范围取决于实际修改和组合方式。商业分发者另有第 4 节责任条款。依据：[Eclipse EPL-2.0 第 1、3、4 节](https://www.eclipse.org/org/documents/epl-2.0/EPL-2.0.txt)。

ELK 源码获取说明：未修改的 elkjs 0.12.0 来自 [kieler/elkjs](https://github.com/kieler/elkjs)，发布记录见其 Releases，npm 分发包见 [elkjs 0.12.0](https://www.npmjs.com/package/elkjs/v/0.12.0)。源码及构建说明按上游仓库提供的方式获取；再次分发时须一并保留该获取说明和 EPL。若修改引擎，发布者应提供对应自己版本的源码位置。

## 本项目的交付约定

源码/安装包中保留 LICENSE、THIRD-PARTY-LICENSES、licenses/ 及本说明。npm 的打包清单也包含 skill、安装脚本和文档；尚未执行 npm 发布。业务报告、私有源码快照、访问凭证和用户安装路径不属于公开项目交付物。

以上核对覆盖原项目及所列关键组件，不是对全部传递依赖、专利或具体闭源产品的法律保证；正式商业发布应按锁定版本和最终分发包继续核对。
