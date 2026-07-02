---
type: Concept
title: Connections Graph
description: The visual network of contacts, organizations, and events — evidence that Hormiga's data is graph-shaped, and the future home of the Antfarm editor.
resource: static/js/connections_tab.js
tags: [status:current, audience:dev, audience:user, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

The Connections tab renders contacts, orgs, and events as a force-directed
network with typed edges (presents, belongs-to, attends), backed by
`data/graph_store.py`. It exists because the org's *relationships* are the
data users actually reason about — who is connected to whom through what.

Two forward-looking roles:
- It is the standing argument that Hormiga's data is **graph-shaped**, which
  drove choosing a graph database (MeshDB, tags-as-edges) as the primary data
  holiday in the [convergence](/concepts/voidcore-convergence.md).
- Its tab is the planned home of the **Antfarm editor** — the
  [Antfarm](/concepts/antfarm.md)'s node-topology view will grow here (v0: a
  card list of holidays with live status) before moving to its own window.
