---
type: Concept
title: Data Manager
description: The CRUD heart of Hormiga — contacts, events, jobs, and organizations with tagging, search, and cross-entity linking; the newsletter is a projection over this data.
resource: templates/app/data_tab.html
tags: [status:current, audience:dev, audience:user, confidence:asserted, foundation]
timestamp: 2026-07-01T00:00:00Z
---

Hormiga manages five entity families — **contacts, events, jobs, organizations,
images** (plus attached resources) — with full CRUD, [tags](/concepts/tags.md),
and cross-entity links (a contact presents an event; an image belongs to an
event; an org posts a job). The [newsletter builder](/concepts/newsletter-builder.md)
does not own data: it *projects* this data into sections.

Data flows through a repository interface (`data/repository.py`) so the backend
is swappable — currently Supabase REST (paused) with Google Sheets as the public
input layer; the [Antfarm](/concepts/antfarm.md) shift replaces this with
protocol nodes (holidays), MeshDB first.

Entity metadata that doesn't fit the tabular backend (presenter roles, event
image links, contact internal notes) lives in meta stores (`data/*_meta.py`).
A contact carries two note fields: a **public bio** (rendered in newsletters)
and **internal notes** (never rendered in any output) — a privacy boundary the
UI enforces, described in [tabs](/ui-ux/tabs.md).

The user surface is the Data tab ([shell](/ui-ux/shell.md)); the coming
[CLI](/concepts/cli.md) exposes the same operations to agents.
