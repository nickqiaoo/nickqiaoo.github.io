---
title: "kimi-code 源码解析"
description: ""
publishDate: "2026-10-08"
tags: ["kimi", "agent"]
series: agents
seriesOrder: 4
---

> 对照的是 MoonshotAI/kimi-code 的 `21406fb4c`（2026-09-30，应用版本 2.1.1）。源码路径省略前缀 `packages/agent-core-v2/src/`，比如 `agent/loop/loopService.ts` 指 `packages/agent-core-v2/src/agent/loop/loopService.ts`。
>
> 这个仓库有两个读代码时要先知道的特点。第一，`agent-core-v2`、`kap-server`、`transcript` 三个包**一行注释都不许有**，连 JSDoc 也不行，由 `scripts/check-no-comments.mjs` 在 lint 里强制。设计说明只在 `packages/agent-core-v2/docs/zh/` 下：`llm.md` 讲 LLM 请求库的设计原则，`event-name.md` 讲状态机里状态、事件的命名规范。第二，重构非常频繁，一天合好几个结构性 PR 是常事，所以下文只引文件和函数名，不引行号。

## 1. 包结构

```mermaid
flowchart TD
  CLI["apps/kimi-code<br/>CLI / TUI / 打印模式"]
  KAP["kap-server<br/>REST + WebSocket"]
  ACP["acp-server<br/>编辑器协议 ACP"]
  KL["klient<br/>按服务名调用引擎的门面"]
  SDK["node-sdk<br/>公共 SDK"]
  CORE["agent-core-v2<br/>唯一的引擎"]
  HUMAN["src/human<br/>通用状态机引擎 + LLM 请求库"]
  CLI --> CORE
  CLI --> KAP
  KAP --> CORE
  ACP --> KL
  ACP --> CORE
  KL --> CORE
  SDK --> KL
  CORE --> HUMAN
```

| 包 | 行数（不含测试） | 干什么 |
|---|---|---|
| `agent-core-v2` | 约 13.8 万 | 唯一的引擎，本文几乎全部内容 |
| `kap-server` | 约 3.1 万 | 把会话暴露成 REST（`/api/v1`）和 WebSocket |
| `klient` | 约 5900 | 按“服务名 + 方法名”调用引擎的门面，`memory` 传输在同进程里直接拿服务实例，`ipc` 传输跨进程 |
| `acp-server` | 约 5600 | 编辑器用的 Agent Client Protocol |
| `node-sdk` | 约 1.1 万 | 公共 TypeScript SDK |
| `pi-tui` | 约 1.9 万 | 终端界面库，从 pi-mono 的 `packages/tui` 拷过来单独维护（见包里的 `UPSTREAM.md`） |
| `minidb` | 约 1.9 万 | 纯 Node 的嵌入式 KV 数据库，给会话索引和搜索用 |
| `tree-sitter-bash` | 约 5000 | 纯 TypeScript 的 bash 解析器，权限判断危险命令时用 |
| `kosong` / `kaos` | | 早期的 LLM 抽象层和执行环境抽象层，引擎已经不依赖 `kosong` |

`apps/` 下除了 `kimi-code`，还有 VS Code 插件、`kimi-inspect`（调试工具）和 `vis`（可视化）。

`agent-core-v2/src` 的一级目录：

| 目录 | 行数 | 放什么 |
|---|---|---|
| `agent/` | 约 3.5 万 | Agent 作用域的服务：循环、请求、上下文、工具执行、权限、压缩、任务…… |
| `app/` | 约 2.4 万 | App 作用域的服务：配置、事件总线、认证、MCP 注册、会话索引、遥测 |
| `features/` | 约 2 万 | 可插拔功能：`plan`、`goal`、`cron`、`swarm`、`tower`、`reminder`、`externalHooks`、`skill` |
| `human/` | 约 1.9 万 | **通用引擎**：几台 XState 状态机、事件存储、一个 7700 行的 LLM 请求库 |
| `_base/` | 约 1 万 | 依赖注入内核、生命周期、事件、日志 |
| `workspace/` / `session/` | 约 6900 / 5900 | 工作区和会话级别的服务 |
| `wire/` / `state/` | 约 1500 / 1500 | 持久化文件 `wire.jsonl` 的读写，和事件派发器 |

读这个仓库的关键，是分清两个世界：

- `human/` 是一套**不认识 kimi** 的通用引擎：没有依赖注入、没有工作区、没有权限模式，能脱离 kimi 单独测试。
- `agent/`、`session/`、`features/` 是 kimi 的业务服务。

两个世界之间只有三个接缝，后面会一个个讲到：会话服务创建 agent 时传入的 `scopeFactory`（§3），每次开新一轮之前的 **prompt 闸门**（§5），每次发模型请求之前的**步闸门**（§6）。

---

## 2. 服务装配：VS Code 风格的依赖注入

### 2.1 基础用法

kimi 的依赖注入内核在 `_base/di/`（5200 多行），用法和 VS Code 源码一样：

```ts
// 声明一个服务标识
export const IAgentLoopService = createDecorator<IAgentLoopService>('agentLoopService');

// 服务类在构造函数参数上用标识声明依赖
class AgentLoopService {
  constructor(
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @IAgentLLMRequesterService private readonly llmRequester: IAgentLLMRequesterService,
    ...
  ) {}
}
```

`InstantiationService` 根据参数上的装饰器自动 new 出依赖并注入；`ServiceCollection` 存“标识 → 实例或构造描述”；`createChild()` 生成子容器，子容器里找不到的服务往父容器找。

### 2.2 三级作用域

kimi 在这之上加了固定的作用域层级（`app/scopes.ts`）：

```ts
export enum LifecycleScope { App = 'app', Session = 'session', Agent = 'agent' }
export const SCOPE_TOPOLOGY = [LifecycleScope.App, LifecycleScope.Session, LifecycleScope.Agent];
```

| 作用域 | 一份对应什么 | 注册的服务数（`registerScopedService`） | 例子 |
|---|---|---|---|
| App | 整个进程 | 75 | 配置、事件总线、认证、MCP 注册表、会话索引 |
| Session | 一个会话 | 19 | `AgentLifecycleService`（管这个会话里的所有 agent） |
| Agent | 一个 agent（主 agent 和每个子 agent 各一份） | 44 | 循环、请求、上下文、工具执行、权限、压缩 |

服务注册时写明属于哪一级：`registerScopedService(LifecycleScope.Agent, IAgentLoopService, AgentLoopService)`。还可以指定激活方式：`OnScopeCreated`（作用域一建好就实例化）或 `OnDemand`（第一次用到时才实例化）。

新建会话时，`createScopedChildHandle(父容器, LifecycleScope.Session, sessionId, { seeds })` 生成一个会话级子容器；新建 agent 时再往下开 Agent 级子容器。作用域关闭时，里面的服务按创建的逆序释放。

