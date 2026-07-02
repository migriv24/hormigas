# The Antfarm — v1 Planning Document

> **Status: Early brainstorm. This document captures what is decided, what is hypothesized, and what is still open. It will evolve.** Nothing here is final architecture — it is a thinking surface.

---

## What is the Antfarm?

The Antfarm is a **visual node network** where each node is an abstraction over some cloud API, local storage system, or external service. Nodes are connected by typed edges called **protocols**. The graph defines how data flows through — or gets routed across — multiple cloud networks and services simultaneously.

The first application of the Antfarm is Hormiga itself: the node graph defines the app's data backend. But the concept is larger than Hormiga.

A simple way to think about it: **instead of your app being hard-wired to specific APIs, your app is wired to a graph — and the graph is wired to APIs.** Swap a node in the graph, and the app routes differently without touching app code.

---

## Core Metaphor: Protocols, Not Values

Most node graphs (Blender shader nodes, Unreal Blueprint) pass **values** between nodes — a float, a color, a mesh. Antfarm nodes pass **protocols**: live, typed references to a running API connection or service interface.

```
[SQLite node] ──────────────────────► sql protocol
[Supabase node] ─────── (inactive) ─► sql protocol

[Local FS node] ────────────────────► image_storage protocol
[ImgBB node] ─────── (cloud) ───────► image_storage protocol

These protocols get wired into:

[Hormiga Core node] ◄── sql
                    ◄── image_storage
                    ◄── resource_storage
                    ──► outputs[]
```

The **Hormiga Core node** is the consumer. It does not know or care which SQL node is wired into its `sql` slot — it just calls the protocol interface. Swapping `SQLite` for `Supabase` is a graph edit, not a code change.

---

## Settled Decisions (as of v1.4.x)

- The architecture shifts from cloud-required to **local-first, protocol-agnostic**
- The trigger was Supabase free tier pausing (2026-05-03) — this exposed single-point-of-failure risk
- The `.miga` file IS the Antfarm save file. It stores:
  - Encrypted node topology
  - API keys and credentials per node
  - Admin settings (who can modify the topology)
- An **admin** builds the topology; **regular users** just run the app (read-only topology)
- SQLite is the default SQL node — zero config, ships with Python, works offline forever
- The visual editor will eventually live in its own Electron window (for now: a Connections tab placeholder)
- Protocol edges are **configuration-time** connections, not runtime data streams (at least initially)

---

## Protocol Types (Draft)

These are the first-class protocol types the system needs to support. Each defines an interface contract — what operations a node of this type must implement.

### `DataProtocol` (sql)
Structured read/write. The core CRUD layer.
```
query(sql: str, params: dict) → list[dict]
insert(table: str, row: dict) → dict
update(table: str, id: str, patch: dict) → dict
delete(table: str, id: str) → None
list(table: str, filters: dict) → list[dict]
```
Nodes: SQLite, Supabase, PostgreSQL, Firebase Firestore (future)

### `AssetProtocol` (image_storage, resource_storage)
Binary file store/retrieve.
```
upload(file: bytes, filename: str, metadata: dict) → AssetRef
get(ref: AssetRef) → bytes
delete(ref: AssetRef) → None
list(prefix: str) → list[AssetRef]
```
Nodes: Local FS, ImgBB, S3 (future), Cloudflare R2 (future)

### `OutputProtocol` (outputs[])
Push data somewhere. One-directional. Multiple output nodes can be connected simultaneously.
```
push(payload: dict, context: OutputContext) → None
```
Nodes: Google Sheets sync, Newsletter HTML export, Webhook (future), RSS feed (future)

### `LLMProtocol` (language model — see The Queen in FUTURES.md)
Inference over text with org context.
```
complete(prompt: str, context: OrgContext) → str
embed(text: str) → list[float]
```
Nodes: Claude API (cloud), OpenAI API (cloud), Ollama (local), LM Studio (local)

### `GeoProtocol` (geospatial — see Territory in FUTURES.md)
Spatial queries and geocoding.
```
geocode(address: str) → Coordinates
query_radius(center: Coordinates, radius_km: float) → list[Entity]
```
Nodes: Nominatim (local/OSM), Google Maps API (cloud), SpatiaLite extension

### `AuthProtocol` (identity — future)
User authentication and session management.
```
authenticate(credentials: dict) → Session
verify(token: str) → UserClaims | None
```
Nodes: Local (password hash + SQLite), Supabase Auth (cloud), future SSO

---

## Node Anatomy

Every node, regardless of type, has the same structural shape:

