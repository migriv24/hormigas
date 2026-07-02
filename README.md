# Hormiga

**Hormiga** is a bilingual data management and publishing tool built for small community organizations. It manages contacts, events, jobs, organizations, and images — and assembles them into formatted bilingual newsletters.

The name is Spanish for "ant" — small, organized, and built for collaborative work.

> **Status: v1.4.11 — active development.** The architecture is undergoing a major shift (see [The Antfarm](#the-antfarm)). The app is functional but the primary data backend (Supabase) is being replaced with a protocol-agnostic, local-first system.

---

## The Antfarm

The central architectural concept going forward. An **Antfarm** is the configuration layer of a Hormiga installation — a visual, node-based editor that defines *how* the app stores, retrieves, and routes data. Think of it like a shader node graph (à la Blender), except instead of passing float values between nodes, you are passing **protocols**: live API connections, storage backends, and service interfaces.

### Why this exists

The original design relied on Supabase (cloud SQL) + ImgBB (cloud images) + Google Sheets (public data input). This worked fine until it didn't — a paused free tier broke the entire app. The Antfarm solves this structurally: **no single node should be able to take the whole system down.** Every backend is swappable. Local alternatives exist for everything.

### How it works

```
┌─────────────────────────────────────────────────────┐
│                   ANTFARM EDITOR                     │
│                                                      │
│   [SQLite node] ──┐                                 │
│   [Supabase node] ─┤─► [Hormiga Core node] ─►  App  │
│                    │                                  │
│   [Local FS node] ─┤─► image/resource storage        │
│   [ImgBB node] ───┘                                  │
│                                                      │
│   [Google Sheets node] ◄── output protocol           │
└─────────────────────────────────────────────────────┘
```

The **Hormiga Core node** is the consumer. It has typed input slots:
- `sql` — one SQL protocol (contacts, events, orgs, jobs, etc.)
- `image_storage` — one image storage protocol
- `resource_storage` — one resource/file storage protocol
- `outputs[]` — zero or more output protocols (Google Sheets sync, newsletter export, etc.)

Each protocol node encapsulates a backend: its connection details, API keys, and the set of operations it supports. Nodes with compatible types can be swapped without touching any other part of the app.

### Planned node types

| Category | Node | Local | Notes |
|---|---|---|---|
| SQL | SQLite | ✓ default | Zero-config, file-based, ships with Python |
| SQL | Supabase | cloud | Existing implementation |
| SQL | PostgreSQL | ✓ server | For multi-device setups with a local server |
| Image storage | Local FS | ✓ default | Stored in user data dir, served by Flask |
| Image storage | ImgBB | cloud | Existing implementation |
| Resource storage | Local FS | ✓ default | PDFs, DOCX files |
| Output | Google Sheets | cloud | Public-facing data sync |
| Output | Newsletter HTML | local | Email rendering pipeline |

### The pipeline

```
Antfarm Editor  →  defines protocols
      ↓
Data Manager    →  reads/writes through configured protocols
      ↓
Newsletter Builder  →  assembles + renders output
```

These are three distinct user-facing contexts, currently all in one Electron window (as tabs). Long-term, the Antfarm editor is its own window. For now: it lives in the **Connections tab**, which will be expanded into the full node editor.

---

## The .miga File

A `.miga` file is the **save file for an Antfarm configuration**. It is an encrypted, shareable bundle containing:

- The full node topology (which nodes exist, how they are connected, their configurations)
- API keys and credentials for each node
- Admin settings (who can modify the topology)
- App preferences

### How sharing works

1. An **admin** sets up the Antfarm — picks backends, enters API keys, defines connections
2. Admin exports a `.miga` file (encrypted with a password)
3. Team members load the `.miga` — they get a fully configured Hormiga instance
4. Non-admin users cannot modify the node topology; they just use the app

This is the multi-user story. There is no central server to maintain. The `.miga` file IS the shared configuration.

### Role system (planned)

| Role | Can do |
|---|---|
| Admin | Edit Antfarm topology, add/remove nodes, change API keys, export .miga |
| User | Use the app (Data Manager, Newsletter Builder) — topology is read-only |

---

## Current State (v1.4.11)

### What works
- Electron desktop app (Windows / macOS / Linux) with auto-updater
- Python/Flask backend, bundled as a binary via PyInstaller for distribution
- Full CRUD for contacts, events, jobs, organizations, images, and resources
- Newsletter builder: section-based bilingual email composition (EN/ES)
- Bilingual rendering with Google Translate integration
- Image library with tag filtering, language pairing, event linking
- Attached resources (PDFs, DOCX) with page-preview graphic generation
- Connections graph: visual network of contacts, orgs, events
- Developer tab: live action log, browser console capture, server log viewer, copy-to-clipboard for LLM debugging
- `.miga` credential file system (v1 — stores Supabase + Google credentials)
- Auto-update via GitHub Releases (`npm run bump:patch` / `bump:minor`)

### What is broken / in progress
- **Primary data backend (Supabase) is paused** — contacts, events, orgs, jobs all return 503. This is the immediate trigger for the Antfarm shift.
- Data recovery from paused Supabase instance needed before the 89-day window
- SQLite local backend not yet implemented (next major task)
- Antfarm editor UI not yet built (Connections tab is a placeholder graph view)
- `.miga` v2 format (node topology) not yet designed

### Immediate next steps
1. **Recover Supabase data** — resume project, `pg_dump`, store locally
2. **Implement SQLite backend** — `SQLiteRepository` as drop-in for `SupabaseRestRepository`
3. **Implement local file storage** — `LocalStorageBackend` for images and resources
4. **Wire up backend selection** — extend `.miga` / Settings to choose between backends
5. **Antfarm editor v0** — card-based UI in Connections tab showing node topology
6. **Antfarm editor v1** — full canvas node editor in its own window

---

## Architecture

```
hormiga/
├── app.py                      # Flask entry point, all API routes
├── electron/                   # Electron shell
│   ├── main.js                 # Main process (windows, updater, server lifecycle)
│   ├── preload.js              # Renderer bridge (contextBridge → window.hormiga)
│   ├── splash.html             # Loading screen with update progress
│   └── landing.html            # First-launch / open-database screen
├── core/
│   ├── settings.py             # Loads .miga config, validates required fields
│   ├── exceptions.py           # AppError, SheetError hierarchy
│   ├── logger.py               # Structured logging
│   └── event_bus.py            # Python-side event bus (for server-sent events)
├── data/
│   ├── repository.py           # BaseRepository interface (the SQL abstraction layer)
│   ├── supabase_repository.py  # Supabase REST implementation (current default)
│   ├── [sqlite_repository.py]  # SQLite implementation (planned)
│   ├── image_store.py          # Image CRUD + linking
│   ├── resource_store.py       # Resource (PDF/file) CRUD
│   ├── tags_store.py           # Global tag registry
│   ├── graph_store.py          # Connections graph
│   └── db/                     # Cloud/JSON store layer (json_store table)
├── services/
│   ├── storage/
│   │   ├── base_storage.py     # BaseStorage interface (image/resource backends)
│   │   └── local_storage.py    # Local filesystem implementation
│   ├── newsletter_service.py   # Section rendering + translation
│   └── resource_service.py     # PDF processing + preview generation
├── schemas/                    # Dataclass schemas (Contact, Event, etc.)
├── templates/app/              # Jinja2 tab templates
└── static/js/                  # One JS module per UI concern (no bundler)
    ├── event_bus.js            # Pub/sub (EventBus.emit / .on / .onAny)
    ├── action_log.js           # Ring-buffer action recorder (dev tooling)
    ├── developer_tab.js        # Live logs, copy-for-LLM, fetch interceptor
    ├── connections_tab.js      # Graph view → will become Antfarm editor
    └── ...                     # data_tab, builder, images, resources, etc.
```

### Key design principles

- **Protocol-agnostic backends** — `BaseRepository` (SQL) and `BaseStorage` (files) are the only interfaces the app code touches. Swap the implementation in the node config; nothing else changes.
- **No bundler** — plain HTML/CSS/JS served by Flask. Scripts loaded in order in `layout.html`. Minimal surface area, easy to read and modify.
- **EventBus** — all inter-module communication goes through `EventBus.emit/on`. No direct coupling between tab modules.
- **`.miga` as the unit of deployment** — one file configures an entire installation for a team.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 31, electron-builder, electron-updater |
| Backend | Python 3.11, Flask, PyInstaller (for distribution) |
| SQL (current) | Supabase REST API |
| SQL (target) | SQLite (local default) |
| Image hosting (current) | ImgBB API |
| Image hosting (target) | Local filesystem (default), ImgBB (optional node) |
| Data input | Google Sheets (via gspread) |
| Translation | Google Cloud Translation API |
| Frontend | Vanilla HTML/CSS/JS (no framework, no bundler) |
| Templating | Jinja2 |

---

## Release Process

Releases are version-tag driven. The CI (`.github/workflows/release.yml`) builds Python binaries + Electron installers for Windows, macOS, and Linux, then publishes them as GitHub Releases on this repo (`migriv24/hormigas`). The auto-updater feeds from the same releases.

```bash
# Bump patch version (1.4.10 → 1.4.11), tag, and push — CI does the rest
npm run bump:patch

# Or for a minor version bump
npm run bump:minor
```

No manual version editing. `npm version` handles `package.json` + git tag atomically.

---

## Built with Claude Code

Development is done in close collaboration with **[Claude Code](https://claude.ai/code)**. Architecture decisions, feature implementation, debugging, and iterative design all happen through an ongoing AI-assisted workflow using Claude Sonnet.

---

## License

[MIT](LICENSE) — same license as [Void Core](https://github.com/migriv24/void-core),
the engine Hormiga is converging onto (see `VOIDCORE_INTEGRATION.md`).