功能（Feature）也走这套机制。比如 plan 模式：

```ts
// features/plan/planFeature.ts
export class PlanFeature extends Feature {
  static override readonly name = 'plan';
  constructor() {
    super();
    this.contributeAgentService(IAgentPlanService, AgentPlanService);
    this.contributeTool(IEnterPlanModeTool, EnterPlanModeTool, { name: 'EnterPlanMode', domain: 'plan' });
    this.contributeTool(IExitPlanModeTool, ExitPlanModeTool, { name: 'ExitPlanMode', domain: 'plan' });
  }
}
registerFeature(PlanFeature);
```

一个功能在 App 层登记一次，每个 Agent 作用域里各自物化一份服务。功能被关掉时，它贡献的服务和订阅一起撤掉。

DI 目录里还有 `cascadeEngine.ts`（约 800 行）和 `fiber.ts`（约 700 行）：前者在运行时增删服务时，按依赖图算出受影响的服务，先逆序拆、再顺序重建；后者提供可撤销的功能单元。

### 2.3 同一个目录复用一套实例：`WorkspaceInstanceManager`

工作区（目录）这一级不是 DI 作用域，而是一个手写的管理器（`workspace/workspaceInstance/workspaceInstanceManagerService.ts`）：

```ts
async getOrCreate(ref: WorkspaceInstanceRef): Promise<WorkspaceInstance> {
  // key 是工作区 id 或根目录
  const existing = this.instances.get(workspace.id);
  if (existing !== undefined) return existing;      // 已经有了就复用
  const pending = this.inflight.get(workspace.id);
  if (pending !== undefined) return pending;        // 正在建就等它，避免同时建两份
  const materialization = this.materialize(workspace)...
}
```

`materialize` 里手动 `new` 一个 `WorkspaceInstance`，把应用级的依赖一个个传进去。同一个目录下的所有会话共用它。新建会话时（`sessionLifecycleService.materializeSession`），工作区级的对象作为种子塞进会话子容器：

```ts
seeds: [
  ...sessionContextSeed(ctx),
  [ISessionSkillCatalogData, this.workspaceSkillCatalog.sessionData()],
  [ISessionInstructionsProvider, this.workspaceInstructions.sessionProvider()],
  [ISessionMcpHandle, this.workspaceMcp.sessionHandle()],
  [ISessionWorkspaceInfo, this.workspaceDirs.sessionInfo()],
  ...
]
```

所以同一个目录的 MCP 连接、技能目录、项目指令只建一份，每个会话拿到的是它的“会话视图”。

和另外几家对比：opencode 把目录直接做成 DI 的一级（`LayerMap` 按目录懒建、自动缓存）；pi 的 chord 只提供“按 key 的服务实例”，由提供者自己决定什么时候建；kimi 则是 DI 管 App / Session / Agent 三级，目录这一级单独写了个管理器。

---

## 3. 引擎：几台嵌套的状态机

kimi 的循环不是一个 while 循环，而是**两台嵌套的 XState 状态机**。XState 是一个状态机库：用 `setup().createMachine()` 定义一张状态图，用 `createActor()` 跑起来，跑起来的实例叫 actor。父 actor 可以 `spawn` 子 actor，子 actor 用 `self._parent.send()` 往父亲发事件。`human/xstate2.ts` 只是对 xstate 库的一层薄包装（不到 50 行），不是自研实现。

### 3.1 四台状态机

```mermaid
classDiagram
  class SessionMachine {
    <<createSessionMachine>>
    agents: Record~agentId, AgentEntry~
  }
  class AgentMachine {
    <<createAgentMachine 父机>>
    queue: UserEntry[]
    notifications: UserEntry[]
    messages: HistoryMessage[]
    turnTools / background
    turnId: number
    paused: boolean
  }
  class TurnMachine {
    <<createTurnMachine 子机>>
    produced: HistoryMessage[]
    pendingToolCalls: ToolCall[]
    outcomes: Record
    step: number
    attempt: number
  }
  class ToolMachine {
    <<createToolMachine>>
    toolCall
    outcome
    result
  }
  class RequestActor {
    <<human/llm/requester 的请求 actor>>
    config
    signal
  }
  SessionMachine "1" *-- "n" AgentMachine : spawn
  AgentMachine *-- TurnMachine : 每进一次 running spawn 一个
  AgentMachine *-- ToolMachine : 按工具调用 spawn
  TurnMachine *-- RequestActor : invoke
```

| 状态机 | 文件 | 一台对应什么 | 管什么 |
|---|---|---|---|
| 会话机 | `human/session/machine.ts` | 一个会话 | 这个会话里所有 agent 的父机：创建、分叉、停止、重启 |
| **父机** | `human/agent/machine.ts` | 一个 agent | 有哪些待办输入、现在要不要开一轮、开了之后怎么中止和清理 |
| **子机** | `human/agent/turn.ts` | 一个“引擎轮次” | 请求模型 → 跑工具 → 收通知 → 再请求，直到模型不再调工具；重试也在这里 |
| 工具机 | `human/tool/machine.ts` | 一个工具调用 | 执行一个工具 |

注意工具机是**父机**启动的，不是子机。子机进入 `acting` 时只是给父机发一个 `turn.spawn_tools`，父机按工具调用逐个 spawn。这样设计是为了让工具能“转后台”：子机结束了，后台工具还能接着跑。

### 3.2 父机

```mermaid
stateDiagram-v2
  [*] --> linking
  linking --> restoring : scopeFactory 完成
  linking --> disposed : scopeFactory 失败
  restoring --> idle : store.ready
  state idle {
    [*] --> ready
    ready --> gating : 有闸门、队列非空、没暂停
    ready --> waiting : 只有后台工具在跑
    gating --> ready : 被拦、闸门报错、队首变了
  }
  idle --> running : 有待办且没暂停，或闸门放行
  state running {
    [*] --> active
    active --> aborting : input.abort
  }
  running --> idle : 子机结束
  idle --> closing : input.close
  running --> closing : input.close
  closing --> disposed
  disposed --> [*]
```

| 状态 | 做什么 |
|---|---|
| `linking` | 调创建时传入的 `scopeFactory` 回调，由 kimi 建好这个 agent 的 DI 作用域，返回事件存储、子机定义、工具机定义、工具列表、prompt 闸门（§4） |
| `restoring` | 等事件存储折叠完历史，合并进状态 |
| `idle.ready` | 依次判断：有 prompt 闸门且队列非空 → `gating`；有待办（通知或队列）→ `running`；只有后台工具在跑 → `waiting` |
| `idle.gating` | 把队首交给 **prompt 闸门**。被拦或闸门报错就丢掉队首回 `ready`；放行就把队首和所有积压的通知一起写进历史，进 `running` |
| `running` | 发 `turn.started`，往事件存储写 `turn.started`，**spawn 一台子机**，输入是当前历史 |
| `running.aborting` | 等子机和工具收尾，默认 10 秒后强停；再收到一次中止就立刻强停 |

