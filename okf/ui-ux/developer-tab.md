---
type: Concept
title: Developer Tab
description: The in-app debug surface — live action log, captured browser console, server log viewer, and copy-for-LLM bundling; the UI's observability story and the future dispatcher-log window.
resource: static/js/developer_tab.js
tags: [status:current, audience:dev, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

Hormiga treats debuggability as a user surface. The Developer tab shows, live:
the **action log** (a ring buffer of user actions recorded by
`static/js/action_log.js`), captured **browser console** output, intercepted
**fetch** calls, and the **server log**. One button copies a formatted bundle
of all of it — built to be handed to an LLM for repair ("copy for LLM"), which
is how this app is actually developed and maintained.

This is the observational half of a command spine: today the action log
*watches* the UI; after Phase 4 ([roadmap](/roadmap.md)) UI actions *are*
dispatcher commands, so this tab becomes the authoritative command history —
readable, replayable, and identical to what the [CLI](/concepts/cli.md)
produces. The "copy for LLM" bundle then contains the exact verb sequence that
led to a problem, not a reconstruction of it.

Design intent worth keeping through the revamp: the debug surface lives
*inside* the app, one tab away, not behind a devtools shortcut — volunteers
report problems by copying one block of text
([principles](/ui-ux/principles.md) #1).
