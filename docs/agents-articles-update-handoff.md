# agents 系列文章更新交接文档

> 编写日期：2026-09-28
> 用途：交给后续 agent 继续完成文章修订或重写。本文只记录现状与核对结论，**尚未修改任何文章**。

## 0. 基本信息

- 博客仓库：`/Volumes/data/project/blog`（Astro，包管理用 **pnpm**，回复与写作用**简体中文**）。
- 相关文章（均在 `src/content/post/` 下，frontmatter 中 `series: agents`）：
  - `agents-pi-mono/index.md`（seriesOrder 1，约 1770 行）
  - `agents-opencode/index.md`（seriesOrder 2，约 2070 行）
  - `agents-codex/index.md`（seriesOrder 3，约 2360 行）
- 源码目录：`/Volumes/data/project/agentdev/{codex,opencode,pi-mono,kimi-code}`，已于 2026-09-28 拉到最新。
- **注意**：`agents-codex` 和 `agents-opencode` 在工作区里还有 9-21 的改动没提交（codex 约 +1275 行，opencode 约 +511 行）。下文的行号都以**工作区版本**为准。开始修改前，建议先提交或确认这两处改动。

### 核对基线

| 仓库 | 文章对应基线 | 核对时 HEAD | 期间提交数 |
|---|---|---|---|
| codex | `40eeb6e8a8`（09-21） | `1cc7e23612`（09-28） | 404 |
| opencode | `70a24697ea`（dev，09-21） | `b471c2b449`（dev，09-26） | 32（与文章无关） |
| pi-mono | `7a2647f32a`（09-12） | `6f7551516`（09-28） | 197 |
| kimi-code | `1306a9a8db`（09-09） | `be7d5f5fe`（09-24） | 136（暂无文章） |

源码路径约定：codex 的路径以 `codex-rs/` 为根，pi-mono 的以 `packages/` 为根。

## 1. 总览与优先级

| 文章 | 状态 | 建议动作 |
|---|---|---|
| opencode | **分析对象选错**：写的是 dev 分支上的 v2 旧原型，不是正式发布的 v2 | 按 `origin/v2` 重写（大纲见 §2.4） |
| pi-mono | 中度过时，§2、§3、§7、§10、§11 的主干机制变了 | 改写这几节，并新增一节"system 消息写进对话记录" |
| codex | 中度过时，结构仍在，细节漂移 | 按 §4 的清单逐条修改，并补充新内容 |
| kimi-code | 暂无文章 | 可以另写一篇新的源码解析（§5） |

建议顺序：opencode（重写）→ pi-mono → codex。

---

## 2. opencode：需要重写

### 2.1 问题

- opencode 的默认分支是 `dev`。`dev` 里的 `packages/core`、`cli`（lildax）、`llm`、`schema` 看起来像 v2，但其实是 **2026-06-26**（merge-base `0e2dd4ad15`）从 v2 分出来的一份旧拷贝，`core/src/session` 在 8-18 之后就没再改过。
- 正式发布的 v2（`@opencode/cli@2.0.18`，命令是 `opencode`/`opencode2`）在 **`origin/v2` 分支**。v2 分支独有 3892 个提交：6 月 80 个、7 月 1008 个、8 月 1633 个、9 月 1171 个。
- 文章写作当天（09-21），`origin/v2` 上就已经没有 `promoteSteers`、`runTurnAttempt`、`PermissionV2`、`lildax`，而 `SessionInbox` 已在用（61 个文件）。所以这不是"写完后才过时"，是一开始就选错了基线。
  - `SessionInbox` 首次出现：`04b673432c`（07-06，#35371）
  - `promoteSteers` 被删：`0f3c30118c`（07-24，#38602，简化 runner 循环和 pending input scope）
  - v1→v2 数据迁移：`0fbe489e35`（08-05，#40723）
  - 压缩重构：`a64bc3616e`（09-26）
- `dev` 现在实际上是 **v1 的维护线**（`packages/opencode`，09-21 同步到 v1.18.32）。
- 文章开头的代码行数原本就不准：`cli/src/index.ts` 实际 32 行（文中写 69），`llm/src` 约 9533 行（文中写 2684），`schema/src` 3387 行（文中写 2561）。

### 2.2 如何拿到 v2 代码