**开一轮时，最多只取一个用户 prompt**，但会把积压的所有通知一起带上。

### 3.3 子机

```mermaid
stateDiagram-v2
  [*] --> gating
  gating --> thinking
  thinking --> acting : 回复里有工具调用
  thinking --> done : 回复里没有工具调用
  thinking --> thinking : 有恢复策略，换个办法重来
  thinking --> retrying : 可重试的错误
  thinking --> failed : 不可重试
  retrying --> thinking : 退避时间到
  acting --> draining : 所有工具都有结果
  draining --> gating : 收到父机给的通知
  draining --> done : 已暂停
  thinking --> aborted : 中止
  acting --> aborted : 中止后宽限期到
  done --> [*]
  failed --> [*]
  aborted --> [*]
```

| 状态 | 做什么 |
|---|---|
| `thinking` | `step` 加一，给父机发 `step.started`，调**请求函数**。重试和恢复也会重新进 `thinking`，所以**每次尝试都是一个新的步** |
| `acting` | 给父机发 `turn.spawn_tools`，等所有工具机的结果 |
| `draining` | 给父机发 `turn.drain`，父机把这段时间积压的通知打包发回来（`turn.notify`），子机把它们加进本轮产出，回 `gating` 开下一步 |
| `retrying` | 等退避时间。默认每步最多尝试 10 次，`500ms × 2^i`，封顶 32 秒，加最多 25% 的抖动；服务端给了 `Retry-After` 就用它（`human/llm/requester/retry.ts`） |

可重试的 HTTP 状态码是 408、409、429、500、502、503、504、529；上下文溢出、请求太大、格式错误等不重试，交给上层处理（§9）。

### 3.4 事件存储

父机的历史不是直接改数组，而是先写事件、再“折叠”（从初始状态开始，逐个套用事件处理函数，得到当前状态）。折叠规则在 `human/agent/slices.ts`。实际写进存储的只有三种事件：`message.appended`、`turn.started`、`turn.ended`。

在 kimi 里，这个事件存储的“日志”接的是 agent 的 `wire.jsonl` 文件（§10），记录类型加上 `agent.` 前缀。

---

## 4. 一个 agent 是怎么建起来的

`AgentLifecycleService`（`session/agentLifecycle/agentLifecycleService.ts`，Session 作用域）管一个会话里的所有 agent。它持有会话机，建 agent 的过程是：

```mermaid
sequenceDiagram
  autonumber
  participant C as 调用方
  participant Life as AgentLifecycleService
  participant SM as 会话机
  participant AM as 父机
  participant DI as Agent 作用域容器
  participant Disp as EventDispatcher
  participant LS as AgentLoopService

  C->>Life: create(agentId = main)
  Life->>SM: agent.create
  SM->>AM: spawn 父机，进入 linking
  AM->>Life: 调 scopeFactory
  Life->>DI: createScopedChildHandle：种子有 scopeContext、wire、blob、telemetry
  Life->>DI: wire.seal()
  Life->>Disp: restore()：重放 wire.jsonl
  Life->>DI: 绑定 profile 和权限模式、激活工具
  Life->>LS: buildAttachBundle()
  LS-->>Life: 事件存储、子机定义、工具机定义、工具、prompt 闸门
  Life->>LS: attachEngine(父机)：订阅父机的事件
  Life-->>AM: 返回这些零件
  AM->>AM: 建事件存储 actor，进入 restoring，再进 idle
  Life-->>C: AgentContext
```

`buildAgentScope` 里有一个变量名就叫 `stage`，依次是 `scope` → `seal` → `register` → `restore` → `bootstrap` → `toolActivation` → `attach`，失败时作为遥测字段上报。

关键点是：**每个 agent 的 DI 作用域，是在父机的 `linking` 状态里、通过 kimi 提供的回调建出来的**。所以“agent 活着”和“父机 actor 活着”严格同步，父机进 `closing` 时会拆掉这个作用域。

`createAgentMachine({})` 创建父机时没有传步数上限，引擎自带的步数限制是关闭的，kimi 在步闸门里自己判断（§6.2）。

---

## 5. 适配层：`AgentLoopService`

状态机不认识 kimi 的权限、压缩、钩子。把它们接起来的是 `AgentLoopService`（`agent/loop/loopService.ts`，约 2300 行，Agent 作用域）。它**自己不跑循环**，循环在状态机里；它做三件事：

1. 造好状态机要的零件（请求函数、工具执行器、事件存储、闸门）。
2. 在两个闸门里做 kimi 的判断。
3. 把引擎吐出的事件翻译成 kimi 的上下文消息和界面事件。

```mermaid
classDiagram
  class AgentLoopService {
    hooks: onWillBeginStep / onDidFinishStep / onBeforeSubmitPrompt
    errorHandlers: LoopErrorHandler[]
    promptWaiters: Map
    nudges: Nudge[]
    nudgeCursor: number
    active?: ActiveTurn
    pendingMachineTurn?
    quiescenceDepth: number
    engine: MachineEngine
    +submit(entry, options) id
    +steer(promptIds)
    +notify(note) handle
    +cancel(target)
    +snapshot() / promptHandle(id) / settled()
    +tryAcquireQuiescence()
    +registerLoopErrorHandler(handler)
    -runPromptGate(queueItemId, message)
    -gate(signal) proceed 或 fail
    -projectMachineEvent(event)
    -evaluateSettle(turn, outcome)
    -endTurn(turn, result)
  }
  class ActiveTurn {
    id
    prompt
    controller: AbortController
    steerController: AbortController
    steps
    current?: MachineStepState
    failedStep?
    stopRequested / toolStopRequested
    afterChain: Promise
  }
  class MachineEngine {
    +submit / steer / notify / cancelQueueItem
    +abort / pause / resume
    +resetHistory(history)
    +snapshot()
    +currentStep()
  }
  class AgentPromptChannel {
    <<服务名仍叫 agentPromptService>>
    +submit(payload)
    +submitSteer(payload)
  }
  AgentLoopService *-- ActiveTurn : active
  AgentLoopService --> MachineEngine
  AgentPromptChannel --> AgentLoopService
```

### 5.1 两种“轮次”

kimi 有两种轮次，读代码时要分清：

- **引擎轮次**：父机进一次 `running` 到回 `idle`。
- **kimi 轮次**：`AgentLoopService` 里的 `ActiveTurn`，对外是 `Turn`，界面看到的 `turn.started` / `turn.ended` 就是它。

一个 kimi 轮次可以跨好几个引擎轮次。比如模型最后一步回答时用户插了一句话，引擎会因为有新通知再开一轮，但对用户来说还是同一轮对话。

