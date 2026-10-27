# 报告格式

默认交付为 JSON → scripts/open_reader.py → 固定源码快照与 localhost 阅读地址。本文最小字段示例仅用于说明结构，不能替代完整业务 journey 和最终启动步骤；旧版 render.py HTML 仅在用户明确要求时使用。

根对象包含 `meta`、`flowPoints`、`orphans`、`unknowns`、`verifyPlan`，可选 `implChanges`、`repositories`、`exclusions`。列表元素必须为对象。

## 最小字段示例

```json
{
  "meta": {"title": "修正取消入口"},
  "flowPoints": [{
    "id": "FP-1", "title": "订单归属校验", "status": "完整",
    "requirement": "取消前校验订单归属",
    "chains": [{
      "id": "C1", "name": "CancelController → CancelService",
      "sideEffect": "更新订单状态，返回取消结果",
      "hops": [{
        "id": "h1", "file": "src/CancelService.java", "line": 42, "side": "new",
        "func": "cancel", "type": "改实现", "tier": "细看", "focus": ["边界"],
        "risk": "高", "confidence": "猜",
        "why": "对应需求：取消前校验归属", "behavior": "增加归属检查",
        "role": "执行订单取消与权限检查", "verdict": "待确认",
        "assessmentReason": "需要读取调用方身份获取逻辑",
        "counterfactual": "保留旧的归属检查路径",
        "risk_detail": "需核实身份值来自可信上下文",
        "verify": "跨租户取消应拒绝且状态不变", "verifyStatus": "未执行"
      }]
    }]
  }],
  "orphans": [], "unknowns": [], "verifyPlan": []
}
```

此例仅展示字段，使用时替换为实际源码和证据。status 是生成者的需求覆盖判断，不由渲染器认证。

## 字段规则

- `meta.title` 必填。`meta.range` 兼容旧格式：空为 HEAD 到工作区，`a..b` 为树比较，`a...b` 为 merge-base 比较；不能拼接多个命令参数。
- `meta.stats` 可填 `{files,added,removed}` 非负整数，Git 模式由实际统计覆盖。旧 `meta.stat` 中英文字符串仅为离线兼容。
- 功能点必填 `id/title/status/requirement`；status 取 完整/部分/缺失。缺失功能点可用空 chains。
- 链必填 `id/name/sideEffect/hops`；只读链明确写“只读，返回结果”等。
- hop 必填 `id/file/line/type/tier/risk/confidence/why/risk_detail/verify`。ID 唯一，只用字母数字下划线连字符，不能以 orphan 开头。
- line 为正整数，side 取 new/old（默认 new，删除默认 old）。重命名在机械覆盖中按旧路径删除、新路径新增处理，分别填写路径与侧。
- 细看项必填 role；有改动还需 verdict/counterfactual；待确认必填 assessmentReason。
- evidence 是实际检查的源码位置与结论字符串。缺少证据的“确定”产生警告，界面显示推测。
- verifyStatus 取 未执行/通过/失败/受阻，默认未执行。通过或失败必填字符串 verifyResult/verifyEvidence。
- Git/浏览器模式默认省略 code，由本地工具采集源码；只有无 Git 的离线自带源码示例才填写。code 每行 `{t,n,c}`，t 取 `+/-/空格`，n 整数，c 字符串。真实 Git 模式重新取码。
- orphan 必填 what/reason/suggestion/tier，定位用 file+line 或 `location: 文件:行号`，跨项目需 project。
- unknowns 每项 what/reason/how，可空。verifyPlan 每项 strategy/target/how/why，大改动必填非空计划。
- implChanges 每项 location/change/impact，汇总签名未变但实现变化的影响。

## 跨仓库配置

```json
{
  "repositories": {
    "order-job": {
      "path": "D:\\workspace\\order-job",
      "scope": {"mode": "branch", "base": "main", "head": "feature/timeout"}
    },
    "order-svc": {
      "path": "D:\\workspace\\order-svc",
      "scope": {"mode": "worktree", "base": "HEAD"}
    }
  }
}
```