不要直接 checkout 用户的仓库（除非用户同意）。可以导出到临时目录：

```bash
rm -rf /tmp/opencode-v2 && mkdir -p /tmp/opencode-v2
git -C /Volumes/data/project/agentdev/opencode archive origin/v2 packages specs | tar -x -C /tmp/opencode-v2
```

也可以建议用户执行 `git -C /Volumes/data/project/agentdev/opencode checkout v2`，这样以后拉到的就是 v2 分支。

v2 的 `core/src` 约 6.4 万行（旧文章写的是约 3.3 万行）。设计文档在 `specs/v2/`，包括 `session.md`、`tools.md`、`event-stream-architecture.md`、`provider-policy.md`。

### 2.3 v2 与旧文章逐节对照（路径相对 `/tmp/opencode-v2/packages/`）

| 章节 | 结论 | v2 实际情况 |
|---|---|---|
| §1 包与目录 | 需重写 | 包都在 `@opencode/*` 下，依赖链是 cli → server/client/tui → core → ai/codemode/plugin/schema；接口由 `protocol` 包用 HttpApi 定义，`server` 只实现 handler。默认模式下 `client/src/effect/service.ts` 的 `ensure` 会拉起 `opencode serve --service`（托管的后台 service，通过 service.json 发现），另有 `--server` 和 `--standalone` 两种模式（`cli/src/services/server-connection.ts:21`）。路由在 `protocol/src/groups/session.ts:181-885`，新增 inbox.list/cancel/update、form.*、log、background、wait、move、environment 等 |
| §2 整体流程 | 需大改 | 大框架仍是：输入先落库 → wake → drain，每个会话只有一个执行者 |
| §3 输入接收 | 需大改 | 表 `session_inbox`（`core/src/session/sql.ts:125`，列有 delivery、enqueued_seq）。`Session.prompt`（`session/session.ts:146`）先发 `InboxEnqueued` 事件，再调 `execution.wake`。入队条目有 user/synthetic/compaction/move 四种，手动压缩和会话迁移也走同一个 inbox。取出靠 `SessionInbox.promote`（`inbox.ts:496`）和 `nextPromotable`（`inbox.ts:407`），compaction 会被提到之前的 steer 前面（`inbox.ts:533`） |
| §3 调度 wake/pendingWake/settle | 基本可用 | `core/src/session/run-coordinator.ts`：类型改名为 `Execution`（第 40 行），`pendingWake` 从布尔改为 `Promotable`（"input"\|"steer"，第 141 行），新增 scope 和 interruptionReason。`SessionExecution`（`execution.ts:57`）新增写前 claim，用于崩溃恢复；`DrainResult` 分 Complete/Moved/Reloaded |
| §4-5 Runner / runTurnAttempt / Context Epoch | 需重写 | `session/runner/llm.ts:54` 的 `drain`：外层 `advanceToStep`（第 71 行）负责取控制项、promote、处理 move/compaction；内层 `runStep`（第 206 行）负责 auto compaction、组装请求、调 `SessionStep.attempt`，结果分 Retry/Continue/Compacted/RecoverFull。上下文由 `SessionContext.select/load`（`context.ts:51`）提供，请求由 `SessionModelRequest.baseTranscript/primary`（`model-request.ts:97,411`）组装。原来的 epoch 改成 `InstructionState`（`instruction-state.ts`，三张表，按内容哈希做增量） |
| §6/8 模型流与收尾 | 需大改（思路还在） | `runner/step.ts:72` 的 `attempt`：工具用 `forkScoped` 并发执行，之后 `Fiber.awaitAll`，结果用 `Outcome` 表示；状态由 `publish-llm-event.ts:77` 发布；重试在 `runner/retry.ts`（最多 4 次指数退避） |
| LLM 层 | 需重写 | `llm` 包换成 `packages/ai`（约 2.9 万行）：`llm.ts` 的 stream/generate、`route/`、约 45 个 protocols、58 个 provider，支持图像/语音/转写/视频等多模态；另有 WebSocket 传输（`core/src/session/model-transport.ts`） |
| §7 工具 | 需大改 | `core/src/tool.ts` 的 `Tool.Service.snapshot(permissions)`（约第 225 行）；`tool-output.ts` 的 `ToolOutput.truncate`（2000 行 / 50KiB，保留 7 天）；内置工具都是插件（`core/src/tool/plugin/*.ts`：edit、glob、grep、read、write、patch、shell、subagent、question、skill、webfetch、websearch 等），注册在 `plugin/internal.ts:214-266` |
| §7 权限 | 需大改 | `core/src/permission.ts:103`，仍是 ask/assert/reply；新增 `permission/saved.ts`（持久化的 always 规则）和 `managed-policy.ts`；拒绝以 defect 抛出，在 `model-request.ts:392` 还原成 failure；`QuestionV2` 改为 `Form`（`form.ts`）配合 question 插件 |
| §9 压缩 | 需重写 | 去掉了 `TurnTransitionError`；`SessionCompaction.compact`（`compaction.ts:62`）返回 skipped/completed/failed，触发原因有 auto/overflow/manual 三种；新增 provider 原生压缩（`provider-context.ts`，按 provenance 校验） |
| §10 事件与持久化 | 需大改 | `EventV2` 改为 `bus.ts`（publish/publishAll/project/log/replay），表是 event 和 event_sequence；`projector.ts` 和 `message-updater.ts` 还在；事件清单在 `schema/src/session-event.ts:660`；推送改为 `sessions.log` 回放加 follow |
| §11 装配 | 基本可用，名字要换 | `LayerNode`（`util/src/effect/layer-node.ts`）、`makeGlobalNode`/`makeLocationNode` 还在；新增 `Instance.provide`；`LocationServiceMap` 缩到只负责 reload |

