---
title: "每日追踪 09-11：codex 把目录信任检查挪到了目的地确定之后"
description: "resume 或 fork 可能把工作目录切到别处，原来的信任检查问早了。codex 把检查挪到目的地确定之后，并补上了另外几条入口。"
publishDate: "2026-09-13"
tags: ["codex", "权限"]
series: agents
---

今天看的是 codex 的两个 commit：

- [84e7d4a1fe](https://github.com/openai/codex/commit/84e7d4a1fe) Check folder trust after resolving the startup destination (#44746)
- [02a8f038b8](https://github.com/openai/codex/commit/02a8f038b8) Check folder consent before creating or resuming TUI tasks (#44755)


## 改了什么

这两个 commit 解决的是同一个问题：**"你信任这个目录吗"这个问题问早了。**

原来的流程是 TUI 一启动就检查当前目录的信任状态，检查完再进入 resume 或 fork 的选择界面。问题在于 resume 一个旧会话可能把工作目录切到别处，那个"别处"没有被问过。

第一个 commit 把这一步挪到了目的地确定之后。`lib.rs` 里原来算 `should_show_trust_screen_flag` 的位置直接写死成 `false`，加了一句注释："Folder consent runs after the picker resolves the actual destination"。真正的检查挪进新文件 `onboarding/directory_trust.rs` 的 `check_directory_trust` 函数。

这个函数的写法值得看一眼：

- 它收两个目录：当前 `cwd`，以及被 resume 的那个 thread 记录的 `cwd`。两者不同且目标是本地 daemon 时，两个都要查。
- 两个目录塞进一个 `VecDeque`，循环逐个检查，用 `checked_cwds` 去重。
- 连接到 app server 时，信任状态从服务端读，`read_remote_project_trust`，本地和远程各一个 host 类型。嵌入模式下如果配置里已经是 `Trusted` 就跳过，否则按 git 根目录去找信任目标。

第二个 commit 把同样的检查铺到另外几条入口：从 Agent Command Center 派发任务、恢复会话、打开已加载的任务。取消确认时退回 Command Center，并恢复输入框里的草稿。配套加了一个 236 行的终端集成测试 `tests/suite/directory_trust.rs`，覆盖未知目录、不信任目录、取消后重试、resume 后目录变化这几种情况。

## 和横向主题的关系

[权限与沙箱那篇横向对比](/posts/agents-permissions-sandbox/)里说过，应用层权限是**给人用的确认机制**，不是安全边界。目录信任就是这一层里最靠前的一道门，比工具调用审批还早，它决定的是"要不要加载这个目录的配置和 hook"。

这次改动印证了那一层的一个通病：门是统一的，但**入口不止一个**。启动、resume、fork、从 Command Center 派发，每条路都得走同一道门，漏一条就等于没设。codex 这次补的正是漏掉的几条。