path 必须是 Git 根目录，节点 file 是对应仓库内相对路径。所有 hop/orphan/exclusion 的 project 必须匹配映射 key。scope.mode 必填，range/branch 需 base/head，commit 需 commit 字段。

exclusions 示例：`[{"project":"order-svc","file":"assets/icon.png","reason":"二进制图片，另由人工核对展示及哈希"}]`。单仓库没有 repositories 时省略 project。排除按文件生效，原因保留在报告中。

Git 自动输出 sourceSnapshots（各仓库模式、路径、base/head SHA、diff SHA256、统计）及 coverage（文件状态、未展示 hunk 序号、排除原因）。不要由模型填写机器证据。非文本变更须另行人工核对。


## 浏览器阅读器补充（2.4）

功能点可选 `before`、`after`，分别用业务语言说明原有完整流程与本次行为变化。不能根据 diff 自动编造需求或调用关系。节点仍沿用现有字段；源码由 Git 和工作区采集，JSON 的 code 不能覆盖实际源码。

2.4.1：减少重复源码和长说明，不改变必填字段及证据要求。同一方法跨链可以复用分析事实，但各节点仍须说明本链路中的用途、影响和实际风险；不能使用当前渲染器不支持的 whyRef/codeRef 等引用字段。


## 模块图与关系（2.5，兼容旧视图）

hop 可填写 `branches: ["分支条件 → 处理结果", "失败条件 → 异常/回滚结果"]`；与 role、behavior、why 一起展示在代码旁。无分支的方法如实说明，不生成虚构条件。模块图按 project/file 归并，同一新增文件只有一份源码；源码范围不依赖说明字段。

chain 可填写 `links: [{"from":"h1","to":"h2","label":"校验通过后调用","confidence":"确定","evidence":"实际调用位置与核对结果"}]`。端点必须是本链 hops 的 id，采集器映射为阅读节点 id；未知端点拒绝输出。支持多条出边表达条件分支和异步边界。确定但无证据仍为虚线；缺少 links 时仅显示关联阅读顺序。类内的方法关系保留在输入中，模块图不把同文件内调用画成跨模块箭头。


## 方法级调用图（2.6，兼容旧视图）

方法下钻图以真实方法为节点，以 project、file、签名、版本及侧区分身份；同一文件内的调用边不能合并丢失。角色/函数定义之外的字段、DTO 等仍留在阅读目录，不能冒充执行步骤。方法变化状态由采集器对定位到的新旧方法内容核对；仅有名称或文件变化时不可据此判定方法修改。

修改/新增 hop 填 `process`（主要处理过程的简短文字）、`role`（功能）、`branches`（关键正常/失败/兼容分支）、`behavior`（改了什么）、`why`（理由）。未修改方法以功能说明为主。接口 hop 可补 `endpoint: {"method":"POST","path":"/customer/import/new","evidence":"实际类/方法/继承接口映射位置"}`；采集器优先提取字面量映射。path 是应用内路由，不能直接声称包含网关或部署前缀。

chain.links 表达谁调用谁、条件/异步/跨服务边界；from/to 是本链 hop.id。图中引用列表可继续跳到被调或调用方法，并显示对方的变化状态。点击前不默认把全部源码载入界面；明确选择全链源码时才连续展示。同一新增类仍保持单份源码、多处方法说明。


## 业务流程图 journey（浏览器阅读器）

每个 flowPoint 的新生成功能链报告须填写 `journey`；旧版单文件 HTML 不展示该扩展，方法数据仍需保留。没有 journey 的旧报告保留已采集项目/方法，提示入口与结果缺失，不能声称完整全链路。

