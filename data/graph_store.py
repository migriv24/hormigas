"""
data/graph_store.py — Labeled Property Graph engine.

Architecture
------------
Every entity (contact, org, tag, or any future type) is a *node*;
relationships between them are *edges* with a named relation.

  Node  { id, type, label, source_key, color, attrs, stale }
  Edge  { id, from_id, to_id, relation, attrs }

Node IDs are stable UUIDs (prefix::hex12), so renaming a label doesn't
orphan existing edges.  `source_key` is the lowercased label used to
reconcile nodes with Google Sheet data on sync.

The store is a singleton backed by  data/graph.json.  All writes go
through the public API and are persisted immediately.

Public API (mirrors the REST layer in app.py)
---------------------------------------------
  gs = GraphStore.get()

  # Nodes
  gs.add_node(type, label, color, attrs)  → Node
  gs.get_node(id)                         → Node | None
  gs.update_node(id, **kwargs)            → Node | None
  gs.delete_node(id)                      → bool   (also removes edges)
  gs.get_nodes(type=None)                 → list[Node]
  gs.find_by_source_key(sk, type)        → Node | None

  # Edges
  gs.add_edge(from_id, to_id, relation, attrs)  → Edge | None
  gs.get_edge(id)                               → Edge | None
  gs.get_edge_between(from_id, to_id, relation) → Edge | None
  gs.delete_edge(id)                            → bool
  gs.get_edges(from_id, to_id, relation)        → list[Edge]

  # Queries
  gs.neighbors(node_id, relation, direction)    → list[Node]
  gs.nodes_by_tag(tag_id)                       → list[Node]
  gs.subgraph(node_id, depth)                   → {nodes, edges}  # for D3

  # Sheet sync
  gs.sync_contacts(contacts)   → int   (upsert contact/org nodes + member_of edges)
  gs.sync_orgs(orgs)           → int   (upsert org nodes)

  # Serialise
  gs.to_dict()  → {nodes: [...], edges: [...]}
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

GRAPH_PATH = Path(__file__).parent / "graph.json"
_CLOUD_KEY = "graph"


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class GraphNode:
    id: str
    type: str           # "contact" | "org" | "tag" | extensible
    label: str
    source_key: str     # normalised key for sheet reconciliation (lowercase)
    color: Optional[str] = None
    attrs: dict = field(default_factory=dict)
    stale: bool = False  # True when no longer present in sheet


@dataclass
class GraphEdge:
    id: str
    from_id: str
    to_id: str
    relation: str       # "member_of" | "tagged" | "connected_to" | extensible
    attrs: dict = field(default_factory=dict)


# ── Store ─────────────────────────────────────────────────────────────────────

class GraphStore:
    _instance: Optional["GraphStore"] = None

    def __init__(self, path: Path = GRAPH_PATH) -> None:
        self.path = Path(path)
        self._nodes: dict[str, GraphNode] = {}
        self._edges: dict[str, GraphEdge] = {}
        self._load()

    # ── Singleton ─────────────────────────────────────────────────────────────

    @classmethod
    def get(cls) -> "GraphStore":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        try:
            if is_cloud_available():
                raw = cloud_load(_CLOUD_KEY) or {}
            elif self.path.exists():
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            else:
                return
            for nid, nd in raw.get("nodes", {}).items():
                self._nodes[nid] = GraphNode(**nd)
            for ed in raw.get("edges", []):
                self._edges[ed["id"]] = GraphEdge(**ed)
        except Exception:
            self._nodes = {}
            self._edges = {}

    def _save(self) -> None:
        data = {
            "nodes": {nid: asdict(n) for nid, n in self._nodes.items()},
            "edges": [asdict(e) for e in self._edges.values()],
        }
        if is_cloud_available():
            cloud_save(_CLOUD_KEY, data)
        else:
            self.path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )

    # ── Node helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _make_id(type_: str) -> str:
        return f"{type_}::{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _source_key(label: str) -> str:
        return label.lower().strip()

    # ── Node CRUD ─────────────────────────────────────────────────────────────

    def add_node(
        self,
        type: str,
        label: str,
        color: Optional[str] = None,
        attrs: Optional[dict] = None,
        source_key: Optional[str] = None,
    ) -> GraphNode:
        nid = self._make_id(type)
        node = GraphNode(
            id=nid,
            type=type,
            label=label,
            source_key=source_key or self._source_key(label),
            color=color,
            attrs=attrs or {},
        )
        self._nodes[nid] = node
        self._save()
        return node

    def get_node(self, id: str) -> Optional[GraphNode]:
        return self._nodes.get(id)

    def update_node(self, id: str, **kwargs: Any) -> Optional[GraphNode]:
        node = self._nodes.get(id)
        if not node:
            return None
        for k, v in kwargs.items():
            if hasattr(node, k):
                setattr(node, k, v)
        # Keep source_key in sync with label if not explicitly overridden
        if "label" in kwargs and "source_key" not in kwargs:
            node.source_key = self._source_key(kwargs["label"])
        self._save()
        return node

    def delete_node(self, id: str) -> bool:
        if id not in self._nodes:
            return False
        del self._nodes[id]
        # Remove all incident edges
        self._edges = {
            eid: e
            for eid, e in self._edges.items()
            if e.from_id != id and e.to_id != id
        }
        self._save()
        return True

    def get_nodes(self, type: Optional[str] = None) -> list[GraphNode]:
        nodes = list(self._nodes.values())
        if type:
            nodes = [n for n in nodes if n.type == type]
        return nodes

    def find_by_source_key(
        self, source_key: str, type: Optional[str] = None
    ) -> Optional[GraphNode]:
        sk = source_key.lower().strip()
        for n in self._nodes.values():
            if n.source_key == sk:
                if type is None or n.type == type:
                    return n
        return None

    # ── Edge CRUD ─────────────────────────────────────────────────────────────

    def add_edge(
        self,
        from_id: str,
        to_id: str,
        relation: str,
        attrs: Optional[dict] = None,
    ) -> Optional[GraphEdge]:
        if from_id not in self._nodes or to_id not in self._nodes:
            return None
        # Idempotent — return existing edge if already present
        existing = self.get_edge_between(from_id, to_id, relation)
        if existing:
            return existing
        eid = f"e::{uuid.uuid4().hex[:12]}"
        edge = GraphEdge(
            id=eid,
            from_id=from_id,
            to_id=to_id,
            relation=relation,
            attrs=attrs or {},
        )
        self._edges[eid] = edge
        self._save()
        return edge

    def get_edge(self, id: str) -> Optional[GraphEdge]:
        return self._edges.get(id)

    def get_edge_between(
        self, from_id: str, to_id: str, relation: Optional[str] = None
    ) -> Optional[GraphEdge]:
        for e in self._edges.values():
            if e.from_id == from_id and e.to_id == to_id:
                if relation is None or e.relation == relation:
                    return e
        return None

    def delete_edge(self, id: str) -> bool:
        if id not in self._edges:
            return False
        del self._edges[id]
        self._save()
        return True

    def get_edges(
        self,
        from_id: Optional[str] = None,
        to_id: Optional[str] = None,
        relation: Optional[str] = None,
    ) -> list[GraphEdge]:
        edges = list(self._edges.values())
        if from_id:
            edges = [e for e in edges if e.from_id == from_id]
        if to_id:
            edges = [e for e in edges if e.to_id == to_id]
        if relation:
            edges = [e for e in edges if e.relation == relation]
        return edges

    # ── Graph queries ─────────────────────────────────────────────────────────

    def neighbors(
        self,
        node_id: str,
        relation: Optional[str] = None,
        direction: str = "both",  # "out" | "in" | "both"
    ) -> list[GraphNode]:
        results: list[GraphNode] = []
        seen: set[str] = set()
        for e in self._edges.values():
            if relation and e.relation != relation:
                continue
            target_id: Optional[str] = None
            if direction in ("out", "both") and e.from_id == node_id:
                target_id = e.to_id
            elif direction in ("in", "both") and e.to_id == node_id:
                target_id = e.from_id
            if target_id and target_id not in seen:
                n = self._nodes.get(target_id)
                if n:
                    results.append(n)
                    seen.add(target_id)
        return results

    def nodes_by_tag(self, tag_id: str) -> list[GraphNode]:
        """Return all nodes tagged by `tag_id` (i.e. edges IN to the tag)."""
        return self.neighbors(tag_id, relation="tagged", direction="in")

    def subgraph(self, node_id: str, depth: int = 1) -> dict:
        """
        Return {nodes, edges} for all nodes within `depth` hops of `node_id`.
        Used by the future D3 visualisation layer.
        """
        visited_nodes: set[str] = set()
        visited_edges: set[str] = set()
        frontier: set[str] = {node_id}

        for _ in range(depth):
            next_frontier: set[str] = set()
            for nid in frontier:
                for e in self._edges.values():
                    if e.from_id == nid or e.to_id == nid:
                        visited_edges.add(e.id)
                        other = e.to_id if e.from_id == nid else e.from_id
                        if other not in visited_nodes:
                            next_frontier.add(other)
            visited_nodes |= frontier
            frontier = next_frontier - visited_nodes

        all_nodes = visited_nodes | frontier
        return {
            "nodes": [
                asdict(self._nodes[nid])
                for nid in all_nodes
                if nid in self._nodes
            ],
            "edges": [
                asdict(self._edges[eid])
                for eid in visited_edges
            ],
        }

    # ── Sheet sync ────────────────────────────────────────────────────────────

    def sync_contacts(self, contacts: list) -> int:
        """
        Upsert contact nodes and member_of edges from Google Sheet contact data.
        Marks nodes no longer present in the sheet as stale (but does not delete).
        Returns count of synced contacts.
        """
        seen_ids: set[str] = set()

        for c in contacts:
            name: str = getattr(c, "name", "") or ""
            if not name:
                continue
            sk = self._source_key(name)
            node = self.find_by_source_key(sk, "contact")
            if not node:
                node = self.add_node("contact", name, source_key=sk)
            else:
                updates: dict = {}
                if node.label != name:
                    updates["label"] = name
                if node.stale:
                    updates["stale"] = False
                if updates:
                    self.update_node(node.id, **updates)
            seen_ids.add(node.id)

            # Ensure org node + member_of edge
            org_name: str = getattr(c, "organization", "") or ""
            if org_name:
                org_sk = self._source_key(org_name)
                org_node = self.find_by_source_key(org_sk, "org")
                if not org_node:
                    org_node = self.add_node("org", org_name, source_key=org_sk)
                self.add_edge(node.id, org_node.id, "member_of")

        # Mark vanished contact nodes stale
        for n in self._nodes.values():
            if n.type == "contact" and n.id not in seen_ids and not n.stale:
                n.stale = True
        self._save()
        return len(seen_ids)

    def sync_images(self, images: list) -> int:
        """Upsert image nodes from local image store. images is list[dict]."""
        seen_ids: set[str] = set()
        for img in images:
            url: str = img.get("url", "") if isinstance(img, dict) else getattr(img, "url", "")
            name: str = img.get("name", "") if isinstance(img, dict) else getattr(img, "name", "")
            if not url:
                continue
            sk = self._source_key(url)
            node = self.find_by_source_key(sk, "image")
            if not node:
                node = self.add_node("image", name or url, source_key=sk, attrs={"url": url})
            else:
                updates: dict = {}
                if name and node.label != name:
                    updates["label"] = name
                if node.stale:
                    updates["stale"] = False
                if updates:
                    self.update_node(node.id, **updates)
            seen_ids.add(node.id)
        for n in self._nodes.values():
            if n.type == "image" and n.id not in seen_ids and not n.stale:
                n.stale = True
        self._save()
        return len(seen_ids)

    def sync_events(self, events: list) -> int:
        """Upsert event nodes from events data. events is list[Event]."""
        seen_ids: set[str] = set()
        for ev in events:
            title: str = getattr(ev, "title", "") or ""
            row_index = getattr(ev, "row_index", None)
            if not title:
                continue
            sk = self._source_key(f"ev:{row_index}" if row_index is not None else title)
            node = self.find_by_source_key(sk, "event")
            if not node:
                attrs: dict = {}
                if row_index is not None:
                    attrs["row_index"] = row_index
                node = self.add_node("event", title, source_key=sk, attrs=attrs)
            else:
                updates: dict = {}
                if node.label != title:
                    updates["label"] = title
                if node.stale:
                    updates["stale"] = False
                if updates:
                    self.update_node(node.id, **updates)
            seen_ids.add(node.id)
        for n in self._nodes.values():
            if n.type == "event" and n.id not in seen_ids and not n.stale:
                n.stale = True
        self._save()
        return len(seen_ids)

    def sync_orgs(self, orgs: list) -> int:
        """
        Upsert org nodes from Google Sheet organization data.
        Returns count of synced orgs.
        """
        seen_ids: set[str] = set()

        for o in orgs:
            name: str = getattr(o, "name", "") or ""
            if not name:
                continue
            sk = self._source_key(name)
            node = self.find_by_source_key(sk, "org")
            if not node:
                node = self.add_node("org", name, source_key=sk)
            else:
                updates: dict = {}
                if node.label != name:
                    updates["label"] = name
                if node.stale:
                    updates["stale"] = False
                if updates:
                    self.update_node(node.id, **updates)
            seen_ids.add(node.id)

        for n in self._nodes.values():
            if n.type == "org" and n.id not in seen_ids and not n.stale:
                n.stale = True
        self._save()
        return len(seen_ids)

    # ── Serialise ─────────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "nodes": [asdict(n) for n in self._nodes.values()],
            "edges": [asdict(e) for e in self._edges.values()],
        }
