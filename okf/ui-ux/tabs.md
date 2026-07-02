---
type: Concept
title: The Tab Model
description: One window, nine contexts — Data, Newsletter, Images, Resources, Jobs, Orgs, Connections, Settings, Developer (+ Help); each tab is one JS module and one template, communicating only via the event bus.
resource: templates/app/layout.html
tags: [status:current, audience:dev, audience:user, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

The main window is a single-page app with a persistent tab bar. Each tab is one
Jinja template (`templates/app/*_tab.html`) plus one JS module
(`static/js/*_tab.js`), loaded in order with **no bundler** — deliberately
boring, readable, modifiable. Tabs never call each other; all cross-tab
communication rides the event bus (`static/js/event_bus.js`).

| Tab | Purpose |
|---|---|
| Data | [Data Manager](/concepts/data-manager.md): contacts/events CRUD, tagging, search |
| Newsletter | the [builder](/ui-ux/builder-ux.md): sections, preview, export |
| Images | library with tag filtering, EN/ES pairing, event linking, bulk upload |
| Resources | attached files (PDF/DOCX) with page-preview graphic generation |
| Jobs / Orgs | job postings and organization records |
| Connections | the [graph view](/concepts/connections-graph.md); future Antfarm editor |
| Settings | profile, app config, [.miga](/concepts/miga-file.md) export, themes |
| Developer | the [debug surface](/ui-ux/developer-tab.md) |
| Help | in-app documentation |

Privacy in the layout: the contact form visually separates **Public Bio**
(rendered in newsletters) from **Internal Notes** (never rendered anywhere) —
principle 5 of [UX principles](/ui-ux/principles.md).

Phase 4 converges every tab's actions onto dispatcher verbs; the tab *shape*
survives the revamp even if the rendering stack changes.
