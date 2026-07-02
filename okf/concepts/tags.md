---
type: Concept
title: Tag System
description: Free-text tags on every entity type — the primary organizational mechanism and the load-bearing feature for agent queries; drift control is planned via Void Core's axis typing.
resource: data/tags_store.py
tags: [status:current, audience:dev, audience:user, confidence:asserted, foundation]
timestamp: 2026-07-01T00:00:00Z
---

Tags are how everything in Hormiga is found: events tagged `month:june`, images
tagged `flier passLane`, jobs filtered into grids. Every entity family accepts
tags; the global registry lives in `data/tags_store.py`. The
[builder](/concepts/newsletter-builder.md)'s data-driven sections resolve **tag
filters** at render time — which is why the tag system is the load-bearing
feature for the [CLI](/concepts/cli.md)'s agent workflows: an agent places a
block carrying a tag query instead of reading the database.

**Known weakness: drift.** Tags are free text, so `may` / `May` / `may2026`
coexist. The fix is planned in two layers (see [roadmap](/roadmap.md) Phase 2):
Void Core's **axis typing** (each namespace maps to a fundamental axis —
`month:` → *when*, `type:` → *what*, `status:` → *state*) and a **temper pass**
that normalizes case/aliases as a registered, idempotent rule. The Tag
Management Panel in [futures](/references/futures-doc.md) §D is the UI over
that engine.