- `source`：字符串 `actor`（触发者/数据源）、`entry`（HTTP method + 应用内 URL 等）、`input`、`purpose`、`outcome`。
- `coverage`：字符串 `status` 说明已核对程度；`boundaries` 字符串数组说明未展开与未核实边界。这里是静态追踪范围，不是测试结果。
- `steps`：业务步骤数组。每项 `id/title/project/layer` 必填；`phase` 为业务阶段分组；`kind` 取 start/process/decision/storage/external/end/failure。
- 每步填写字符串 `purpose/input/output/process`，字符串数组 `branches/tables/downstreams/evidence`；无表或下游时用空数组，不猜表名或完整公网地址。
- `implementationIds`：本功能点 chains 中实际 hop.id 数组，指向已定位的方法；快照工具映射成阅读节点 ID。允许一个步骤关联多个实现、多个步骤共用方法。不要填文件名或自造 manifest ID。
- 每步 `change`：`status` 取 unchanged/modified/added/deleted/unknown；`kind` 取 behavior/implementation；`before/after/reason` 为字符串；`impact` 为字符串数组。modified/added/deleted 必须有前后行为和理由；新增步骤的 before 说明旧路径如何处理或不存在什么能力。抽取方法不等于新增业务动作，业务步骤可标 modified + implementation，并写清预期保持行为仍需验证。
- `links`：业务过程边数组，每项 `from/to` 是 steps.id，`label` 说明条件/结果/异步交接，`kind` 描述边类型，`confidence` 用“确定/猜”，`evidence` 写实际核对的源码事实。确定且有证据画实线，其余虚线。不能用数组顺序伪造执行关系。

以下是单步字段示例，真实报告必须补全入口到结果、分支/失败路径及实际实现定位：

```json
{
  "source": {"actor":"调用导入接口的客户端","entry":"POST /customer/import/new","input":"文件标识、渠道与操作人","purpose":"把文件行导入客户","outcome":"客户及批次成功失败结果"},
  "coverage": {"status":"已核对后端主路径；端到端测试未执行","boundaries":["调用方页面事件未采集"]},
  "steps": [{
    "id":"validate","title":"校验导入文件","project":"customer-service","phase":"1 接入","layer":"业务层","kind":"decision",
    "purpose":"阻止无效文件进入后台任务","input":"解析后的表头与行","output":"通过或具体失败原因","process":"核对固定身份列后检查额度",
    "branches":["不合法时终止；通过后创建任务"],"tables":[],"downstreams":[],"implementationIds":["h1"],"evidence":["实际文件:行号及已核对结论"],
    "change":{"status":"modified","kind":"behavior","before":"统一按手机号检查","after":"按渠道选择身份列","reason":"新渠道身份不是手机号","impact":["创建任务是否获准"]}
  }],
  "links":[]
}
```


## 功能全链路画布与方法流程（3.4，当前默认）

每个 flowPoint 对应左侧一个功能分区及一张独立画布。默认“全链路画布”，项目展开后显示方法流程，另可切换“沿链阅读”和“业务步骤图”。项目分组由 steps.project / hops.project 得出，必须与 repositories 的项目标识一致。不要输出新的 UI 布局或坐标字段。

`journey.links` 是业务步骤的连接依据，`chains[].links` 是方法关系的依据，二者不能互相替代。多步骤没有业务连线时会显著提示缺口，不能只填 source/steps 就声明完整。仅转换旧报告保留原缺口，不根据数组顺序补造关系。

采集要求以 [method-sequence.md](method-sequence.md) 为准。沿用 hops 的准确方法定位、role/process/branches/behavior/why/endpoint、chain.links 和 journey，不新增未实现的 JSON 结构。方法内过程在 process 中有序概括，关键调用以 links 连接到独立方法 hop；类/字段说明不能冒充方法。对象使用位置写在方法 process 及对象 evidence 中，工具的自动挂接仍是快照内词法候选。

