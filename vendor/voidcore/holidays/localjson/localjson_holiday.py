"""
localjson_holiday.py — a local-file data holiday: runes <-> a JSON file.

The lightweight **default store** for small local apps (a portfolio, a notes tool):
no server, no database, just a JSON file on disk — which is often *also* the app's
deploy artifact. MeshDB is for graph/mesh/distributed; SQLite for structured/queried;
this is the floor.

It is schema-driven and reusable: a `RecordSchema` says how one JSON record maps to a
Void Core rune (which field is the name, which become tags, which are content). The
holiday does the file I/O and the record<->rune mapping; assembling the runes into a
VoidCore manager is the host's job.

Mapping (per the schema):
    record[id_field]        -> spirit.name
    record[tag_list_field]  -> free tags (verbatim)
    record[tag_scalar_*]    -> "field:value" namespaced tags (e.g. status:active)
    record[flag_fields]     -> a presence tag when truthy (e.g. featured)
    remaining content_fields-> rune.content (the editable payload)
Save reverses it exactly, preserving any other top-level keys in the file.
"""
from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RecordSchema:
    record_key: str                          # the array key in the JSON file
    glyph: str                               # rune glyph for these records
    id_field: str = "id"                     # -> spirit.name
    tag_list_field: str | None = None        # list field -> free tags
    tag_scalar_fields: tuple = ()            # scalar fields -> "field:value" tags
    flag_fields: tuple = ()                  # bool fields -> presence tag
    content_fields: tuple = ()               # -> rune.content


@dataclass
class LocalJsonHoliday:
    path: str
    schema: RecordSchema
    tags: list[str] = field(default_factory=lambda: [
        "kind:data", "protocol:file", "consistency:strong",
        "role:store", "public:no", "replicated:no",
    ])

    # ── record <-> rune ──────────────────────────────────────────────────────────
    def record_to_rune(self, rec: dict) -> dict:
        s = self.schema
        rune_tags: list[str] = list(rec.get(s.tag_list_field, []) or []) if s.tag_list_field else []
        for f in s.tag_scalar_fields:
            if rec.get(f) not in (None, ""):
                rune_tags.append(f"{f}:{rec[f]}")
        for f in s.flag_fields:
            if rec.get(f):
                rune_tags.append(f)
        content = {f: rec.get(f) for f in s.content_fields}
        return {
            "spirit": {"id": f"rune_{secrets.token_hex(6)}", "name": str(rec[s.id_field])},
            "glyph": s.glyph,
            "facets": {k: "" for k in ("who", "what", "when", "where", "why", "how")},
            "tags": rune_tags,
            "content": content,
            "placement": None,
            "relations": [],
        }

    def rune_to_record(self, rune: dict) -> dict:
        s = self.schema
        tags = list(rune.get("tags", []))
        content = rune.get("content", {})
        rec: dict[str, Any] = {s.id_field: rune["spirit"]["name"]}
        # scalar/flag tags are reconstructed from the namespaced/presence tags
        scalars = {f: None for f in s.tag_scalar_fields}
        for t in tags:
            if ":" in t:
                k, v = t.split(":", 1)
                if k in scalars:
                    scalars[k] = _coerce(v)
        # Free tags = everything NOT consumed by a scalar field or a flag presence tag.
        # This deliberately keeps unknown namespaced tags (e.g. "skill:x") so the rune ->
        # record round-trip is lossless — never silently drop a tag the dispatcher accepted.
        free = [t for t in tags
                if t not in s.flag_fields
                and not (":" in t and t.split(":", 1)[0] in scalars)]
        if s.tag_list_field:
            rec[s.tag_list_field] = free
        for f in s.tag_scalar_fields:
            rec[f] = scalars[f]
        for f in s.flag_fields:
            rec[f] = f in tags
        for f in s.content_fields:
            rec[f] = content.get(f)
        return rec

    # ── file I/O ──────────────────────────────────────────────────────────────────
    def load_runes(self) -> list[dict]:
        data = self._read()
        return [self.record_to_rune(r) for r in data.get(self.schema.record_key, [])]

    def save_runes(self, runes: list[dict]) -> None:
        data = self._read()  # preserve other top-level keys
        existing = {str(r.get(self.schema.id_field)): r
                    for r in data.get(self.schema.record_key, [])}
        out = []
        for rune in runes:
            if rune.get("glyph") != self.schema.glyph:
                continue
            rid = rune["spirit"]["name"]
            rec = dict(existing.get(rid, {}))  # keep original key order + extra fields
            rec.update(self.rune_to_record(rune))  # overlay the mapped fields in place
            out.append(rec)
        data[self.schema.record_key] = out
        self._write(data)

    def lens(self):
        """The record⇄rune mapping as a single `Lens` (Scry) — `forward` = record→rune,
        `backward` = rune→record — carrying the round-trip law. Use it for persistence AND
        the app's form read/write so the mapping lives in *one* tested place. `lens.check(
        records)` is the data-loss guard (tag order is canonicalized, since it's not
        significant)."""
        from lens import Lens  # scry/lens.py (on sys.path via the voidcore package)
        tl = self.schema.tag_list_field
        norm = (lambda r: {**r, tl: sorted(r.get(tl, []) or [])}) if tl else None
        return Lens(self.record_to_rune, self.rune_to_record, normalize=norm,
                    label=f"{self.schema.record_key} record<->rune")

    def describe(self) -> dict:
        return {"kind": "data", "backend": "localjson", "path": self.path,
                "record_key": self.schema.record_key, "glyph": self.schema.glyph,
                "tags": self.tags}

    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {self.schema.record_key: []}

    def _write(self, data: dict) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")


def _coerce(v: str):
    """Turn a tag's string value back into int/bool where it clearly is one."""
    if v.isdigit():
        return int(v)
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    return v