为什么要自己再造一个轮次？引擎开轮的时刻（父机进 `running`）和 kimi 想开轮的时刻不一致。kimi 开轮时要做很多引擎不懂的事：冻结本轮的模型配置、把用户消息写进上下文、发 `turn.prompt` 和 `turn.started`、分配遥测上下文。所以引擎开轮时，kimi 只记一笔 `pendingMachineTurn`，**真正绑定推迟到第一次步闸门里**（`bindMachineTurn`）。

### 5.2 prompt 闸门

父机在 `idle.gating` 里调用 `runPromptGate`：跑 `onBeforeSubmitPrompt` 钩子（外部 hooks 的 UserPromptSubmit 就挂在这里，可以拦下输入）、把文件引用物化成内容、按服务商调整图片格式。返回“拦下”或“放行（可能改写过消息）”。

### 5.3 输入的四种方式

| 输入 | 入口 | 在引擎里落到哪 | 什么时候被模型看到 |
|---|---|---|---|
| **排队** | `submit(entry)` | 父机的 `queue` | 当前轮结束、父机回 `idle`、闸门放行后，作为新一轮的第一条消息 |
| **插话** | `submit(entry, { steerIfActive: true })` 或 `steer(ids)` | 从 `queue` 挪进 `notifications` | 子机下一次 `draining`；如果当前轮已经没有下一步，就在下一个引擎轮次开头，**仍算同一个 kimi 轮次** |
| **通知（nudge）** | `notify(note)` | 父机的 `notifications` | 同插话。会话空闲时会触发新一轮 |
| **取消** | `cancel(target)` | 排队项：`input.cancel`；当前轮：`input.abort` | |

通知是给系统用的：后台任务完成、cron 到点、goal 功能要求继续……都用 `notify`。每条通知在 kimi 侧有一个带回执的记录（`onConsume` 被用掉时回调、`onDrop` 被作废时回调）。

客户端走的是 `AgentPromptChannel`（`agent/loop/promptChannel.ts`），它是原来的 `PromptService` 删掉后留下的薄门面，服务标识名仍叫 `agentPromptService`，所以 klient、kap-server 的调用方不用改。

---

## 6. 一次 prompt 的完整流程

场景：用户发一句话，模型调一次工具，然后回答。

```mermaid
sequenceDiagram
  autonumber
  participant Client as 客户端
  participant LS as AgentLoopService
  participant AM as 父机
  participant TM as 子机
  participant Req as MachineRequester
  participant LLM as AgentLLMRequesterService
  participant Ctx as 上下文内存

  Client->>LS: submit(entry)
  LS->>AM: input.submit
  AM->>LS: prompt 闸门
  LS-->>AM: 放行
  AM->>AM: 队首写进历史，进入 running
  AM-->>LS: turn.started（记下 pendingMachineTurn）
  AM->>TM: spawn 子机
  TM->>Req: thinking：调请求函数
  Req->>LS: gate(signal)：步闸门
  LS->>LS: bindMachineTurn → beginActiveTurn
  LS->>Ctx: 写入用户消息
  LS->>LS: onWillBeginStep 钩子（注入提醒、检查压缩……）
  LS-->>Req: proceed，步号 1
  Req->>LLM: start({ turnId, step })
  LLM->>Ctx: get()：读上下文
  LLM-->>Req: 流式分片
  Req->>TM: llm.streaming.part → llm.done（有工具调用）
  TM->>AM: turn.spawn_tools
  Note over AM,LS: 工具执行见 §7
  AM->>TM: tool.done
  TM->>AM: turn.drain
  AM->>TM: turn.notify（没有新通知）
  TM->>Req: thinking：第 2 步
  Req->>LS: gate：先等上一步的收尾链 afterChain
  LS-->>Req: proceed，步号 2
  Req->>LLM: start
  LLM-->>Req: 回答，没有工具调用
  TM->>TM: done
  AM-->>LS: 引擎轮次结束
  LS->>LS: evaluateSettle → endTurn
  LS-->>Client: turn.ended
```

### 6.1 请求函数忽略状态机给的消息

这是读 kimi 代码最容易读错的地方。子机调请求函数时，会把 `history + produced`（开轮时的历史加本轮产出）作为消息传过去。但请求函数（`agent/loop/machine/requester.ts` 的 `generate`）是这样的：

1. 先调步闸门 `gate(signal)`。返回 `fail` 就发一个“循环闸门停下了这一步”的错误事件，直接返回。
2. 调 `service.start({ source: { type: 'turn', turnId, step } }, onPart, signal)`。**状态机传进来的 `config` 和 `content` 两个参数完全没用**，请求内容由 `AgentLLMRequesterService` 自己从 kimi 的上下文内存里取。
3. 把结果转成 `llm.streaming.*` 和 `llm.done` 事件发回子机。

所以 **kimi 有两份对话历史**：一份在状态机里，由状态机自己的事件存储折叠出来，只用于状态机内部的判断（工具齐了没、这一轮产出了什么）；另一份是 kimi 的上下文内存，由 `context.*` 持久化事件折叠出来，**真正发给模型的是这一份**。为什么这么设计，见 §11.1。

### 6.2 步闸门：每次发请求前的全部判断

`AgentLoopService.gate()` 在每次请求前被调，**重试也会再过一遍**：

| # | 做什么 |
|---|---|
| 1 | 等上一步的收尾链 `afterChain` 跑完（写 `step.end`、跑 `onDidFinishStep` 钩子） |
| 2 | 有待绑定的引擎轮次就绑定成 kimi 轮次 |
| 3 | 已中止、钩子要求停、上一步失败，任一成立就返回 `fail` |
| 4 | **算出引擎刚刚用掉了几条通知**：`kimi 记的通知总数 − 已处理的游标 − 引擎里还剩的通知数`。把这几条写进上下文内存，回调它们的 `onConsume` |
| 5 | 上一次插话打断过工具，就换一个新的 `steerController` |
| 6 | 工具结果要求停、又没有新通知，返回 `fail` |
| 7 | 算步号：`max(子机的 step, 已过闸门的步数 + 1)` |
| 8 | 配了 `loop_control.max_steps_per_turn`、超过了、且这批通知没有声明“不受步数限制”，就记下超步数错误，返回 `fail` |
| 9 | 跑 `onWillBeginStep` 钩子 |
| 10 | 返回 `proceed` 和步号 |

`onWillBeginStep` 上挂着这些钩子：

