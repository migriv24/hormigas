"""
effects — the host effect handler: the holiday boundary (SPEC §9).

All real I/O the core requests routes through one function. Two kinds of call:
  * lifecycle: `save` arrives with the full state document → persist it.
  * `effect <op> [args...]` → the ops below. This is how the CLI reaches the
    holidays: `effect query images "flier AND month:june"`.

Ops:
  holidays                     describe every registered holiday (the registry view)
  query <holiday> <tagexpr>    entities matching a SPEC §5 expression
  get <holiday> <ref>          one entity by id or identity tag
  tags                         the global tag registry with usage counts
  version                      hormiga_core build info
"""
from __future__ import annotations

import json
from typing import Any, Callable

from .holidays import Holiday

# Fields worth echoing in a one-line entity summary, in preference order.
_SUMMARY_FIELDS = ("name", "title", "organization", "email", "date", "filename", "url")


def _summarize(entity: dict) -> dict:
    out = {"id": entity.get("id", entity.get("row_index"))}
    for f in _SUMMARY_FIELDS:
        if entity.get(f) not in (None, ""):
            out[f] = entity[f]
    out["tags"] = entity.get("tags", [])
    return out


def make_effect_handler(registry: dict[str, Holiday],
                        persist_state: Callable[[dict], None],
                        logger) -> Callable[[str, Any], Any]:
    def handler(op: str, args: Any):
        try:
            return _dispatch_op(op, args, registry, persist_state)
        except Exception as exc:
            logger.error(f"effect {op} failed: {exc}")
            return {"error": str(exc)}
    return handler


def _dispatch_op(op: str, args: Any, registry: dict[str, Holiday],
                 persist_state: Callable[[dict], None]):
    if op == "save":
        # args IS the full state document — write-through to the state file.
        if isinstance(args, dict):
            persist_state(args)
        return "state persisted"

    argv = (args or {}).get("args", []) if isinstance(args, dict) else []

    if op == "holidays":
        return [h.describe() for h in registry.values()]

    if op == "query":
        if not argv:
            return {"error": "usage: effect query <holiday> [<tag-expression>]"}
        name, expr = argv[0], " ".join(argv[1:])
        h = registry.get(name)
        if h is None:
            return {"error": f"no such holiday: {name} "
                             f"(have: {', '.join(sorted(registry))})"}
        entities = h.query(expr)
        return {"holiday": name, "where": expr or "(all)",
                "count": len(entities),
                "entities": [_summarize(e) for e in entities]}

    if op == "get":
        if len(argv) < 2:
            return {"error": "usage: effect get <holiday> <ref>"}
        h = registry.get(argv[0])
        if h is None:
            return {"error": f"no such holiday: {argv[0]}"}
        entity = h.get(argv[1])
        return entity if entity is not None else {"error": f"not found: {argv[1]}"}

    if op == "tags":
        import data.tags_store as tags_store
        return tags_store.get_tag_stats()

    if op == "version":
        return {"hormiga_core": "0.1.0", "holidays": sorted(registry)}

    return {"error": f"unknown effect op: {op} "
                     f"(have: holidays, query, get, tags, version)"}