旧文章里在 v2 上已经不存在的名字：`promoteSteers`、`runTurnAttempt`、`PermissionV2`、`ToolOutputStore`、`SessionContextEpoch`、`TurnTransitionError`、`@opencode-ai/llm`、`lildax`、`schema/src/session-input.ts`。

### 2.4 v2 新增、旧文章完全没覆盖的内容（按重要性）

1. 插件化内核：配置、工具、provider、agent 都是插件（`plugin/internal.ts`、`supervisor.ts`、`hooks.ts`），请求各环节都有 hook。
2. 崩溃恢复：写前 claim、`SessionRestart`（`session/execution/restart.ts`）、有上限的续跑次数、`settleStaleToolCalls`（`runner/llm.ts` 约第 329 行）清理残留工具调用。
3. Code Mode：`packages/codemode` 自带 JS 解释器，`core/src/codemode/tool.ts` 暴露一个 `execute` 工具，让模型写脚本批量调用工具。
4. subagent 与后台 Job：`job.ts`、`session/subagent-job.ts`、`tool/plugin/subagent.ts`、`session.background`。
5. 会话迁移（move）与 workspace：`session/move.ts`、`workspace/driver.ts`。
6. 指令增量系统 `InstructionState`。
7. v1 迁移：`database/v1-migration.bun.ts`（约 1135 行）、`cli/src/config/migrate.ts`。
8. WebSocket 模型传输、shell/pty 持久化、revert/fork。
9. provider policy 与组织托管策略。

### 2.5 建议的新文章大纲

1. 包结构与 service 进程模型
2. 一次 prompt 的全流程
3. SessionInbox：steer、queue 与控制项
4. Coordinator 与 SessionExecution：wake、claim、恢复
5. Runner：advanceToStep 与 runStep
6. SessionStep.attempt：流、并发工具、Outcome
7. 上下文组装：SessionContext、InstructionState、ModelRequest
8. packages/ai：统一请求与协议路由
9. 工具与插件：Tool snapshot、ToolOutput、内置插件
10. 权限、Form 与 policy
11. 压缩：摘要压缩与 provider 原生压缩
12. Bus、投影与事件日志
13. Layer 装配：global、Instance、location
14. 扩展能力：Code Mode、subagent/Job、move/workspace
15. 从 v1 迁移

旧文章的处理方式由用户决定：在开头注明"本文基于 6 月的 v2 早期原型"后保留，或用新文章直接替换。

---

### 2.6 进度（2026-10-08）

