---
title: "Daily 09-11: codex moves the folder trust check later"
description: "Resume or fork can switch the working directory, so the old trust check asked too early. codex now checks after the destination is known, and covers the entry points it had missed."
publishDate: "2026-09-13"
tags: ["codex", "权限"]
series: agents
---

Two codex commits today:

- [84e7d4a1fe](https://github.com/openai/codex/commit/84e7d4a1fe) Check folder trust after resolving the startup destination (#44746)
- [02a8f038b8](https://github.com/openai/codex/commit/02a8f038b8) Check folder consent before creating or resuming TUI tasks (#44755)

## What changed

Both commits fix the same problem: **the question "do you trust this folder?" was being asked too early.**

The old flow checked the current directory's trust status as soon as the TUI started, and only then showed the resume / fork picker. The catch is that resuming an old session can switch the working directory to somewhere else, and that somewhere else was never asked about.

The first commit moves the check to after the destination is known. In `lib.rs`, the spot that used to compute `should_show_trust_screen_flag` is now hard-coded to `false`, with a comment: "Folder consent runs after the picker resolves the actual destination". The real check moves into a new file, `onboarding/directory_trust.rs`, in a function called `check_directory_trust`.

The function is worth a look:

- It takes two directories: the current `cwd`, and the `cwd` recorded on the thread being resumed. When they differ and the target is a local daemon, both get checked.
- Both go into a `VecDeque`, and the loop checks them one at a time, using `checked_cwds` to skip duplicates.
- When connected to an app server, trust status is read from the server via `read_remote_project_trust`, with one host type for local and one for remote. In embedded mode, if the config already says `Trusted` it skips; otherwise it resolves the trust target from the git root.

The second commit applies the same check to the other entry points: dispatching a task from Agent Command Center, resuming a session, and opening an already-loaded task. Cancelling the consent screen returns you to Command Center and restores the draft in the composer. It also adds a 236-line terminal integration test, `tests/suite/directory_trust.rs`, covering unknown folders, untrusted folders, cancel-then-retry, and a resumed session whose directory has changed.

## How it relates to the series

The [permissions and sandbox comparison](/posts/agents-permissions-sandbox/) (Chinese) made the point that application-level permission is **a confirmation mechanism for humans**, not a security boundary. Folder trust is the earliest gate in that layer, earlier than tool-call approval: it decides whether to load the folder's config and hooks at all.

This change is a good example of a common weakness in that layer: there is one gate, but **more than one way in**. Startup, resume, fork, dispatch from Command Center: every path has to go through the same gate, and missing one is the same as having none. That is exactly what codex patched here.
