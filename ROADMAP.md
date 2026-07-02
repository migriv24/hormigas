# Hormiga — Development Roadmap

> Living document. Check off items as they ship. Update milestone descriptions as scope clarifies.

---

## Current state (as of v1.2.0)

- Electron desktop app (Windows installer, Mac DMG, Linux AppImage)
- Python/Flask server bundled as a single binary via PyInstaller
- Supabase REST API as the shared cloud database (no direct PostgreSQL needed)
- Google Sheets as the public-facing data layer (contacts, events, orgs, presenters)
- ImgBB for image hosting; images/jobs/tags/graph stored in Supabase
- AES-256-GCM encrypted `.miga` credential bundles for sharing database access
- Native app menu (File: New Database / Open Database / Save Database As)
- Landing page with recent databases list
- Auto-updater via GitHub Releases on `migriv24/hormigas` (formerly the separate `hormiga-releases` repo)
- Three-tier storage model: Shared (Supabase) · Public (Google Sheets) · Local (device prefs)

---

## ✅ Milestone 0 — Housekeeping *(shipped — v0.1.0)*

- [x] `.gitignore` covers all sensitive/generated files
- [x] Audit git history — no credentials committed
- [x] Remove `mobile/` directory from repo
- [ ] Add `settings.example.json` with placeholder values *(deferred)*
- [ ] Formally archive/delete `flutter-mobile` branch *(deferred)*

---

## ✅ Milestone 1 — Electron Shell *(shipped — v0.1.4)*

**Goal:** One installer. User opens Hormiga like a normal desktop app.

- [x] `package.json` with Electron 31, electron-builder 24, electron-updater 6
- [x] Dynamic port allocation — no port 5000 conflicts
- [x] Port handoff via `%APPDATA%\Hormiga\hormiga-runtime.json`
- [x] Flask spawn → poll `/health` → open BrowserWindow
- [x] Splash screen with animated loading bar and random splash messages
- [x] Clean process kill on quit
- [x] Windows NSIS installer, Mac DMG (arm64 + x64), Linux AppImage
- [x] Auto-updater with prompted install flow

---

## ✅ Milestone 2 — Supabase Migration *(shipped — v1.0.0)*

**Goal:** Database lives in the cloud. Multiple devices can read/write the same data.

- [x] Supabase project "Hormiga Latine Database" (Miguel's personal LON instance)
- [x] Switched from direct PostgreSQL (SQLAlchemy) to Supabase REST API over HTTPS
  — works everywhere, no IPv6 issues, no connection pooler required
- [x] `SupabaseRestRepository` implements the full `BaseRepository` interface via `requests`
- [x] `json_store` table in Supabase for images, jobs, tags, graph, and metadata stores
- [x] `migrate_local_to_cloud()` one-time migration from local JSON files to Supabase
- [x] Three-tier storage model finalized and documented in Settings UI

---

## ✅ Milestone 3 — Credential File + Landing Page *(shipped — v1.2.0)*

**Goal:** You create one encrypted file, send it to a friend, they open Hormiga, load the file, and immediately see your real data.

- [x] `.miga` file format (AES-256-GCM encrypted JSON bundle)
  - Contains: `supabase_url`, `supabase_anon_key`, `imgbb_api_key`, `google_sheet_id`,
    `google_credentials`, `newsletter_defaults`, and optional extras
  - Optional password protection (Layer 2 on top of app-level secret key)
- [x] Landing page shown when no credential file is loaded
  - Recent databases list (up to 8 entries, click to open)
  - Open database file (.miga) with file picker
  - New database form (enter API keys directly — no .miga file required)
  - Password prompt for protected files
- [x] `applyCredentials()` writes decrypted payload to `userData/settings.json`
- [x] Auto-open last database on startup (toggle in Settings → App Config)
- [x] Export `.miga` button in Settings (with optional password)
- [x] Native app menu: File → New Database / Open Database / Save Database As / Switch Database
- [x] Local prefs in `electron-prefs.json` (auto-open toggle, future local preferences)
- [x] Recent databases registry in `recent-databases.json`

---

## 🔄 Milestone 4 — User Identity *(next)*

**Goal:** Each person using Hormiga has a username that gets attached to their actions and shown in the UI.

- [ ] `users` table in Supabase (id, username, display_name, email, created_at, is_admin)
- [x] Profile card in Settings (display name, username, email, linked contact) — UI done
- [ ] Wire profile save to Supabase `users` table (currently local-only)
- [ ] On first open after loading credentials: prompt "Who are you?" if no username set
  - Shows list of existing users from Supabase; or "Add yourself"
  - Pick/create username → stored in local prefs
- [ ] Current user shown in main nav or top bar
- [ ] Attach `user_id` to all activity log entries (table already exists)
- [ ] Admin flag: credential file creator is admin (can export new `.miga` files)

---

## Milestone 5 — Newsletter Project Files

**Goal:** Newsletter layouts are saved as portable project files.

- [ ] Define project file format (JSON: template ID, section data, image refs as Supabase IDs)
- [ ] "Save project" → OS file picker → saves `.hormiga-project` (or `.hn`)
- [ ] "Open project" → loads file, re-fetches referenced data from Supabase
- [ ] Recent projects list in landing page and File menu
- [ ] Files are device-portable: same `.miga` → same database → same IDs resolve correctly

---

## Milestone 6 — Collaborative Features

**Goal:** Multiple LON members can work in Hormiga simultaneously without stepping on each other.

- [ ] Conflict detection for concurrent edits (last-write-wins is fine for now)
- [ ] Activity feed: see recent actions by other users (leverages existing `activity_log` table)
- [ ] Notifications for new contacts/events/images added by teammates
- [ ] "Lock" a newsletter project while editing (prevents others from editing same project)

---

## Milestone 7 — Static Site Builder

**Goal:** Hormiga generates a static LON website (not just newsletters) from the same data.

- [ ] Template system for static HTML pages (directory, event calendar, etc.)
- [ ] "Publish" action: generate static files to a configurable output folder
- [ ] Cloudflare Pages / GitHub Pages integration for one-click deploy
- [ ] Evolve from one-off newsletter export toward a continuously-updated site

---

## Release versioning convention

```
npm version patch    # bug fixes        (1.0.x)
npm version minor    # new features     (1.x.0)
npm version major    # breaking changes (x.0.0)
```

---

## Open questions

- [x] ~~Prompted vs. silent auto-updates?~~ → **prompted** (shipped in M1)
- [x] ~~Direct PostgreSQL vs. Supabase REST?~~ → **REST API only** (shipped in M2/M3)
- [x] ~~Single credential file vs. database picker?~~ → **picker with recent list** (shipped in M3)
- [ ] When to flip repo public? (leaning: after M4 — user identity means we can share more safely)
- [ ] Supabase free tier limits — monitor usage as more LON members onboard
- [ ] Private notes subsystem (local-only tags, connections, annotations) — scoped to M6 or later
