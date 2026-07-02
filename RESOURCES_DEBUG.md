# Resources Upload — Debug Log

Running list of theories and test results. Most likely → least likely.

---

## Theory 1 — JS cache version param not bumped ✅ IMPLEMENTING FIRST

**What it is:** `resources_tab.js` is loaded in layout.html as `?v=7`. Electron's renderer HTTP cache will serve the **old** version of the file even after the source changes on disk. The new `resources_tab.html` calls `onclick="resOpenUploadDialog()"`, but the old cached JS (v=7) has no such function. Clicking the button produces a silent `ReferenceError: resOpenUploadDialog is not defined`. No toast, no dialog, no feedback.

**How to confirm:** Open DevTools → Console, click Upload, look for `ReferenceError: resOpenUploadDialog is not defined`.

**Fix:** Bump `resources_tab.js?v=7` → `?v=8` in `templates/app/layout.html`.

**Status:** Implementing now.

---

## Theory 2 — User still running v1.4.12 (GitHub Actions build not yet installed)

**What it is:** v1.4.12 has the old `<label for="resourceFileInput">` button paired with the hidden `<input type="file" id="resourceFileInput">`. Our commit removed the `<input>` from the HTML. If the old build is installed, the label click triggers the (now-missing) input — nothing happens.

**How to confirm:** Check app version in Settings or title bar. If it says 1.4.12 or earlier, this is it.

**Fix:** Install the v1.4.13 build from hormiga-releases.

**Status:** Pending user confirmation.

---

## Theory 3 — Electron dialog opens BEHIND the main window

**What it is:** `dialog.showOpenDialog(mainWindow, ...)` with `mainWindow` as the parent argument can, on Windows, sometimes render the native file picker behind the Electron window. The user sees "nothing" because the dialog is hidden. Clicking the app window dismisses the dialog.

**How to confirm:** After clicking Upload, alt-tab or look in the taskbar for a file picker window.

**Fix:** Remove `mainWindow` as the parent arg. `dialog.showOpenDialog(options)` (no parent) opens a standalone system dialog that isn't z-order-trapped by the Electron window.

**Status:** Will implement alongside Theory 1 fix.

---

## Theory 4 — Toast fires but user misses it ("File picker unavailable outside Electron")

**What it is:** If `window.hormiga.showOpenDialog` is undefined (old preload, see Theory 5), the function hits the early return and calls `toast('File picker unavailable outside Electron', 'error')`. The toast is a small 3.5-second notification easy to miss. The user perceives "nothing happened."

**How to confirm:** Open DevTools → Console, click Upload — if nothing appears in the console either, the function isn't even being called (Theory 1). If you see no console output but a toast flashes, it's this theory.

**Fix:** Replace toast-only feedback with a more prominent error for this case.

**Status:** Will add a more visible error fallback.

---

## Theory 5 — preload.js not reloaded (dev mode only)

**What it is:** In Electron dev mode, changing `preload.js` requires a full quit-and-reopen of the Electron process. A page refresh or Flask restart does NOT reload preload scripts. If the dev server was refreshed without restarting Electron, `window.hormiga.showOpenDialog` doesn't exist — falls into Theory 4 territory.

**How to confirm:** Run in dev mode? Fully quit Electron and reopen.

**Fix:** Restart Electron. Only relevant to dev mode — production installs always get fresh preload.

**Status:** User-side check.

---

## Theory 6 — Flask serving old resources_tab.html from template cache

**What it is:** Flask's Jinja2 template rendering is generally live (no cache by default), but if a caching layer or a misconfigured reverse proxy exists, the old HTML with `<label for="resourceFileInput">` could be served while the new JS is loaded. Mixed old-HTML + new-JS or vice versa.

**How to confirm:** Right-click page → View Source, look for whether Upload is a `<label>` or a `<button>`.

**Fix:** Hard refresh (Ctrl+Shift+R) or restart Flask. Should not be an issue in production builds.

**Status:** Low likelihood, easy to rule out with View Source.

---

## Theory 7 — `mainWindow` is null when IPC fires (causes silent exception)

**What it is:** The IPC handler does `dialog.showOpenDialog(mainWindow, ...)`. If `mainWindow` is null (e.g. window was closed and reopened in a code path that doesn't reassign it), this throws `TypeError: mainWindow is null`. The IPC promise rejects, `showOpenDialog` returns `undefined` from the preload bridge, and the renderer gets `null` back — same as "cancelled". No file selected, no form shown.

**How to confirm:** Check main process stdout for `TypeError` when clicking Upload.

**Fix:** Guard against null: `dialog.showOpenDialog(mainWindow || undefined, ...)`.

**Status:** Will add null guard regardless.

---

## Theory 8 — `resources_tab.js` module-level crash kills entire script

**What it is:** Line 8 runs `ActionLog.record('sys', 'resources_tab: script loaded')` at module scope. If `ActionLog` is somehow not yet defined (load order issue, or action_log.js errored), this throws at parse time and the rest of the script never executes — `window.resOpenUploadDialog` is never defined.

**How to confirm:** Layout.html loads action_log.js at line 131, resources_tab.js at line 139 — ordering looks correct. But check DevTools for script load errors.

**Fix:** N/A if load order is correct. Would show up as a red error in DevTools Network tab.

**Status:** Load order verified correct. Low likelihood.

---

## Theory 9 — Flask route `POST /api/resources/from-path` silently fails (wrong route match)

**What it is:** Flask defines `GET/POST /api/resources` and `PATCH /api/resources/<resource_id>`. Our new `POST /api/resources/from-path` sits between them. If Flask matches `from-path` as `resource_id` and routes to the wrong handler, the endpoint returns 405 Method Not Allowed. The button click works and the form shows, but on Submit the upload fails — not the same as "nothing happens" on button click.

**How to confirm:** Only relevant after the dialog opens and user submits. Check Network tab for the POST call.

**Fix:** Move `from-path` route above `<resource_id>` route in app.py (Flask matches in registration order for ambiguous URLs).

**Status:** Separate from the button-not-working symptom, but worth fixing as a precaution.

---

## Theory 10 — Electron contextBridge security policy blocks object arguments

**What it is:** Electron's contextBridge validates arguments passed through it. If the `opts` object passed to `showOpenDialog` contains a key that isn't a plain serializable value (e.g. a function, a class instance, a Symbol), the bridge silently drops the call or throws internally. Our `opts` is `{ title, filters }` — plain data — so this is very unlikely.

**How to confirm:** Simplify the call to `window.hormiga.showOpenDialog({})` and see if a dialog opens.

**Fix:** Ensure all args are plain JSON-serializable objects.

**Status:** Very unlikely given our opts structure. Last resort.

---

## Test Results Log

| # | Theory | Result | Date |
|---|--------|--------|------|
| 1 | Cache version param not bumped | ✅ CONFIRMED by dev logs — function absent in cached v7 JS | 2026-05-13 |
| 3 | Dialog opens behind window | ⏳ Testing (parent removed in v1.4.14) | 2026-05-21 |
| 1b | v1.4.14 still broken — onclick attribute silently ignored | ✅ CONFIRMED — action log "Clicked: ⬆ Upload" fires (capture-phase listener) but no console.log inside resOpenUploadDialog. Inline onclick="..." not executing. Root cause: Electron packaged app may silently drop inline event attributes. Fix in v1.4.15: replaced with overlay <input type=file> (user physically clicks the input, no JS needed) + drag-and-drop, all wired via addEventListener. | 2026-05-21 |