```
┌─────────────────────────────────────┐
│  [Icon]  Node Label          [●] OK │
│  node-type                          │
│                                     │
│  INPUT SLOTS         OUTPUT SLOTS   │
│  ◄ requires_auth?    sql ►          │
│                      image_storage ►│
│                                     │
│  [Configure]  [Disconnect]          │
└─────────────────────────────────────┘
```

- **Input slots** — protocols this node requires from other nodes (optional dependencies)
- **Output slots** — protocols this node provides to downstream consumers
- **Status indicator** — live connection status: OK / Error / Paused / Offline
- **Configuration** — credentials, API keys, file paths. Stored encrypted in `.miga`
- **Metadata** — node type, version, last-connected timestamp

Connections between nodes are typed. A `sql` output can only wire to a `sql` input. The editor enforces this visually (color coding by protocol type).

---

## Node Catalog (Planned)

### SQL Nodes
| Node | Type | Notes |
|---|---|---|
| SQLite | local | Default. Zero-config. File in userData. |
| Supabase | cloud | Existing implementation. |
| PostgreSQL | local/server | For self-hosted multi-user setups. |
| Firebase Firestore | cloud | Future. NoSQL — needs protocol adapter. |

### Asset Storage Nodes
| Node | Type | Notes |
|---|---|---|
| Local FS | local | Default. Served by Flask directly. |
| ImgBB | cloud | Existing implementation. Images only. |
| Cloudflare R2 | cloud | S3-compatible. Future. |
| Amazon S3 | cloud | Future. |

### Output Nodes
| Node | Type | Notes |
|---|---|---|
| Google Sheets | cloud | Existing sync. Two-way eventually. |
| Newsletter HTML | local | Render + export pipeline. |
| Webhook | cloud | POST to any URL on data events. Future. |
| RSS Feed | local | Generate a feed from events/jobs. Future. |

### Intelligence Nodes
| Node | Type | Notes |
|---|---|---|
| Cloud Queen | cloud | Claude / OpenAI API. Key in node config. |
| Local Queen | local | Ollama / LM Studio endpoint. |
| Embedding Service | local/cloud | Shared by Queen, tag similarity, translation. |

### Utility / Transform Nodes
| Node | Type | Notes |
|---|---|---|
| Cache Layer | any | Wraps another node, adds local caching. |
| Fallback | any | Primary + backup node of same protocol type. |
| Logger | any | Intercepts protocol calls and logs them. |
| Rate Limiter | cloud | Throttles API calls to stay in free tier. |

---

## The Bigger Picture: Beyond Hormiga

The Antfarm is being designed inside Hormiga, but it is not specific to Hormiga. The concept is more general:

**Any app that needs to talk to cloud APIs is a candidate for an Antfarm configuration.**

Implications worth thinking through:

### Multi-Cloud Data Routing
A `Fallback` node could sit between the app and two SQL backends:
```
[SQLite] ──► [Fallback node] ──► sql ──► [Hormiga Core]
[Supabase] ─►                (primary: Supabase, fallback: SQLite)
```
If Supabase goes down, the Fallback node transparently routes to SQLite. No app restart.

This is **resilience as a graph property**, not a code property.

### Parallel Write / Sync
An `OutputProtocol` can go to multiple nodes simultaneously. But what about writes going to multiple `DataProtocol` nodes? 
```
[Write intent] ──► [Broadcast node?] ──► SQLite (local)
                                    ──► Supabase (cloud sync)
```
This is bidirectional sync. It is hard to get right (conflicts), but the graph structure is where it belongs.

### Data Pipeline Interpretation
Nodes do not have to represent persistent APIs. They could represent **pipeline steps**:
- `[CSV Import node]` → `[Transform node]` → `[SQLite node]`
- `[SQLite node]` → `[Template Render node]` → `[Email Output node]`

At this scale the Antfarm starts to look like a local Make/Zapier — visual automation over cloud services. This is further out, but the protocol abstraction supports it without fundamental changes.

### Multi-App Configuration
A single `.miga` file (Antfarm topology) could serve multiple apps:
```
[SQLite node] ──► sql ──► [Hormiga Core node]
                    ──► sql ──► [Mound (site builder) node]
```
Both apps share the same SQL node. Changes to contact data in Hormiga immediately reflect in the Mound-generated site. This requires Mound to be an Antfarm-native app too — but that is the direction.

---

## The .miga File — v2 Format (Draft)

The current `.miga` v1 stores raw API keys as flat JSON. v2 needs to store the full node topology.

Proposed schema shape (not final):

