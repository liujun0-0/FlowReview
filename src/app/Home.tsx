import { useTheme } from '../shared/useTheme';
import './home.css';

export function Home() {
  const theme = useTheme();
  return <main className="fr-home"><header><strong>FlowReview</strong><button onClick={theme.cycleTheme}>主题：{{ auto: '跟随系统', light: '浅色', dark: '深色' }[theme.mode]}</button></header>
    <section><span className="fr-home-label">功能链代码评审</span><h1>先看懂流程，再判断改动。</h1><p>从功能入口追到方法、数据和下游，在完整链路中阅读源码与变化。</p></section>
    <div className="fr-home-steps"><article><span>01</span><h2>生成报告</h2><p>让 AI 使用配套的 code-change-review skill，指定业务仓库和比较范围，生成评审 JSON。</p><code>python tools/install_skill.py</code></article>
      <article><span>02</span><h2>打开与重开</h2><p>在 FlowReview 安装目录执行命令。Windows 也可把 JSON 拖到 open-review.cmd。</p><code>npm run review -- --review &lt;review.json&gt;</code><code>node bin/flowreview.js --snapshot &lt;快照目录&gt;</code></article>
      <article><span>03</span><h2>沿链深入源码</h2><p>先读来源和结果，再查看方法步骤。点击方法或引用，在侧栏对照完整源码、差异和修改原因。</p><small>服务重启后请使用命令新输出的报告地址。</small></article></div>
    <footer>报告与源码在本机阅读。源码快照独立保存，图中的分析结论仍需结合证据核对。<br/>安装与故障处理见项目 docs/getting-started.md。</footer>
  </main>;
}