导出快照后用 scripts/check_sequence.py manifest.json --strict --require-business-flow 核对新报告的结构性缺口；纯转换旧报告仅用 --strict 保留兼容；通过只表示这些机械检查未发现缺口，不证明调用关系、业务说明、审查或运行验证正确。


## 入口参数与结果示例（3.5，可选扩展）

`journey.source` 可增加 `requestExamples`、`responseExamples` 两个数组。每项包含 `title`、`content`（展示用字符串）和非空 `evidence`（源码/接口契约/测试样例的准确位置）；可填 `language`（如 json/http/text）和 `description`。不生成 UI 坐标或新调用结构；旧报告缺少这些数组时界面明确提示。无请求体的接口仍写清 HTTP 方法、路径和无 body 的依据。

```json
{
  "requestExamples": [{"title":"按编号查询（按契约构造，非实测）","language":"http","content":"GET /samples/123","evidence":"SampleController.java:42，路径变量 id 为 Long","description":"123 为示意编号，不是真实业务数据"}],
  "responseExamples": [{"title":"返回业务结果（按契约构造，非实测）","language":"json","content":"{\"id\":123}","evidence":"SampleResponse.java:12，id 字段","description":"这里只展示该 DTO；实际统一响应包装须另行核对后填写"}]
}
```

只写已核对字段和响应包装；由契约构造的示例明确标示非实测，示例值采用虚构或去标识值，不含访问凭证、真实客户信息。异步接口将立即返回的提交结果与后台完成结果分开，失败示例注明触发条件。无法确认字段、包装或真实序列化规则时不编造，记录缺口。源码仍只给路径行号交给本地工具读取，不在 JSON 复述完整 DTO 源码。

## 同功能多接口入口（3.6）

侧边仍一个功能分区；全链路画布默认展示该功能全部接口入口，支持按入口筛选。公共下游方法只画一次，项目展开后保留方法内部调用位置。`journey.source` 继续概括整个功能，不能把它的参数和结果复制到所有接口。

新报告同一功能有多个接口时填写 `journey.entries`，每项字段：
- `id`：功能内唯一的稳定标识。
- `title/actor/entry/input/purpose/outcome/evidence`：字符串，分别说明接口用途、触发者、HTTP 方法与应用内路径、参数、主要功能、当前接口结果以及定位依据；异步提交响应和后台结果分别说明。
- `implementationId`：本功能 chains 内入口方法的 hop.id，由采集器映射为方法阅读节点 ID；不能填类或文件节点。
- `requestExamples/responseExamples`：可选，沿用带 evidence 的示例结构。未知参数或返回包装明确记录缺口，不拼造 JSON。

```json
{"entries":[
 {"id":"page","title":"分页查询","actor":"产品用户","entry":"POST /sample/page","implementationId":"h-page","input":"分页条件","purpose":"查询可用样例","outcome":"分页结果，响应包装待核对","evidence":"SampleController.java:30"},
 {"id":"detail","title":"详情预填","actor":"产品用户","entry":"GET /sample/detail","implementationId":"h-detail","input":"sampleId","purpose":"转换编辑器预填数据","outcome":"详情 DTO，响应包装待核对","evidence":"SampleController.java:50"}
]}
```

两个入口可以在同一 chain 的 hops 中共用同一方法，且以实际 `chains[].links` 分别连接。跨 chain 复用需要准确定位同一方法；不要伪造执行先后。业务主干仍由 `journey.steps/links` 描述，方法调用边仍需逐跳证据，循环与异常写在方法 process/branches。没有追清的实现保留 coverage.boundaries，不用关联顺序冒充调用。

旧报告没有 entries 时，工具只从已采集的 endpoint 方法分别建立入口候选，沿确定且有证据的方法关系追踪；不会拆解 `/page|filters|detail` 文本猜接口，也不会将功能总体 outcome 当成各接口返回。未关联的方法保留在功能目录，并提示数量。旧报告补全时应核对源码后添加 entries 与缺失方法链接。