| 注册名 | 来自 | 做什么 |
|---|---|---|
| `context-injector` | `features/reminder/reminderService.ts` | 跑所有提醒提供者（日期变化、plan 模式、权限模式、AGENTS.md、todo、goal、后台任务、可加载工具列表等），把结果直接写进上下文内存 |
| `full-compaction` | `agent/fullCompaction/fullCompactionService.ts` | 超过阈值就开始或等待压缩（§9.3） |
| `mcp` | `agent/mcp/mcpService.ts` | 等 MCP 服务器首次加载完，免得第一步看不到 MCP 工具 |
| `toolDedupe` | `agent/toolDedupe/toolDedupeService.ts` | 重复工具调用检测的步边界 |
| `goal-count-turn` | `features/goal/goalService.ts` | goal 功能计数 |

第 4 步是整个适配层最巧妙、也最脆弱的地方：kimi 不从引擎事件里知道“哪条通知被用了”，而是靠两边计数相减。前提是 kimi 发给引擎的通知和自己记的 `nudges` 数组一一对应、顺序一致。

### 6.3 请求体每个字段从哪来

真正拼请求的是 `AgentLLMRequesterService`（`agent/llmRequester/llmRequesterService.ts`，Agent 作用域）：

| 字段 | 来源 | 每步会变吗 |
|---|---|---|
| 模型、服务商 | 本轮第一次请求时算一次（`profile.resolveModelContext()`），存进 `turnConfigs[turnId]` | **本轮内不变**。轮中切模型，下一轮才生效 |
| 请求参数（温度、思考强度等） | 同上，`profile.resolveRequestParams()` | 本轮内不变 |
| 系统提示词 | 同上，`profile.getSystemPrompt()` | 本轮内不变 |
| `max_tokens` | 综合模型最大输出、预留上下文、配置上限、**当前已用 token 数** | **每次重算**。最近的提交（#4091）改成只有显式配置时才传这个上限 |
| 工具列表 | 工具注册表 → `toolSelect.shapeTools()` → 去掉“延迟披露”的工具 | **每次重算**。MCP 工具刚连上、plan 模式刚切换、`select_tools` 刚加载了新工具，下一步就能看到 |
| 消息 | `context.get()` → `toolSelect.shapeHistory()` → 上下文投影 `projector.project()` → 解析媒体 | **每次重算**。上一步写进去的回复、工具结果、刚消费的通知、钩子注入的提醒都在里面 |

“模型配置按轮冻结，工具和消息按步重算”：用户轮中切模型，不会让同一轮前后两步用不同的模型；但工具刚连上，下一步就能用。

**上下文投影**（`agent/contextProjector/projection.ts`）做四件事：跳过还没写完的草稿消息（`partial`）；把工具调用和结果配对，丢掉孤儿结果；没有结果的工具调用补一条“已中断”；丢掉空白消息。还有一个更严格的版本 `projectStrict`，额外去掉重复的工具调用、合并连续的 assistant 消息，出错时换用（§9.1）。

请求发出后，`recordRequest` 发一个持久化的 `llm.request` 事件，记下系统提示词和工具列表的哈希；工具列表第一次出现时再发一个 `llm.tools_snapshot`。

### 6.4 引擎事件怎么翻译成 kimi 的事件

`projectMachineEvent` 是一个大 switch：

| 引擎事件 | kimi 这边做什么 |
|---|---|
| 引擎轮次开始 | 记 `pendingMachineTurn` |
| prompt 被拦、闸门报错 | 被拦的 prompt 也写进上下文（让用户看到自己发了什么），状态记为 blocked / failed |
| 一步开始 | 发 `turn.step.started`，往上下文写 `step.begin` 片段 |
| 流式增量 | 发 `assistant.delta` / `thinking.delta` / `tool.call.delta` 给界面 |
| 一步完成 | 把回复的每个内容片段写成 `content.part`；没有工具调用就直接收尾这一步 |
| 工具开始 | 写 `tool.call` 片段 |
| 工具结束 | 等这一步的工具全部回来，就收尾这一步 |
| 重试 / 恢复 | 用 `step.end(error)` 关掉当前步，发 `turn.step.retrying` |
| 引擎轮次结束 | 把 `evaluateSettle` 接到 `afterChain` 后面 |

**轮次结束的判定**（`evaluateSettle`），按顺序：

| # | 条件 | 结果 |
|---|---|---|
| 1 | 有失败的步、没中止 | 交给错误处理器（§9.2） |
| 2 | 中止了 | `cancelled`，给没回来的工具补“已中止”结果 |
| 3 | 被服务商安全策略拦了 | `failed` |
| 4 | 超步数 | `failed` |
| 5 | 钩子要求停 | `completed` |
| 6 | **还有没用掉的通知** | **什么都不做**。引擎会因为有通知再开一轮，kimi 轮次继续 |
| 7 | 工具结果要求停 | `completed` |
| 8 | 引擎说失败 | `failed` |
| 9 | 其他 | `completed` |

`endTurn` 先等 `wire.jsonl` 写完（`drainPersisted`），再作废本轮范围内没用掉的通知，最后发 `turn.ended`。

`afterChain` 值得单独说一下：它是挂在 `ActiveTurn` 上的一条 promise 链，每一步的收尾工作（写 `step.end`、跑钩子、轮次结束判定）都串在它后面，下一步的步闸门第一件事就是 `await` 它。一条链就消掉了“上一步还没收尾、下一步已经开跑”这一整类竞态。

---

## 7. 工具调用

### 7.1 工具的形状

```mermaid
classDiagram
  class ExecutableTool {
    name
    description
    parameters: JSONSchema
    resolveExecution(input) 执行计划
  }
  class RunnableToolExecution {
    accesses: 要读写哪些路径
    display
    approvalRule
    stopBatchAfterThis
    execute(ctx) 结果
  }
  class ExecutableToolResult {
    output
    isError
    stopTurn
    note
    delivery
    spill
  }
  ExecutableTool ..> RunnableToolExecution : resolveExecution
  RunnableToolExecution ..> ExecutableToolResult : execute
```

工具是**两段式**的（`tool/toolContract.ts`）：先 `resolveExecution(args)` 把参数解析成一个“执行计划”，再对计划调 `execute`。解析阶段就能报错（比如路径越界），不用真跑。执行计划里声明了要读写哪些路径（`accesses`），调度器据此判断能不能并行。

结果里几个特别的字段：`stopTurn` 让这一轮在工具之后结束（plan 模式里用户选“拒绝并退出”就是这样停下的）；`delivery = { kind: 'steer', message }` 表示工具想“以用户身份插一句话”，skill 工具就是这样把技能正文送回对话的；`spill` 是超长结果落盘后的路径，结果超过 5 万字符就落盘，只给模型预览和路径。

### 7.2 攒批

子机的设计是“一个工具调用一台工具机，各跑各的”。但 kimi 的工具执行器必须**整批**看到调用，才能判断冲突、按顺序问权限、处理“前一个要求后面的都跳过”。

