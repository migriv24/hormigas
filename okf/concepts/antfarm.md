---
type: Concept
title: The Antfarm
description: The protocol-node backend topology — every backend (SQL, image host, output) is a swappable node; no single node can take the system down. Equals Void Core's holiday layer.
tags: [status:planned, audience:dev, audience:user, confidence:asserted, foundation]
timestamp: 2026-07-01T00:00:00Z
---

The Antfarm is Hormiga's configuration layer: a node graph where each node
abstracts a backend (database, image host, sheet sync, LLM) and edges are typed
**protocols**. The app consumes protocols, not vendors — swap the node, nothing
else changes. Born from the Supabase pause (see [log](/log.md), 2026-05): a
paused free tier must never again kill the app. Design principle: **resilience
is a graph property** — fallback nodes, local defaults for everything.

Under the [Void Core convergence](/concepts/voidcore-convergence.md) the Antfarm
is not built from scratch: **an Antfarm node is a Void Core holiday**, the
protocol types are the holiday interface, and the
[.miga v2](/concepts/miga-file.md) topology is the holiday registry. First
nodes ([roadmap](/roadmap.md) Phase 2): MeshDB (primary data), local snapshot
(fallback / [offline read](/concepts/offline-first.md)), local FS (assets),
with Supabase/ImgBB/Sheets wrapped as optional cloud nodes.

The editor lives in the [Connections tab](/concepts/connections-graph.md)
first (card list, then canvas). Full narrative: the
[ANTFARM.md reference](/references/antfarm-doc.md).
