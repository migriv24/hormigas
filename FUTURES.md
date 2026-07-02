# Hormiga — Future Feature Vision

These are ideas that have been clearly articulated but are **not actively being built yet**.
They are documented here so they don't get lost. Each one has been given a working product name
to make the vision concrete.

Current focus: **The Antfarm** (local-first, protocol-node architecture). Everything below comes after
a solid Antfarm foundation exists.

---

## 1. Hormiga Studio
*Block-based newsletter / content builder*

Replace the current section-based newsletter builder with a visual **block system** — inspired by
Scratch, where the user assembles content by stacking and connecting blocks rather than filling out
forms. Each block is a unit of content (a heading, a contact card, an event listing, an image, a
rich-text paragraph). Blocks can be nested, reordered, and configured with parameters via a
side-panel inspector.

**Why this matters:** The current builder is a list of section types with fixed templates. Studio
makes content construction more tactile, more creative, and easier to teach to volunteers without
technical backgrounds.

**Open questions:**
- Does a block map 1:1 to a newsletter section, or are blocks sub-section-level (paragraphs, images,
  callouts)?
- How do we handle bilingual content — do blocks have EN and ES variants, or does translation happen
  at render time like today?
- Is Studio a tab inside Hormiga, or does it open in its own window (like the planned Antfarm editor)?

---

## 2. Mound
*Static site builder*

Generate a public-facing static website (HTML/CSS, no server) from the same data that powers the
newsletters — events, contacts, job postings, organizations. The site is built locally and then
deployed (to GitHub Pages, Netlify, Cloudflare Pages, or a custom server node in the Antfarm).

**Why this matters:** LON and similar orgs need a public web presence. If Hormiga already manages
all the org's data, the site should be a derived output — not a separate thing to maintain.

**Open questions:**
- What does the site structure look like? (Events page, jobs board, contact directory, newsletter archive?)
- How do templates work? Do we ship a set of themes, or is there a visual page editor?
- Relationship to the Antfarm: "deploy to GitHub Pages" is an output node. "deploy to local server"
  is a different node. The site-builder itself is neutral on deployment target.
- This is architecturally the most complex item on this list — requires a full template/theme system,
  a build pipeline, and a deployment abstraction. Do not start until Antfarm is solid.

---

## 3. The Nest
*Connected notes with AI synthesis*

An Obsidian-style notes system embedded in Hormiga, wired into the existing tag and entity systems.
Notes can reference contacts, events, organizations, and tags directly (like `[[Maria García]]` or
`#outreach`). A linked AI subroutine (see **The Queen** below) can analyze a set of notes and
generate a newsletter draft from them.

**Why this matters:** Many organizations capture institutional knowledge in scattered notes. The Nest
makes those notes first-class data — connected, searchable, and actionable.

**Open questions:**
- Storage: notes live locally (Markdown files in user data dir) or in the SQL node?
- Does The Nest have its own tab, or is it integrated into the Data Manager?
- The AI generation path: user selects notes → The Queen produces newsletter section drafts →
  user edits in Studio. How does the hand-off work?

---

## 4. The Queen
*LLM integration node*

An Antfarm protocol node for connecting a language model to Hormiga. The Queen can:
- Analyze notes (from The Nest) and draft newsletter content
- Suggest tags, event descriptions, or contact records based on context
- Answer questions about the org's data in natural language
- Eventually: assist in building Mound pages from data

Two node subtypes:
- **Cloud Queen** — connects to Claude API, OpenAI, or similar (API key configured in the node)
- **Local Queen** — connects to a locally running model via Ollama, LM Studio, or a compatible
  OpenAI-compatible endpoint. No data leaves the device.

**Why this matters:** AI assistance is most useful when it has context. The Queen has context —
it knows the org's contacts, events, tags, and notes. Generic AI tools don't.

**Open questions:**
- What is the exact protocol interface? (The Queen node outputs a `llm` protocol that other nodes
  consume — but what operations does that protocol define?)
- How do we handle prompt context limits when the full dataset is large?
- Privacy: contacts and event details are sensitive. Local Queen is the privacy-safe option.
  Does the UI make it clear when data is being sent to a cloud model?

---

## 5. Territory
*Geospatial / map layer*