`agent/loop/machine/tools.ts` 的 `createMachineTools` 解决这个错位：子机收到 `llm.done` 时，`beginBatch(expectedCalls)` 记下这一批应该有哪些工具调用；每台工具机调 `execute` 时只登记；等这一批全部登记齐了（`flushIfReady`），才一次性交给工具执行器。

```mermaid
sequenceDiagram
  autonumber
  participant AM as 父机
  participant T1 as 工具机 A
  participant T2 as 工具机 B
  participant MT as MachineTools
  participant Exec as AgentToolExecutorService
  participant Sch as ToolScheduler
  participant LS as AgentLoopService

  AM->>T1: spawn A
  AM->>T2: spawn B
  T1->>MT: execute(A)：登记，还没齐
  T2->>MT: execute(B)：齐了，runBatch
  MT->>Exec: execute([A, B])
  Exec->>Exec: 串行准备 A、B：解析、权限、发 tool.call
  Exec->>Sch: add(A 读)、add(B 写)
  Sch->>Sch: 路径不重叠，并行
  Sch-->>Exec: B 先完成
  Exec-->>MT: yield B
  MT->>LS: onToolResult(B)：写 tool.result 片段
  MT-->>T2: 兑现结果
  Sch-->>Exec: A 完成
  Exec-->>MT: yield A
  MT->>LS: onToolResult(A)
  MT-->>T1: 兑现结果
```

### 7.3 工具执行器

`AgentToolExecutorService`（`agent/toolExecutor/toolExecutorService.ts`）对每个调用依次检查：

| # | 阶段 | 可能的结果 |
|---|---|---|
| 1 | 预检：解析参数、查注册表、看是否被禁用 | 找不到或被禁用 → 错误结果 |
| 2 | `resolveExecution(args)` | 抛错 → 错误结果 |
| 3 | 已中止 | “已中止”结果 |
| 4 | `onBeforeExecuteTool` 的所有监听者 | 有人否决（veto）→ 用否决的结果 |
| 5 | `onWillExecuteTool` | 改文件前做快照、等 MCP 加载 |
| 6 | 发 `tool.call`，交给调度器 | |
| 7 | `execution.execute(ctx)` | 抛错 → 错误结果；中止后 2 秒还不返回 → “已中止” |
| 8 | `onDidExecuteTool` 钩子 → 合并 `stopTurn` → 超长截断落盘 | |

准备阶段是**串行**的（权限审批会弹窗，逐个弹比并发弹可控），执行阶段由 `ToolScheduler`（不到 100 行）决定并行度：新任务和“正在跑的”或“排在它前面的”任何任务资源冲突就排队，否则立刻开跑。两个只读不冲突；至少一方要写、且路径重叠才冲突。

`onBeforeExecuteTool` 是一个可否决的事件，挂了很多东西：权限闸门、plan 模式、tower、swarm、goal、外部 hooks、重复调用检测。

### 7.4 权限

`AgentPermissionGate` 订阅 `onBeforeExecuteTool`，调权限策略服务，结果有三种：要问就弹审批等用户回复；批准就放行；拒绝就否决。策略链（`agent/permissionPolicy/permissionPolicyService.ts`）按顺序**第一个给出结论的生效**：

| # | 策略 | 大意 |
|---|---|---|
| 1 | `auto-mode-ask-user-question-deny` | 自动模式下禁止模型向用户提问 |
| 2 | `user-configured-deny` | 用户配置的拒绝规则 |
| 3 | `dangerous-command-ask` | 危险命令要问。用 `tree-sitter-bash` 解析命令，能穿透 `sudo`、`env`、嵌套 shell。非交互模式下不装这一条 |
| 4 | `auto-mode-approve` | 自动模式放行 |
| 5 | `session-approval-history` | 本会话已经批准过的同类操作 |
| 6 | `user-configured-ask` | 用户配置的询问规则 |
| 7 | `user-configured-allow` | 用户配置的允许规则 |
| 8 | `sensitive-file-access-ask` | 读写敏感文件要问 |
| 9 | `git-control-path-access-ask` | 动 `.git` 里的控制文件要问 |
| 10 | `yolo-mode-approve` | yolo 模式放行（解析不了的 bash 命令在 yolo 下也放行，#3869） |
| 11 | `default-tool-approve` | 默认放行的只读工具 |
| 12 | `git-cwd-write-approve` | 在 git 工作区内写文件放行 |
| 13 | `fallback-ask` | 兜底：问 |

### 7.5 插话怎么打断工具

插话到达时，`AgentLoopService` 会 abort 当前轮的 `steerController`，这个信号作为 `steerSignal` 传进每个工具的执行上下文。**工具自己决定理不理它**。目前只有等待后台任务的 `WaitFor` 工具理会（`agent/tools/task/task-wait/taskWaitTool.ts`）：被插话打断时返回一个“等待被中断”的正常结果，这一批工具很快就齐了，子机进 `draining` 把插话带进下一步。最近的提交（#4061）还把它的等待时间上限定成了 90 秒。

---

## 8. 插话的完整时序

场景：模型正在等一个后台任务，用户插一句话。

```mermaid
sequenceDiagram
  autonumber
  participant Client as 客户端
  participant LS as AgentLoopService
  participant AM as 父机
  participant TM as 子机
  participant Tool as WaitFor 工具
  participant Ctx as 上下文内存

  Client->>LS: submit(entry, steerIfActive)
  LS->>AM: input.submit（进 queue）
  LS->>AM: input.steer(id)
  AM->>AM: 从 queue 摘出，合并后放进 notifications
  AM-->>LS: prompt.steered
  LS->>LS: steerController.abort()
  LS->>LS: 记一条通知，发 turn.steer
  Tool-->>Tool: steerSignal 触发，返回“等待被中断”
  Tool-->>TM: tool.done（经父机）
  TM->>AM: turn.drain
  AM->>TM: turn.notify(插话消息)
  TM->>TM: 回 gating，进 thinking
  TM->>LS: 请求函数 → 步闸门
  LS->>LS: 计数相减：引擎用掉了 1 条通知
  LS->>Ctx: 写入插话消息
  LS-->>TM: proceed
  Note over TM,Ctx: 这一步的请求里已经有了插话
```

如果插话到达时模型正在写最后一步的回答（不再调工具），子机会直接 `done`。父机回到 `idle`，因为 `notifications` 不为空，立刻再开一个引擎轮次。kimi 这边，`evaluateSettle` 看到还有没用掉的通知，不结束轮次；新引擎轮次的第一次步闸门里，`bindMachineTurn` 发现已经有活动轮次，直接续上。这两步不会乱序，因为 `evaluateSettle` 挂在 `afterChain` 上，而步闸门第一件事就是等 `afterChain`。