已按 `origin/v2` 的 `216c311744`（`@opencode/cli` 2.0.24）整篇重写，直接替换了原文件（URL 不变），开头注明了重写原因，旧版在 git 历史里（`a713790` 及之前）。
- 读代码的方式：`git archive origin/v2 packages specs` 导出到临时目录，没有切换用户本地仓库的分支（本地仍在 `dev`）。
- 结构：1 包与进程模型 → 2 整体流程 → 3 收件箱 → 4 调度 → 5 runner → 6 请求组装（指令增量、历史、请求字段）→ 7 attempt → 8 工具 → 9 权限 → 10 压缩 → 11 事件、持久化与恢复 → 12 装配 → 13 Code Mode / 子 agent / 迁移 / 回退 / v1 迁移 → 14 三家对照。13 张 mermaid 图都用 jsdom + mermaid.parse 校验过。
- 发现 `specs/v2/session.md` 写的“最多重试 4 次”和代码（10 次）不一致，文中以代码为准并注明了。

还可以补的：`packages/ai` 的协议路由只在 §6.5 带过；provider policy、WebSocket 传输、workspace / worktree、TUI 都没展开。

## 3. pi-mono：需改写部分章节

对比范围 `7a2647f32a..6f7551516`。影响最大的两个提交：
- `9e05370b2`（09-16，#9548 Mid conversation system messages）：系统提示词和工具改为写进对话记录。
- `466db0fec`（09-21，add canonical session context boundaries）：SessionManager 成为请求上下文的唯一来源。

### 3.1 已过时（L 为文章行号）

1. **L101 / §2.1 消息类型**：`Message` 由三种变为四种，新增 `SystemMessage`（role system，带 sections/toolsAdded/toolsRemoved）。证据：`ai/src/types.ts:515,577`。
2. **L157-166、L383、L1382 systemPrompt**：`AgentContext` 和 `createContextSnapshot()` 不再有 `systemPrompt`（`agent/src/types.ts:471`、`agent.ts:460`）。provider 收到的是 `normalizeContext({messages})` 生成的 `TranscriptContext`（`ai/types.ts:711`）；`agent.state.systemPrompt` 变成只读（`agent/types.ts:385`）。
3. **L280、326、367、413、1267、1360 `shouldStopAfterTurn`**：已删除，换成 `finishTurn`（在 turn_end 之前运行，返回 `{action:"end"|"continue"}`）。新增每次请求前都会运行的 `prepareRequest`（`agent/src/types.ts:260,267`）。runLoop（`agent-loop.ts` 162-330 行）新增 `declareToolChanges`，工具变化以 system 消息写进上下文。见 agent CHANGELOG 0.87.0。
4. **L448-449、594、1159、1218、1248、1292、1305 系统提示词写法**：`_baseSystemPrompt`/`_systemPromptOverride` 已删除，换成 `_baseSystemPromptOptions`/`_runSystemPromptOptions`。`before_agent_start` 改的是 `systemPromptOptions`。提示词变化由 `_preparePromptAndToolLoadout` 生成一条 sections diff 形式的 SystemMessage，插到本次消息最前（`coding-agent/.../agent-session.ts:1410-1424,1746`）。
5. **§3.1、L1149、L1561 上下文来源**：AgentSession 装了 `prepareRequest`，每次请求都用 `sessionManager.buildSessionProjection().messages` 替换上下文（`agent-session.ts:611-634`）。直接给 `agent.state.messages` 赋值不再影响后续请求（coding-agent CHANGELOG 0.87.0 Breaking）。旧会话恢复改为通过 `initialState.messages` 传入（`sdk.ts`）。
6. **L1550、1577、1588 重试/溢出时删除末尾 assistant**：改为 `_omitRecoveryAttempt` 追加一条 `context_edit(target, null)` 条目，原消息保留在记录里，只从模型上下文中剔除（`agent-session.ts:1018-1034`）。
7. **L637、1754 延迟写盘**：条件从"第一条 assistant 出现"改为"出现第一条 user 或 assistant"（`session-manager.ts:1166-1189` 的 `_hasConversation`，`ff72faba2`）。
8. **§2.4 L193-256 条目类型**：新增 `ContextEditEntry` 和 `UsageEntry`（`c596d09d9`），`CompactionEntry` 多了 `systemMessage`，共 11 种（`session-manager.ts:80,91,175,183`）。
9. **§11 L1612-1622 上下文计算**：核心函数改为 `buildSessionProjection`（会应用 context_edit；compaction 投影为 `[systemMessage, summary]`），`buildSessionContext` 只是它的包装（`session-manager.ts:439-594`）；`appendCompaction` 允许 `firstKeptEntryId=null`。
10. **L670、L717-726 扩展事件**：`turn_end` 改走 `emitBoundary`，可以返回 entries 或 continue（`agent-session.ts:1078`）；`pi.on` 现在返回取消订阅函数（`loader.ts:256-270`）；新增事件 `context_with_system`、`provider_stream_event`、`agent_before_settle`、`cache_warming_decision`。
11. **数量类**：内置服务商从 40 家变为 42 家（新增 meta、typesafe；`providers/all.ts`），涉及 L24、866、1016、1057、1076。行数：`agent-loop.ts` 803→898，`agent-session.ts` 3552→4023，`interactive-mode.ts` 6620→6864；harness 约 2.35 万→3.09 万行（新增约 8k 行的 `harness/pico3`）。
12. **L1648**：`experimental/mini/worker/run.ts` 在基线时就已经调用 `AgentHarness.create`，"只有 session-worker 用"原本就不准确；现在又多了 `experimental/micro`（`7e1950768`）。