Associate contacts, organizations, events, and incidents with geographic coordinates. Render a
Leaflet.js map inside Hormiga showing the org's spatial data. Incidents (accidents, closures,
community events) can be reported by users and linked to the map.

**The flagship use case:** Personalized newsletters based on location. If a subscriber's address
is known, the newsletter engine can:
- Order events by distance from the subscriber
- Surface relevant incidents near the subscriber's area (road closures, safety notices)
- Insert dynamic context blocks ("There is a road closure near the event venue — plan accordingly")

This makes the newsletter genuinely useful rather than generic mass-blast content.

**Geospatial data as a first-class type in the Antfarm:** Territory data (coordinates, incident
reports) needs its own storage node. Could be a local SQLite extension (SpatiaLite) or a GeoJSON
file-based store. Later: a cloud tile server node.

**Open questions:**
- What is the minimum viable geo feature? (Just lat/lng on contacts + basic map view, before
  the personalized newsletter path.)
- How do users input location? (Manual entry, address geocoding via a geocoder API node, or
  drag-to-place on the map?)
- The personalized newsletter path requires knowing which subscriber receives which email — this is
  tightly coupled to The Courier (below).

---

## 6. The Courier
*Newsletter dispatch system*

Send newsletters directly from Hormiga to the contact list, without exporting HTML and pasting it
into Gmail. Subscribers receive personalized emails (see Territory for location-based
personalization).

Key concerns:
- **Deliverability:** Sending bulk email from a desktop app is tricky. The most reliable path is
  a Transactional Email node in the Antfarm (SendGrid, Postmark, Amazon SES, or a self-hosted
  Postal instance). Not raw SMTP from the user's machine.
- **Unsubscribe / compliance:** Any bulk email system needs a one-click unsubscribe mechanism,
  which requires tracking subscriber state. This is a new data model concern.
- **Personalization tokens:** Each email is rendered with subscriber-specific data injected
  (name, location, relevant events). This requires a template rendering pass per subscriber.
- **Preview before send:** The user must be able to see exactly what a specific subscriber
  will receive before the batch goes out.

**Open questions:**
- Where does subscriber opt-in/opt-out state live? In the SQL node?
- Does The Courier have its own Antfarm node type, or is it an output protocol on the Hormiga core?
- The Google Sheets contact list is currently the subscriber list — how does unsubscribe state
  feed back to the sheet (if it does)?

---

## Summary Table

| Name | What it is | Depends on | Complexity |
|---|---|---|---|
| Hormiga Studio | Block-based content builder | Antfarm (stable) | Medium |
| Mound | Static site builder + deploy | Antfarm + Studio | High |
| The Nest | Connected notes system | SQL node (local) | Medium |
| The Queen | LLM protocol node | Antfarm node system | Medium–High |
| Territory | Geospatial / map layer | SQL node + contacts | High |
| The Courier | Newsletter email dispatch | Territory (for personalization), Antfarm output node | High |

**Suggested build order** (after Antfarm foundation is solid):
The Nest → Hormiga Studio → The Queen → The Courier → Territory → Mound

---

## Stable-Branch Feature Backlog

These are features that belong in the **stable edition** (not Antfarm-specific) and were
articulated during active newsletter use. They are smaller in scope than the Antfarm features
above and could be shipped without a full architecture overhaul.

---

### A. Contact Notes — Public Bio vs. Internal Notes

