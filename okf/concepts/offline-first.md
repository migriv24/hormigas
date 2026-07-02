---
type: Concept
title: Offline-First
description: The app must stay usable without internet — local-first storage, a read-only snapshot fallback, and eventually queued writes with visible conflict resolution.
tags: [status:planned, audience:dev, audience:user, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

A community org's laptop cannot depend on Wi-Fi or a cloud vendor's billing
state. Offline-first is a consequence of the [Antfarm](/concepts/antfarm.md)'s
local-first defaults rather than a separate system:

- **Read (Phase 2 MVP)**: the primary data holiday is local (MeshDB); a
  **snapshot fallback holiday** mirrors every successful session to local JSON,
  so even a failed database spawn degrades to read-only with a visible
  "offline" banner — never a dead app.
- **Write queue + sync** (later): changes queue locally and sync when a shared
  node reconnects. Conflict resolution must live behind an interface with a
  git-like change log so the diff is always computable; the display starts as
  a simple field-level list. Deliberately deferred — the hard problem is
  localized at the holiday boundary, not solved yet.
- **Assets**: cached images so newsletters render offline — needs the local
  asset holiday first.

Prior thinking: [futures](/references/futures-doc.md) §C.