### 3.2 值得补充

1. 新增一节讲"system 消息写进对话记录 + SessionManager 作为唯一上下文来源"，并同步改 §2、§3.3、§7、§10、§11。
2. **durable 包**（`@earendil-works/pi-durable`）：Pico5 的持久化层，提供事务型 Session、Chord 跟踪的 documents、tasks、conversation forks、checkpoints 和迁移、typed IDs，存储后端有 Memory/JSONL/SQLite 三种；旧的 `harness/pico` 已迁入（`080160162`）。**目前没有接入 coding-agent**，仓库里没有其他包依赖它，coding-agent 仍用 SessionManager + JSONL；`durable/docs/pico-v5.md:269` 写着 "Pico5 is not implemented yet"。放在 §13 或"不足"一节提一下即可。
3. **chord**：仍是独立包，只被 harness/pico3 和 coding-agent 的 experimental 目录使用；新增事务型 replicated state（`10d1ad621`），immutable delta tracker 成为默认实现（`d5cba1d97`）。
4. §10 提示缓存预热：`CacheWarmer`（`core/cache-warmer.ts`）会写 usage 条目；压缩预算可以按模型单独配置。
5. §5 pi-ai 模型分为 chat/image/classifier 三类，ModelRuntime 新增 `generateImages()`、`classify()`。
6. §4.3 扩展细节：`user_bash` 改为出错即拦截；`context` 处理函数看不到 system 消息；jiti 改为首次需要时才加载。
7. §12 RPC：prompt/steer/follow_up 的响应带 `disposition`（`e473b5cd8`）。
8. 构建改用 TypeScript 7，源码可直接用 node 运行（`ca7460d16`），对正文影响很小。
9. 可以补一句：kimi-code 的 `packages/pi-tui` 是从 pi 的 `packages/tui` 拷贝后单独维护的（见 §5）。

### 3.3 仍准确

包名/目录/依赖关系；pi-ai 的协议与服务商拆分（createProvider、lazyApi、compat、BUILTIN_APIS、provider-composer）；工具执行（串行准备、并行执行、length 时整批作废、文件写入队列、截断 2000 行/50KB）；两个队列和 one-at-a-time 模式；压缩判定和默认参数（16384/20000/3 次/2000ms）；harness 的 Lane/Drive/HookRegistry；TUI 渲染与三种运行模式。

---

### 3.4 进度（2026-10-08，对照 `7a2647f32a..1cedd3272`）