**外部想让 agent 继续干活，都是同一种写法：往上下文写一条消息，再发一个空通知**。比如外部 hooks 的 Stop 钩子要求续跑（`features/externalHooks/agent/agentExternalHooksService.ts`）：把续跑理由作为一条 `origin` 为 `system_trigger/stop_hook` 的用户消息写进上下文，再调一次不带消息的 `loop.notify()`。这条空通知让 `evaluateSettle` 不结束轮次，也让父机再开一个引擎轮次。

---

## 9. 失败处理：五层

| 层 | 在哪 | 触发 | 做什么 | 请求内容变吗 |
|---|---|---|---|---|
| ① 投影降级 | `AgentLLMRequesterService.runRequest` 里的循环 | 请求太大、图片格式错、请求结构错 | 换一种上下文投影立刻重发 | **变**：去图、换严格投影 |
| ② 无限重试 | 同上 | 设了环境变量 `KIMI_CODE_INFINITE_RETRY` | 除中止和上下文溢出外一律退避重发 | 不变 |
| ③ 恢复链 | 子机 | 401 且凭据能刷新 | 刷新凭据，重进 `thinking` | 凭据变 |
| ④ 退避重试 | 子机 `retrying` | 可重试的错误 | 等一会，重进 `thinking` | 不变 |
| ⑤ 错误处理器 | `AgentLoopService` | 引擎轮次失败 | 第一个匹配的处理器接手，它说“续跑”就续跑 | 变，比如压缩后的历史 |

①② 在子机下面，重发时通知子机丢掉已经累积的分片，但不算新的尝试，也不过步闸门。③④ 在子机里，每次都重进 `thinking`，所以**每次重试都是一个新步**：界面上会看到上一步以错误结束、新步开始，`onWillBeginStep` 钩子也会再跑一遍。

### 9.1 投影降级

`nextProjectionPolicyForError`：

| 当前策略 | 错误 | 下一个策略 |
|---|---|---|
| 无 | 请求太大 | 图片降采样 |
| 已降采样 | 请求太大 | 去掉被拒的媒体 |
| 媒体没去除 | 图片格式错误 | 去掉被拒的媒体 |
| 结构没收紧 | 请求结构错误 | 严格投影 |

降级按轮次记住，同一轮后面的请求直接从降级后的策略开始，不用再失败一次。

### 9.2 压缩续跑

最常见的错误处理器是压缩：服务商报上下文溢出时，`AgentFullCompactionService` 开始压缩、等它完成、调 `ctx.retry()`。续跑的方式是：用上下文内存重建引擎的历史（`resetHistory(historyFromContext(context.get()))`），再给引擎发一个空通知，让父机开一个新的引擎轮次。新轮次的步闸门发现已经有活动轮次，直接续上，下一步用的就是压缩后的上下文。

连续 3 次压缩都没压下来就放弃。

### 9.3 压缩

`AgentFullCompactionService` 不在循环里，而是挂在循环的三个扩展点上：

| 扩展点 | 做什么 |
|---|---|
| `onWillBeginStep` | 超过触发线就后台开始压缩；超过阻塞线就等压缩完成再发这一步 |
| `onDidFinishStep` | 清零连续溢出计数，必要时再检查一次 |
| 错误处理器 | 上下文溢出时压缩后续跑（§9.2） |

默认参数（`agent/fullCompaction/strategy.ts`）：

| 项 | 默认 | 说明 |
|---|---|---|
| `triggerRatio` | 0.85 | 请求 token 数 ≥ 窗口 × 0.85 就开始后台压缩，可配置（0.5 到 0.99） |
| `blockRatio` | 0.85 | 超过就阻塞等压缩 |
| `reservedContextSize` | 50000 | 另一条触发条件：用量加预留 ≥ 窗口 |
| `maxOverflowCompactionAttempts` | 3 | 连续因溢出压缩的上限 |
| `maxRecentMessages` / `maxRecentSizeRatio` | 4 / 0.2 | 摘要之后原样保留最近几条消息 |

压缩本身：取当前上下文，加一条压缩指令（`agent/fullCompaction/compaction-instruction.md`），通过同一个请求服务发出去。发压缩请求之前，先估算一下：历史加上压缩指令超过模型有效窗口（扣掉给摘要预留的输出空间）的话，先从前面丢掉一部分（#3911）。压缩请求本身还是溢出，就再砍掉一部分重试；摘要被截断时丢掉最老的一条再试；最多尝试的次数可以配置。成功后检查压缩期间历史有没有被别人改过，改过就放弃。

摘要后面会追加一段 **Context Recovery 脚注**（`agent/fullCompaction/context-recovery-footer.md`）：写明这个 agent 的 `wire.jsonl` 路径、被压缩的行号范围，教模型“需要原始的命令输出、文件内容、错误信息时，去这个日志里查，别猜”。也就是说，压缩丢掉的细节，模型可以自己用读文件工具捞回来。

---

## 10. 持久化与恢复

### 10.1 一个 agent 一个 `wire.jsonl`

每个 agent 有一个只追加的 JSON Lines 文件，路径是数据目录下的 `sessions/<工作区 id>/<会话 id>/agents/<agentId>/wire.jsonl`。

kimi 的业务事件都继承 `Event2`，每个事件类有两个开关：`durable` 为真就写进 `wire.jsonl`、恢复时重放；`observable` 为真就发到事件总线，给界面和服务端订阅。

| 事件 | durable | observable | 作用 |
|---|---|---|---|
| `context.append_message` | ✓ | | 追加一条完整消息（用户输入、提醒、插话） |
| `context.append_loop_event` | ✓ | | 追加一个循环片段，见下 |
| `context.apply_compaction` | ✓ | | 用摘要替换历史 |
| `turn.prompt` / `turn.ended` | ✓ | `turn.ended` 也推 | 这一轮的输入、这一轮的结束 |
| `turn.started` | | ✓ | 界面开一轮 |
| `assistant.delta` 等 | | ✓ | 流式文字 |
| `prompt.submitted` / `prompt.queued` | | ✓ | 只推给界面 |
| `prompt.steered` / `prompt.completed` / `prompt.aborted` | ✓ | ✓ | |

assistant 消息和工具消息不是整条写，而是按**循环片段**写（`agent/contextMemory/loopEventFold.ts`）：

| 片段 | 折叠效果 |
|---|---|
| `step.begin` | 先把上一个草稿收尾，再追加一条带 `partial: true` 的空 assistant 消息当草稿 |
| `content.part` | 往草稿里追加文字或思考片段 |
| `tool.call` | 往草稿里追加一个工具调用，记为“待回填” |
| `tool.result` | 追加一条工具结果消息 |
| `step.end` | 正常结束就收尾草稿，去掉 `partial`；中断或出错就留到下一个 `step.begin` 再收尾 |