**The ask:** The current "Notes" field on contacts is rendered publicly (in attendee lists,
presenter bios, etc.). Sensitive operational info (e.g. "Tom lost his program funding —
looking for alternatives") doesn't belong there. We need two note fields:

- **Public Bio** — shown in newsletters, presenter sections, attendee lists. Editable, formatted.
- **Internal Notes** — never rendered in any newsletter output. Stored in Supabase (anyone who
  holds the .miga file is trusted with these notes). Free-form, timestamped ideally.

**Why this matters:** Meeting facilitators collect sensitive context about community partners
(funding situations, personal circumstances, internal org politics). That context is operationally
important but inappropriate to surface publicly. Without a private field, people either skip
capturing it or accidentally expose it.

**Implementation path (stable):**
- Add `internal_notes` column to contacts table (migration)
- Add "Internal Notes" textarea to the contact edit form, visually separated from Public Bio
- Never include `internal_notes` in newsletter rendering, API export, or public-facing outputs
- Include it in .miga export (trusted to holders)

---

### B. Multi-Presenter Sections + Associated Images

**The ask:** Presentations at LON meetings often have more than one presenter (e.g. Marcia
Koenig + Rebecca Ramos presenting PASS Lane together). The current presenter section assumes a
single contact. Images associated with a presentation (fliers, slides, screenshots) should be
taggable at upload time based on the presentation context, and optionally composited into a
single graphic (similar to the PDF preview generation we do for resources).

**Details:**
- A presentation block should accept 1–N presenter contacts (not just one)
- Each presentation can have associated images (separate from the presenter headshots)
- When uploading images via ImgBB, the presentation context should suggest relevant tags
  (e.g. uploading during "May PASS Lane presentation" auto-suggests tag `may`, `passLane`, etc.)
- Images may be excluded from the newsletter entirely (internal reference only), OR
  composited into a single banner/collage graphic for newsletter use

**Why this matters:** The current single-presenter model forces awkward workarounds for
co-presentations (listing them separately, or just picking one). The image compositing would
remove the need for manual image editing before sending.

---

### C. Offline-First Operation

**The ask:** Hormiga should remain usable without an internet connection. This includes the
stable edition — not just Antfarm. The app should not be broken when Wi-Fi is unavailable.

**What "offline" means:**
- **Read:** All contact, event, job, organization, and resource data should be readable from a
  local cache when the server (Supabase) is unreachable.
- **Write:** Changes made offline should queue locally and sync when connectivity is restored.
  No silent data loss.
- **Files (ImgBB, resources):** Cached images should be stored locally so newsletters render
  correctly offline. This is the hard part — file caching requires a more robust asset manager.
- **Auto-backup:** The app should continuously mirror its live data to a local snapshot so there
  is always a recent offline copy without the user needing to remember to export a .miga file.

**Complexity notes:**
- Requires a local-first data layer (SQLite or a JSON file store) underneath the current
  Supabase calls. The Supabase calls become "sync targets" rather than the source of truth.
- Old local snapshots may have a different schema than new ones — needs a migration/versioning
  system for the local cache. This is the same problem Antfarm is solving at the architecture
  level, so Antfarm's approach should inform this (not duplicate it).
- ImgBB images: a local asset proxy that intercepts `<img>` loads and serves from cache when
  offline is the cleanest approach. Alternatively, store image data in the local SQLite store
  (as blobs or base64). The blob approach is simpler but bloats the database.

**Minimum viable offline (stable path):**
1. On each successful data load, write a local JSON snapshot to `userData/offline-cache.json`
2. On startup, if Supabase is unreachable, load from the snapshot with a visible "Offline mode"
   banner
3. Images: no change for now (they'll be broken offline) — address in a later pass
4. Write queue: not in MVP — offline mode is read-only initially
5. Conflict resolution: when reconnecting, diff local writes against server state. If conflicts
   are detected, show a modal with a list of conflicting fields (not just raw JSON — show field
   labels and values). Keep both versions visible side-by-side. The architecture should use a
   git-like change log internally so the diff is always computable. Start simple (log + display),
   upgrade to visual diff UI later. The key design constraint: conflict resolution logic must be
   behind an interface so the display layer can be swapped without touching the sync logic.

---

### D. Tag Management Panel

**The ask:** A dedicated UI for managing the tag vocabulary across all entities (contacts, events,
resources, jobs, organizations). Currently tags are free-text, which causes drift (`may` vs `May`
vs `may2026`).

**Simple version (stable):**
- List all tags in use across all entity types, with usage counts
- Rename a tag across all entities in one action
- Merge two tags (combining usage)
- Delete a tag (removes from all entities)
- Detect near-duplicate tags visually (e.g. "may" and "May" in the same list)

**Architecture constraint:** The tag similarity detection must be behind a `TagSimilarityProvider`
interface. The first implementation uses simple string normalization (lowercase, trim). A future
implementation swaps in a textual embedding model for semantic similarity (e.g. "healthcare" and
"health" as near-duplicates). The interface must not assume either approach — it just returns a
similarity score between two tag strings.

**Why embeddings matter here and elsewhere:**
Textual embedding models (e.g. sentence-transformers, or a small local model via llamafile/Ollama)
are relevant to at least three Hormiga features:
1. Tag similarity detection (this feature)
2. Newsletter translation — embeddings can guide context-aware translation rather than naive
   word-for-word approaches
3. The Queen (LLM node) — embeddings are the retrieval layer for the Queen's context window

All three share the same underlying need: a local embedding inference endpoint. When we build the
embedding infrastructure, it should be a shared service node (Antfarm) or a shared Python module
(stable), not three separate implementations. **Note this dependency now so we don't build three
incompatible embedding stacks.**

---

### E. Bulk Tag Operations + Entity Tagging

**The ask:** Bulk selection and tagging should be available on every list view (contacts, events,
resources, jobs). Select multiple rows → apply/remove tags in one action. Also:
- Newsletters themselves should be taggable (e.g. tag a project with `may`, `healthcare`,
  `bilingual` to filter and find it later)
- Images should be bulk-taggable
- The "select all" / "select page" / "select none" pattern should be consistent everywhere

**Why this is important:** The tag system is the primary organizational mechanism in Hormiga.
If you can't apply tags in bulk, tagging 50 events for a new month takes too long. The system
becomes unusable at scale without bulk operations.

**Implementation approach:**
- Add a checkbox column to each list view (toggled by a "Select" mode button)
- A floating action bar appears when items are selected: "Tag", "Untag", "Delete" actions
- Tag action opens a small popover: type to add tags, click existing tags to remove
- This pattern is identical across all entity types — extract as a reusable `BulkActionBar`
  component so it only needs to be built once

---

### F. Image Compositing Engine

**The ask:** A standalone module that takes multiple images as input and produces a single
composite output (banner, collage, grid). This is needed in at least two places:
1. Resources tab: composite multiple PDF page previews into a single preview image
2. Presenter sections: composite presenter headshot(s) + presentation slide screenshots into
   a single newsletter-ready banner

**Architecture:** This should be a self-contained Python module (`services/compositor.py`) with
a simple interface: `composite(images: list[ImageSource], layout: Layout) -> bytes`. The caller
doesn't need to know whether it uses PIL, Cairo, wand, or something else. The newsletter builder
calls it; the resources tab calls it; neither knows the implementation.

The `Layout` type should support at minimum: `grid`, `banner` (single wide strip), and
`collage` (free-form with small overlaps). Start with `grid` since that's what the resources
tab already approximates.

---

### G. Newsletter Auto-Constructor

**The ask:** Paste meeting notes (Obsidian-style) + specify a month → Hormiga builds a newsletter
draft automatically by matching the notes content against tagged data (events, contacts, resources,
jobs) and populating the appropriate sections.

**Why this is more complex than it looks:**
- The meeting notes format is unstructured (bullet points, `[[Contact Name]]` wikilinks,
  free-form paragraphs). Parsing this requires either a rigid schema OR an LLM pass.
- Section mapping is non-trivial: "Marcia presented PASS Lane" → presenter_cta section with
  Marcia as contact, plus a narrative section with PASS Lane content. This requires entity
  resolution AND content understanding.
- The tag-based approach (month tag → pull in all events/contacts tagged with that month) is
  simpler but incomplete — it can populate the event grid and job grid but not the narrative
  sections, which require content from the notes.
- LLM-assisted construction (The Queen) is the right long-term answer. Without it, the
  auto-constructor can only do the mechanical sections (grids, attendee lists), not the
  editorial ones (hero, highlights, narratives).

**Short-term approach (stable, without LLM):**
Build a "Quick Start from Month" button that pre-populates the data-driven sections (event grid,
job grid, presenter_cta with contacts tagged for that month) and leaves the narrative sections
blank. This reduces setup time without requiring LLM infrastructure.

---

### H. Newsletter Send Log (out of scope for stable)

Record when a newsletter was sent, to whom (tag), with an archived copy of the rendered HTML.
This requires: (1) a send mechanism (The Courier), (2) subscriber tracking, (3) a storage scheme
for rendered HTML archives. All three are non-trivial. **Do not start until The Courier is
designed.** Note it here so it doesn't get forgotten.