§3.1 的 12 条和 §3.2 的大部分已改完，另外处理了 09-28 之后的新变化：
- 新增 §2.5“提示词和工具也写进对话记录”（system 消息、段落补丁、`declareToolChanges`、`resolveTranscript`、`prepareRequest` 从会话投影上下文）。
- §3 核心层：`finishTurn` 取代 `shouldStopAfterTurn`，新增 `prepareRequest`、`runToolCall`；runLoop 伪代码重写。
- §4 产品层：AgentSession 字段与方法、SessionManager（`context_edit`、`usage`、投影、`_hasConversation`）、扩展系统（41 个事件、`pi.on` 返回取消函数、`turn_end` / `agent_before_settle` 边界、`context_with_system`、`user_bash` 出错即拦截、jiti 按需加载）、§4.4 新增工具暴露方式和四个内置扩展（codemode / tool-search / mcp / llama.cpp）。
- §5：42 家服务商（41 家聊天 + typesafe 分类），协议表重算；模型分 chat / image / classifier 三类；Anthropic 模块的中途 system 消息。
- §6–§12：装配顺序、prompt 流程、重试改为 `context_edit`、压缩判定、会话树投影、全屏 TUI、RPC 的 `disposition`。
- §13 整节重写为 `pi-durable`（原 harness 已在 `7fd478a2e` 删除）。
- §14 两张表更新。

没写的：durable 的 chord 细节、`pi-env`、`pi-client` / `pi-server` / `pi-protocol`、虚拟模型路由只提了一句、CacheWarmer 只在 §6 带过。

## 4. codex：逐条修改 + 补充

> **进度（2026-09-28）**：4.1 已全部改完，4.2 中的第 1、3 条已补上（§11 新增"即时打断"小节，§13 改写了恢复流程），第 2 条只改了 `agent_control` 那一行。**还没做的**：4.2 的第 2 条（AgentControl 重构详述）、第 4 条（预热）、第 5 条（扩展钩子）、第 6 条（中途换环境只在 §5 表格里提了一句）、第 7 条（Guardian）、第 8 条（小项）。另外核对时发现 `ResponseEvent` 实际是 17 种（下文写的 16 有误，文章已改为 17）。

对比范围 `40eeb6e8a8..1cc7e23612`。标"基线前"的条目在写文章时就已经不对，不是这批提交造成的。

### 4.1 已过时

1. **L14、L90 TUI 连进程内 app-server**：现在 TUI 默认连共享的本地后台 app-server daemon。`features/src/lib.rs` 约第 944 行，`DaemonAutoStart` 为 Stable 且 `default_enabled: true`（`75ec81c862`，#47179）；另见 `tui/src/startup_orchestration.rs:494`，`tui/src/lib.rs:312`（`AppServerTarget::{Embedded, LocalDaemon, Remote}`）。只有 `--no-daemon`、`--oss` 等情况才回退为进程内。`codex exec` 仍是 `InProcessAppServerClient`，没变。
2. **L160-162 ThreadManager 方法表**：三个方法改名（`12cb14f7b7`，#47900）：`resume_thread_from_rollout`→`resume_legacy_thread_from_rollout`，`fork_thread`→`fork_legacy_thread`，`spawn_subagent`→`spawn_legacy_subagent`（`core/src/thread_manager.rs:1162,1202,1434`）。调用方也写错了（基线前）：app-server 的 `thread/resume` 调 `resume_thread_with_history`，`thread/fork` 调 `fork_prepared_thread`/`fork_thread_from_history`（`app-server/src/request_processors/thread_processor.rs:2289,5186`）；子 agent 的调用方是 `ext/agent/src/lib.rs:70`（AgentRunner），不是 `spawn_agent` 工具。
3. **L2234 及 §13 恢复与投影**：`LocalThreadStore` 默认历史模式由 Legacy 改为 Paginated（`thread-store/src/local/mod.rs:475`，#47900），本地新线程默认会写 SQLite 投影。恢复走 `thread_store.load_latest_model_context`，反向扫描到最新的 `Compacted`，只取它和之后的记录（`thread-store/src/local/model_context.rs:27-34`）。
4. **L685、L689、L741、L761-765 TurnContext 与 capture**：`current_settings` 改为 `next_step_settings: ArcSwap`；`environments` 改名为 `initial_environments`，step 的环境从 `services.turn_environments.snapshot()` 读取（`core/src/session/turn_context.rs:321-336`，`370cd7cba8` #47435）。AGENTS.md 刷新改为和 capability/MCP/工具准备并行（`core/src/session/mod.rs:3838-3935`，`0a2eb4696c` #47458）。`StepContext` 新增 `preempt`、`realtime`（`core/src/session/step_context.rs:24-26`）。
5. **L943 推荐插件是 contextual user 消息**：已改为 developer 角色，并入主 developer 消息（`9124e23e2c`，#47349）。
6. **L1072-1078、L1105 CodexHarnessMetadata "五个字段"**：基线时已有 8 个，现在是 13 个（`history/src/lib.rs`），新增 guardian_sources、retained_source、compaction_output、mcp_attribution 等。
7. **L480、L852、L989、L998 Op::ThreadRollback**：基线前就已删除（`3052bbcf8c`，#44915）。`drop_last_n_user_turns` 现在只用于重放 rollout 里的历史回滚标记（`core/src/context_manager/history.rs:731-742`），§6 用"回滚"做例子已经没有实时入口。
8. **L463-485 Op 列表**：新增 `InterruptIfNoPendingInput`（`04fc75adbe` #47340）；`ThreadSettings` 新增可选 `reply`（`fbd0c0d96c` #47937）；`Submission` 从 protocol 移到 `core/src/session/submission.rs`，新增 `residency_guard`（`acc20df49f` #47240）。
9. **L1433、L1472 工具分发函数名**：`dispatch_*_with_terminal_outcome` 改为 `dispatch_tool_call_with_state`（`core/src/tools/router.rs:327`）和 `dispatch_any_with_state`（`core/src/tools/registry.rs:527`）（#47039，基线前）。
10. **L220 SessionServices.agent_control**：类型改为 `Arc<dyn AgentControl>` trait 对象，新增 `local_agent_runtime`（`core/src/state/service.rs`）；宿主可通过 `ThreadManager::with_agent_control_factory` 注入实现（`fdbe23da45` #47808）。
11. **小项**：行号 `input_queue.rs:213`→250、`tasks/mod.rs:427`→437；`NotSubmittedReason` 实为 10 个（文中写 9）；`EventMsg` 83 个（文中写 90 多）；`ResponseEvent` 16 个（文中写 18）；L444 的 `TurnStartOptions.turn_trigger` 在 steer 时也会记录为 `UserInputOrigin`（`protocol/src/turn_input.rs`）。