```json
{
  "version": 2,
  "nodes": [
    {
      "id": "node-sqlite-primary",
      "type": "sqlite",
      "label": "Local Database",
      "config": { "db_path": "hormiga.db" },
      "outputs": ["sql"]
    },
    {
      "id": "node-local-fs",
      "type": "local_fs",
      "label": "Local Files",
      "config": { "base_path": "assets/uploads" },
      "outputs": ["image_storage", "resource_storage"]
    },
    {
      "id": "node-hormiga-core",
      "type": "hormiga_core",
      "label": "Hormiga",
      "inputs": {
        "sql": "node-sqlite-primary",
        "image_storage": "node-local-fs",
        "resource_storage": "node-local-fs"
      }
    }
  ],
  "admin_user": "migri",
  "created_at": "2026-06-01T00:00:00Z"
}
```

Sensitive fields (`api_key`, `password`, etc.) are encrypted at the field level before the file is written. The outer envelope is also encrypted. Non-sensitive topology data (node types, labels, connections) could be stored in plaintext to allow topology inspection without decryption — **open question**.

---

## Open Questions

These are active unknowns. Answering them will drive the next version of this document.

### Protocol Design
- Can a node provide **multiple outputs of the same protocol type**? (e.g., a `MultiSQLite` node that exposes two separate database files as two distinct `sql` outputs — one for app data, one for logs)
- Should **transform/adapter nodes** be a first-class concept? A `Supabase → SQLite` migration node is a transform. A caching wrapper is a transform. These are different from source nodes.
- What is the exact **runtime model**? Nodes initialized at app start and held in memory? Or lazily initialized on first protocol call? Does hot-swapping a node require an app restart?
- How do nodes handle **auth refresh** — OAuth tokens expiring mid-session, API key rotation?

### Graph Editor
- What is the **minimum viable editor**? For v0: a list of configured nodes (no canvas). For v1: a canvas with drag-and-drop. What is the right v0 for shipping?
- Should the editor show **live status** per node (latency, error count, last call)? This is a debugging tool. When do we need it?
- Can users **build their own nodes**? (plugin system) This is very far out but worth knowing if the core protocol abstraction needs to support it.

### The .miga File
- Can topology (graph structure) be stored in plaintext while only credentials are encrypted? This would allow version control of topology without leaking secrets.
- How does **topology versioning** work when a new node type ships that old `.miga` files don't know about? Forward compatibility strategy.
- Should non-admin users be able to **see** the topology (read-only) or should it be fully hidden from them?

### Scope Boundary
- Is the Antfarm **only** a configuration tool (defines the graph at startup), or does it support **runtime routing** (changing which node is used based on conditions, e.g. "use cloud if online, local if offline")?
- How does the Antfarm relate to **offline-first** operation? The `Fallback` node concept handles this elegantly — but does it belong in the core protocol system or as a special node type?
- At what point does the Antfarm become a **general-purpose automation tool** (Make/Zapier territory) rather than an app configuration layer? Where is the line, and do we want to cross it?

---

## Immediate Next Steps (before the editor exists)

The Antfarm concept can be implemented incrementally without the visual editor:

1. **Recover Supabase data** — `pg_dump` before 2026-08-02 cutoff
2. **Define protocol interfaces** — Python ABCs (`DataProtocol`, `AssetProtocol`, `OutputProtocol`) in `data/protocols.py`
3. **SQLiteRepository** — first concrete implementation of `DataProtocol`; drop-in for `SupabaseRestRepository`
4. **LocalStorageBackend** — `AssetProtocol` implementation for images and resources
5. **Backend selection in settings** — extend `.miga` / Settings to choose between backends (no visual editor yet — dropdown is fine)
6. **Antfarm editor v0** — card list in Connections tab showing configured nodes + status
7. **Antfarm editor v1** — canvas node editor in its own Electron window
8. **`.miga` v2 format** — topology-aware, node-based, field-level credential encryption

---

## Relationship to FUTURES.md

All of the features in FUTURES.md are Antfarm-native:
- **Hormiga Studio** — content builder, consumes `sql` + `asset` protocols
- **Mound** — site builder, is itself an Antfarm-app-node
- **The Nest** — notes system, extends `DataProtocol` with document semantics
- **The Queen** — `LLMProtocol` node, cloud and local variants
- **Territory** — `GeoProtocol` node, geospatial queries
- **The Courier** — `OutputProtocol` node specialized for email dispatch

None of these can be built cleanly until the protocol abstraction layer exists. The Antfarm foundation comes first.
