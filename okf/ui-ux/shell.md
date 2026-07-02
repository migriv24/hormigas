---
type: Concept
title: App Shell
description: The Electron shell — splash with update progress, landing page with recent databases, the main tabbed window, and the native menu; the frame every other surface lives in.
resource: electron/main.js
tags: [status:current, audience:dev, audience:user, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

The user's journey into the app, in order:

1. **Splash** (`electron/splash.html`) — animated loading bar, rotating splash
   messages, auto-update check with visible progress. The update happens here,
   before the user has state to lose.
2. **Landing** (`electron/landing.html`) — shown when no database is loaded:
   recent databases (up to 8, one click to reopen), open a
   [.miga file](/concepts/miga-file.md), or create a new database from raw
   keys. Password prompt appears only for protected files.
3. **Main window** — the tabbed app ([tabs](/ui-ux/tabs.md)), served by the
   bundled Flask server and rendered as a normal web page inside Electron.
4. **Native menu** — File: New / Open / Save Database As / Switch Database;
   platform-standard shortcuts.

Mechanics that shape UX: the Python server spawns with dynamic port allocation
(no port-conflict dialogs), the shell polls `/health` before showing the window
(no half-loaded flashes), and quit kills the server process (no zombies). The
renderer bridge (`electron/preload.js`, `window.hormiga`) is the seam where
Phase-4 dispatcher calls will surface to the UI
([roadmap](/roadmap.md)).