### 4.2 值得补充（按重要性）

1. **用户输入抢占正在进行的模型请求**（§8、§11 的 steer 时序）：由 `Feature::InstantInterrupt` 控制，目前开发中、默认关闭（`f92655d07f` #48141，`12de0e395d` #48508，`1bf73324ca`、`55543d8772`）。`watch_user_input` 一收到 steer 就取消 `preempt`，中断请求建立、流读取和重试等待；Responses Lite 会发 `response.interrupt`；Code Mode 也会让出。另有 `DeferMailboxPreemption`（#47913）。
2. **多 agent 的 AgentControl 重构**（§2、§11）：`LocalAgentControl`/`LocalAgentRuntime`、`SpawnRequest`、V2 常驻保护，宿主可注入控制器（#47271/#47292/#47520/#47235/#47240）；另有内存版和 HTTP 版 agent message board（#47946/#48100）。
3. **Paginated 历史成为本地默认**（§13）：还有压缩检查点里的 `resume_metadata`（#47323），以及 `PersistContext::ThreadPreparation`（#47199）。
4. **预热**（§2）：空闲线程可以调 `CodexThread::prewarm`/`prewarm_with_history`（用 `generate:false` 带历史预热，#47701、#48812）；WebSocket 已就绪时跳过（#47745）。
5. **扩展钩子**（§7-§9）：`ModelRequestContributor`/`ModelResponseInterceptor`（#47679），以及工具分发和计时观察（#47662）。
6. **轮次中途可以换执行环境**（§6）：`TurnSettingsUpdate.environments`（#47435）。
7. **Guardian 大改**（§6、§9）：线程上下文默认开启，`ContextManager` 新增 `retained_context`/`review_history`（#47275、#48779 等）。
8. 小项：重试遵守 `Retry-After` 截止时间（#47641）；本地压缩保留用户消息分段（#48115）；MCP 调用归因 `mcp_attribution`（#47081）。

### 4.3 仍准确

turn_input 路由（StartOrSteer/StartIfIdle/Steer）、ActiveTurn/TurnState/TaskKind、start_task 与 on_task_finished 的收尾顺序、两层循环和 needs_follow_up、邮箱投递阶段；for_prompt 整理、build_prompt 字段、run_sampling_request 的重试与传输降级框架；ToolExposure 仍是 6 种、并行门、`default_exec_approval_requirement` 表、exec_command 审批链路；`run_auto_compact` 的三个分支、RolloutItem 类型、持久化调用链、worker 挂起。文章引用的 100 多个函数和类型名，除 4.1 列出的以外都还存在。