两条规则保证历史一致：**工具还没全部回来时，中途到达的普通消息（比如插话）先暂存**，等最后一个结果回来再放出来，保证工具调用和结果在历史里紧挨着；**草稿收尾前一直带着 `partial`**，上下文投影会跳过它，所以进程崩在一步中间，重放出来的半条回复不会发给模型。

同一个 `wire.jsonl` 里还有引擎事件存储写的记录（`agent.message.appended`、`agent.turn.started`、`agent.turn.ended`），以及撤销时写的分支记录 `agent.switched`。

### 10.2 写和读

`EventDispatcherService`（`state/eventDispatcherService.ts`，Agent 作用域）是所有持久化状态的唯一写入口：

1. 对所有关心这个事件的状态，用 immer 算出新状态。
2. 事件是 durable 就 `wire.appendRecord(...)`。
3. 事件是 observable 就发到事件总线。

服务自己的字段里只放持有资源的东西（`AbortController`、promise、actor），纯数据都注册成“状态键”，由事件折叠出来。比如上下文内存 `AgentContextMemoryService` 根本不存数组，`append()` 就是发一个 `context.append_message` 事件。

恢复（`restore()`）时，先重放可撤销的状态（比如上下文内存，沿当前分支），再重放其余状态，然后把外置的图片等大块内容换回来，最后跑 `onDidRestore` 钩子。**重放时不写盘、不发事件总线，所以恢复只重建内存状态，不会重复调模型、执行工具**。

读文件时还有三道保护：没有元数据行就当最老的格式迁移；版本旧就逐条迁移并整文件重写；最后一行被截断（写到一半崩了）就修复，修复失败则之后的写入全部拒绝。

注意：`prompt.submitted` 和 `prompt.queued` 不写盘，引擎的排队也只在内存里。**进程重启后，还没开跑的排队输入会丢**。

### 10.3 撤销：开分支而不是删行

撤销最近几轮（`agent/undo/undoService.ts`）：拿到静默锁（没有活动轮次、没有待办时才能拿到，拿到就暂停引擎）后，追加一条 `agent.switched` 分支记录，整个重放一遍，这次沿新分支走，被撤销的轮次自然不在了；再按新分支重建引擎的存储。**文件从不删行**，撤销掉的内容还在盘上。

---

## 11. 设计取舍

### 11.1 两份历史为什么并存

| | 引擎历史 | kimi 上下文内存 |
|---|---|---|
| 类型 | `{ message, meta }` | 消息上直接挂 `id`、`origin`（12 种来源）、`note` 等 |
| 谁写 | 父机开轮和轮次结束时 | 适配层写 `context.*` 和循环片段 |
| 知道什么 | 消息本身 | 消息来源、草稿、提醒、压缩边界、撤销锚点、外置的图片 |
| **发请求用不用** | **不用** | **用** |

原因是分层：`human/` 要保持“不认识 kimi”，它的历史类型不能带 kimi 的来源、撤销、压缩这些概念；而 kimi 的产品功能又全都依赖这些概念。于是引擎保留自己的历史做内部判断，真正的对话记录交给 kimi。代价是同一段对话在 `wire.jsonl` 里写两遍，错误恢复和撤销之后还要手动对齐两边。

### 11.2 引擎里有、产品层还没用的能力

`human/` 是一个正在往里迁移的内核。下面这些在引擎里实现了、有测试，但 kimi 产品层没有接：

| 引擎能力 | kimi 用什么 |
|---|---|
| 子机的步数上限 | 步闸门里自己判断 |
| 子机的步前回调 | 步闸门里跑 `onWillBeginStep` |
| 父机的 `reminders` 通道 | 提醒服务在步前钩子里直接写上下文 |
| 工具转后台 | 自己的 `IAgentTaskService` |
| `human/compaction/` | `AgentFullCompactionService` |

读 `human/` 时要随时确认“产品层到底用没用”，否则会以为 kimi 的工具能转后台、有子机级的步数上限。

### 11.3 值得借鉴

1. **循环写成状态图**。`MachineEngine.snapshot()` 读父机和子机的当前状态，就能说出“正在等工具 / 正在退避 / 闲着但有后台任务”，排查“为什么卡住了”比 while 循环好查。
2. **两个闸门把产品逻辑挡在引擎外**。权限、压缩、提醒、步数上限、钩子全部挂在闸门后面，引擎保持纯状态机、能独立测试。
3. **`afterChain` 一条 promise 链串起所有收尾**，消掉上一步和下一步之间的竞态。
4. **上下文按片段写盘，草稿带 `partial`**，崩溃恢复后历史仍然一致。
5. **模型配置按轮冻结，工具和消息按步重算**。
6. **失败按离网络的远近分层**，每层只处理自己能处理的。
7. **撤销开分支不删行**，配合 Context Recovery 脚注，模型能自己去日志里查被压缩或撤销的原文。

### 11.4 代价

1. **两份历史**，新人读 `turn.ts` 会以为 `history + produced` 就是发给模型的内容。
2. **通知消费靠计数相减**，任何绕过 `notify()` 直接往引擎塞通知的地方都可能让账对不上。
3. **一次提交要穿过很多层**：`AgentPromptChannel` → `AgentLoopService` → `MachineEngine` → 父机 → prompt 闸门 → 子机 → 请求函数 → 步闸门 → `AgentLLMRequesterService`。
4. **kimi 轮次和引擎轮次不一一对应**，断点里看到的轮次号和界面上的对不上是常态。
5. **重试也算新步**，一次网络抖动可能让 `onWillBeginStep` 钩子跑十遍。
6. **排队中的输入不持久**，重启会丢。
7. **重构频率极高**，一两周前的笔记就可能过时。

---

## 12. 和 pi-mono、opencode、codex 对照

| | kimi-code | pi-mono | opencode v2 | codex |
|---|---|---|---|---|
| 循环形式 | 两台嵌套的 XState 状态机 + 适配层 | `agent-loop.ts` 里的两层 while | runner 的 `drain` 循环 + 数据库收件箱 | `run_turn` 循环 |
| 发给模型的历史从哪来 | 上下文内存（由 `context.*` 事件折叠） | 每次请求从会话 JSONL 重新投影 | 每个 Step 从投影表重读 | 内存里的 `ContextManager` |
| 插话 | 排队项挪进通知，下一次 `draining` 带进去 | steer 队列 | 收件箱 `delivery = steer` | 待处理输入 + 邮箱 |
| 持久化 | 每个 agent 一个 `wire.jsonl`，durable 事件折叠 | 会话 JSONL 树 | SQLite + 事件投影 | rollout JSONL + SQLite |
| 服务装配 | VS Code 风格 DI，App / Session / Agent 三级 | 产品层手工组装；实验中的 chord | Effect Layer，进程级 / 目录级两级 | Rust 结构体手工组装 |
| 撤销 | 开分支，不删行 | 会话树换叶子 | revert：暂存后提交 | 回滚标记 |