---

### 4.4 第二轮（2026-10-08，对照 `1cc7e23612..529cd6b860`，490 个提交）

已改：
- §11 即时打断：`InstantInterrupt` 已默认开启（#51812，阶段仍是 UnderDevelopment）；`CodeModeInterrupt` 改为 Stable、默认开启（#51835）；steer 时序图注明画的是开关关闭时的情况。
- §7 请求组装：请求体删掉了 `instructions` 字段，base instructions 改成 `input` 开头的一条 developer 消息，普通 Responses 和 Lite 的写法统一了（#51156）；补充了开发中、默认关闭的 `incremental_tools`（#50464，只对 Lite 生效）。
- §6/§12/§13 压缩：`InitialContextInjection` 已删除，四个时机的压缩都调用 `build_compaction_replacement_history`，当场重建上下文并设好两套基线（#51117）；锚点只会在新线程和重放回滚标记时为空。
- §11 邮箱：新增 `MessagePhase::PartialAnswer`（#51241/#51249），它不会让邮箱切到 `NextTurn`。
- 其他：StepContext 新增 `extension_data`（#50050）；`SessionConfigured` 去掉了 `initial_messages`；TUI 退回进程内 app-server 的条件多了几种；修正 3 处行号和类图里两个原本就不存在的类型名（`ResponsesEndpoint`、`ToolSpecs`）。

还没做（4.2 遗留项照旧）：AgentControl 重构详述、预热、扩展钩子、Guardian。另外这一轮还有一些新东西没写：world-state 快照随渲染上下文一起持久化、prediction fork、删除只带部分历史的子 agent fork（#51329）、turn lineage。

## 5. kimi-code（暂无文章，供参考）

版本从 0.43 升到 2.1.1。2.0.0 只是因为新增了 `/desktop`（#3849），不是架构变更。

- **结构**：`apps/` 下有 kimi-code（CLI/TUI）、vscode、kimi-inspect、vis。`packages/` 的核心是 `agent-core-v2`（agent/、features/{tower,swarm,skill,goal,cron,plan…}、wire、persistence、mcpCore），周边包有 kosong（LLM 抽象）、kaos（OS 抽象）、kap-server、acp-server、klient、node-sdk、pi-tui、transcript、remote-control、oauth、telemetry、minidb；顶层还有 `plugins/`。
- **近期架构变化**：
  - prompt 队列并入 agent 循环（#3747）：删掉 AgentPromptService，统一走 IAgentLoopService。
  - 持久化重建（#3737）：agent 改为由 session 派生的 actor，引擎改用文件 journal。
  - LLM 层：删掉 llm 状态机（#3710）；ProtocolTrait 拆成按协议划分的 dialect（#3641）。
  - 压缩：尝试次数上限可配置（#3750）；压缩前先把历史裁到模型的有效窗口（#3911）。
  - MCP 延迟披露（#3667）。
  - tower：强制协议不变量，并在 tower 模式下禁用 AgentSwarm（#3976）。
  - swarm：可从持久化事件恢复成员（#3970）。
  - skill 增加 scope（#3843）。
- **与 pi 的关系**：`packages/pi-tui` 是从 `earendil-works/pi.git` 的 `packages/tui` 拷贝后单独维护的（见 `packages/pi-tui/UPSTREAM.md`），#3780 同步到上游 v0.85.1，不走 npm 依赖。
- 这些内容足够单独写一篇源码解析。

---

## 6. 给接手 agent 的注意事项

- 上文结论由子代理核对、主会话抽查得出，关键项已复核过。行号可能因后续提交变化，**动笔前请在源码里再确认一次**。
- 文章风格：中文，章节编号加 mermaid 图，贴关键源码片段并标注路径；修改时保持原文风格一致。
- 修改完成后可以用 `pnpm build`（或项目里对应的脚本）检查 mermaid 和 frontmatter 是否正常。
- 不要把 `/tmp/opencode-v2` 当成持久路径，需要时按 §2.2 的命令重新导出。
