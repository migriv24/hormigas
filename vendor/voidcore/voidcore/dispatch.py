"""
voidcore/dispatch.py — the transformation-verb seam (SPEC §7 "Transformation verbs").

The three layers (Scry / Temper / Reduce) are implemented once, in the tested Python
modules. This `Dispatcher` exposes them as **dispatcher verbs** without duplicating that
logic into C: it is a drop-in **superset** of `VoidCore.dispatch` — it handles the
transform verbs itself and **delegates every other command to the C core unchanged**. So
an app can swap `vc.dispatch` for `Dispatcher(vc).dispatch` and gain `scry` / `temper` /
`materialize` while every existing verb behaves identically.

Every verb returns the standard contract `{ok, lines, data}` (SPEC §6). The mutating
verbs write back through the C dispatcher (`setjson` / `tag`), so they remain undoable;
the read verb (`scry`) never mutates. This is the binding-agnostic contract another
binding can re-implement against — Python is the reference impl, the same way the tag
evaluator has a C impl and a conformance-tested Python twin.

    from voidcore import VoidCore, Dispatcher, Temper, member_or_default, Selector
    d = Dispatcher(vc).use_temper(Temper([member_or_default("thumb", "images")]))
    d.add_selector("active", Selector(where="status:active", sort_key="title"))
    d.dispatch('scry "status:active"')      # -> {ok, data:[names...]}
    d.dispatch("scry --select active")      # -> {ok, data:[projected views...]}
    d.dispatch("temper alpha")              # normalize one rune, write back, undoable
    d.dispatch("ls")                        # delegated to the C core, unchanged
"""
from __future__ import annotations

import json
import shlex
from typing import Any, Optional

from net import NetError, from_net, to_net
from projection import (
    Context, Selector, materialize as _materialize, scry as _scry, tag_match,
)
from temper import Temper

TRANSFORM_VERBS = {"scry", "temper", "materialize", "reduce"}
# Delegated (C-core) verbs that change a rune's content/tags — after these, the optional
# temper-on-write hook re-normalizes the affected rune(s) so invariants hold even for raw
# edits (not just the app's high-level methods). Structural/lifecycle verbs are excluded.
TRIGGER_VERBS = {"set", "setjson", "facet", "tag", "rune"}


def _coerce(v: str) -> Any:
    """Parse a CLI scalar: JSON where it parses (42, true, null, "[1,2]"), else the string."""
    try:
        return json.loads(v)
    except (ValueError, TypeError):
        return v


class Dispatcher:
    def __init__(self, vc, *, temper: Optional[Temper] = None, temper_on_write: bool = False):
        self.vc = vc
        self._temper = temper
        self._temper_on_write = temper_on_write
        self._selectors: dict[str, Selector] = {}
        self._reducer = None
        self._signatures: dict[str, int] = {}

    # ── registration ─────────────────────────────────────────────────────────────
    def use_temper(self, temper: Temper) -> "Dispatcher":
        self._temper = temper
        return self

    def temper_on_write(self, enabled: bool = True) -> "Dispatcher":
        """Opt in to running the registered Temper pass automatically after every mutating
        verb, so canonical-form invariants hold even for **raw** dispatcher edits (the
        surface an app exposes to its users), not only the app's high-level methods. Off by
        default (non-breaking). Tempers only the rune(s) the verb targeted; idempotent, so a
        no-op when state is already canonical."""
        self._temper_on_write = enabled
        return self

    def add_selector(self, name: str, selector: Selector) -> "Dispatcher":
        self._selectors[name] = selector
        return self

    def use_reducer(self, reducer, signatures: dict) -> "Dispatcher":
        """Register the interaction-net reducer + glyph port signatures the `reduce` verb
        uses (the code counterpart of a `reduce` spec)."""
        self._reducer = reducer
        self._signatures = dict(signatures)
        return self

    def load_specs(self, *, temper=None, selectors=None, reduce=None) -> "Dispatcher":
        """Register a Temper pass, named Selectors, and/or a reducer from **data** (JSON
        specs), via the `voidcore.spec` compilers. The data-authored counterpart of
        `use_temper` / `add_selector` / `use_reducer`."""
        from .spec import reducer_from_spec, selector_from_spec, temper_from_spec
        if temper is not None:
            self._temper = temper_from_spec(temper)
        for name, s in (selectors or {}).items():
            self._selectors[name] = selector_from_spec(s)
        if reduce is not None:
            self._reducer, self._signatures = reducer_from_spec(reduce)
        return self

    def load_from_config(self, key: str = "transform") -> "Dispatcher":
        """Load specs straight from the **state document** — `state.config[key]`, a
        `{"temper": [...], "selectors": {name: {...}}, "reduce": {...}}` object. Because
        `config` rides in the exported state, the rules persist and reload with the data they
        govern: author JSON → store in state → reopen → the verbs work, no code. A string
        value is parsed as JSON (tolerates either storage form)."""
        spec = (self.vc.export_state().get("config") or {}).get(key)
        if isinstance(spec, str):
            spec = json.loads(spec)
        if spec:
            self.load_specs(temper=spec.get("temper"), selectors=spec.get("selectors"),
                            reduce=spec.get("reduce"))
        return self

    # ── the dispatch superset ──────────────────────────────────────────────────────
    def dispatch(self, command: str) -> dict:
        try:
            argv = shlex.split(command)
        except ValueError:
            return self.vc.dispatch(command)        # odd quoting: let the C core decide
        if not argv:
            return self.vc.dispatch(command)
        verb, args = argv[0], argv[1:]
        if verb in TRANSFORM_VERBS:
            try:
                return getattr(self, f"_v_{verb}")(args)
            except Exception as e:                    # mirror SPEC §6 error contract
                return {"ok": False, "lines": [f"ERROR {verb}: {e}"], "data": None}
        result = self.vc.dispatch(command)            # delegate: drop-in superset
        if (self._temper_on_write and self._temper is not None
                and result.get("ok") and verb in TRIGGER_VERBS):
            self._auto_temper(argv)
        return result

    # ── temper-on-write ──────────────────────────────────────────────────────────
    def _auto_temper(self, argv: list[str]) -> None:
        """Re-normalize the rune(s) a just-applied mutating verb targeted, as one atomic
        frame. Write-backs go through the C dispatcher (not `self`), so this never re-enters
        the hook."""
        runes = self._active().get("runes", [])
        cmds: list[str] = []
        for r in self._targets(argv, runes):
            cmds += self._writeback_cmds(r, self._temper.rune(r))
        self._run(cmds)

    @staticmethod
    def _targets(argv: list[str], runes: list[dict]) -> list[dict]:
        """Best-effort resolution of which runes a verb touched. `set/setjson/facet/tag
        <ref>` → that rune (or, for an `@tagexpr` multi-target, the matching set);
        `rune new <glyph> <name>` → the new rune; anything else → all (safe, idempotent)."""
        verb = argv[0]
        if verb in ("set", "setjson", "facet", "tag") and len(argv) >= 2:
            ref = argv[1]
            if ref.startswith("@"):
                return [r for r in runes if tag_match(r, ref[1:])]
            return [r for r in runes if r["spirit"]["name"] == ref]
        if verb == "rune" and len(argv) >= 4 and argv[1] == "new":
            return [r for r in runes if r["spirit"]["name"] == argv[3]]
        return runes

    # ── helpers ────────────────────────────────────────────────────────────────────
    def _active(self) -> dict:
        st = self.vc.export_state()
        name = (st.get("active") or {}).get("mantle")
        for m in st.get("mantles", []):
            if m["name"] == name:
                return m
        return st["mantles"][0] if st.get("mantles") else {"runes": []}

    @staticmethod
    def _q(v: Any) -> str:
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "\\'") + "'"

    def _writeback_cmds(self, before: dict, after: dict) -> list[str]:
        """The dispatcher commands that turn the `before` rune snapshot into `after`
        (content via `setjson`, tags via `tag +/-`). Returns them rather than dispatching,
        so a whole pass can be applied as one atomic `batch` (one undo frame)."""
        name = before["spirit"]["name"]
        cmds: list[str] = []
        bc, ac = before.get("content") or {}, after.get("content") or {}
        for f in dict.fromkeys(list(bc) + list(ac)):
            if bc.get(f) != ac.get(f):
                cmds.append(f"setjson {name} {f} {self._q(ac.get(f))}")
        bt, at = set(before.get("tags") or []), set(after.get("tags") or [])
        if bt != at:
            ops = [f"+{t}" for t in at - bt] + [f"-{t}" for t in bt - at]
            cmds.append(f"tag {name} " + " ".join(ops))
        return cmds

    def _run(self, cmds: list[str]) -> dict:
        """Apply a list of dispatcher commands as **one atomic undo frame**. A single
        command runs directly; several are wrapped in the C core's `batch` verb (one
        snapshot, rolled back on any failure). Empty = a no-op. This is what makes a
        multi-rune `temper`/`materialize` (or a `create`, a `send`) undoable as one action."""
        cmds = [c for c in cmds if c]
        if not cmds:
            return {"ok": True, "lines": ["no change"], "data": None}
        if len(cmds) == 1:
            return self.vc.dispatch(cmds[0])
        arg = json.dumps(cmds).replace("'", "\\'")   # \' is a literal quote to the tokenizer
        return self.vc.dispatch("batch '" + arg + "'")

    # ── scry: read-side projection (no mutation) ──────────────────────────────────
    def _v_scry(self, args: list[str]) -> dict:
        """`scry [<tagexpr>] [--tag <expr>] [--select NAME] [--limit N]
              [--locale/-audience/-role/-date V]`
        The tag-expression may be positional or given as `--tag <expr>` (parity with
        `ls --tag`). With `--select` the registered Selector runs (its own where/sort/limit).
        `data` is matching rune names, or projected views under `--select`. Unknown `--flags`
        are rejected (rather than silently treated as tags)."""
        select_name = limit = None
        ctx_kw: dict[str, str] = {}
        where_parts: list[str] = []
        i = 0
        while i < len(args):
            a = args[i]
            if a == "--select":
                select_name = args[i + 1]; i += 2
            elif a == "--limit":
                limit = int(args[i + 1]); i += 2
            elif a == "--tag":
                where_parts.append(args[i + 1]); i += 2
            elif a in ("--locale", "--audience", "--role", "--date"):
                ctx_kw[a[2:]] = args[i + 1]; i += 2
            elif a.startswith("--"):
                return {"ok": False, "lines": [f"unknown flag: {a}"], "data": None}
            else:
                where_parts.append(a); i += 1
        where = " ".join(where_parts) or None
        runes = self._active().get("runes", [])
        ctx = Context(**ctx_kw) if ctx_kw else None
        if select_name is not None:
            sel = self._selectors.get(select_name)
            if sel is None:
                return {"ok": False, "lines": [f"unknown selector: {select_name}"], "data": None}
            data = sel.run(runes, context=ctx)
        else:
            rows = _scry(runes, where=where, limit=limit, context=ctx)
            data = [r["spirit"]["name"] for r in rows]
        return {"ok": True, "lines": [f"{len(data)} result(s)"], "data": data}

    # ── temper: normalize owned state (mutating, undoable) ────────────────────────
    def _v_temper(self, args: list[str]) -> dict:
        """`temper [<ref>]` — apply the registered Temper pass to one rune (or all runes in
        the active mantle), writing back only what changed."""
        if self._temper is None:
            return {"ok": False, "lines": ["no temper pass registered (use_temper)"], "data": None}
        runes = self._active().get("runes", [])
        if args:
            runes = [r for r in runes if r["spirit"]["name"] == args[0]]
            if not runes:
                return {"ok": False, "lines": [f"no such rune: {args[0]}"], "data": None}
        cmds, changed = [], []
        for r in runes:
            rc = self._writeback_cmds(r, self._temper.rune(r))
            if rc:
                changed.append(r["spirit"]["name"]); cmds += rc
        rb = self._run(cmds)
        if not rb["ok"]:
            return {"ok": False, "lines": rb["lines"], "data": None}
        return {"ok": True,
                "lines": [f"tempered {len(changed)} change(s): {', '.join(changed) or 'none'}"],
                "data": changed}

    # ── materialize: freeze resolved values into owned state (mutating, undoable) ──
    def _v_materialize(self, args: list[str]) -> dict:
        """`materialize <ref> <field>=<value> … [--stamp <field>]` — bake fields into a
        rune's content; `--stamp` records the snapshot-id provenance of what was baked."""
        if not args:
            return {"ok": False, "lines": ["usage: materialize <ref> field=value … [--stamp f]"],
                    "data": None}
        ref, fields, stamp = None, {}, None
        i = 0
        while i < len(args):
            a = args[i]
            if a == "--stamp":
                stamp = args[i + 1]; i += 2
            elif a.startswith("--"):
                return {"ok": False, "lines": [f"unknown flag: {a}"], "data": None}
            elif "=" in a:
                k, v = a.split("=", 1); fields[k] = _coerce(v); i += 1
            else:
                if ref is None:
                    ref = a
                i += 1
        if ref is None:
            return {"ok": False, "lines": ["materialize needs a <ref>"], "data": None}
        return self.materialize({ref: fields}, stamp=stamp)

    def materialize(self, resolved: dict[str, dict], *, into: str = "content",
                    stamp: Optional[str] = None) -> dict:
        """Programmatic form: bake `{rune_name: {field: value}}` into owned state. `stamp`
        (a content field) records each baked rune's snapshot-id provenance."""
        runes = self._active().get("runes", [])
        baked = _materialize(runes, resolved, into=into, stamp=stamp)
        cmds, changed = [], []
        for b, a in zip(runes, baked):
            rc = self._writeback_cmds(b, a)
            if rc:
                changed.append(b["spirit"]["name"]); cmds += rc
        rb = self._run(cmds)
        if not rb["ok"]:
            return {"ok": False, "lines": rb["lines"], "data": None}
        return {"ok": True, "lines": [f"materialized {len(changed)} rune(s)"], "data": changed}

    # ── reduce: rewrite the active mantle's interaction net to normal form ─────────
    def _v_reduce(self, args: list[str]) -> dict:
        """`reduce [--into <name>] [--commit]` — build the active mantle's interaction net
        (port indices ride each edge's `relation` as `"i:j"`), reduce it to normal form with
        the registered reducer, and return the **derived mantle** in `data` (source
        untouched — pure + previewable). `--into` names it; `--commit` also installs it as a
        live mantle (and switches to it)."""
        if self._reducer is None:
            return {"ok": False, "lines": ["no reducer registered (use_reducer / load_specs reduce=)"],
                    "data": None}
        into, commit = "reduced", False
        i = 0
        while i < len(args):
            a = args[i]
            if a == "--into":
                into = args[i + 1]; i += 2
            elif a == "--commit":
                commit = True; i += 1
            elif a.startswith("--"):
                return {"ok": False, "lines": [f"unknown flag: {a}"], "data": None}
            else:
                i += 1
        mantle = self._active()
        try:
            net = to_net(mantle, self._signatures)
        except NetError as e:
            return {"ok": False, "lines": [f"reduce: {e}"], "data": None}
        derived = from_net(self._reducer.reduce(net), mantle_name=into)
        lines = [f"reduced {len(mantle.get('runes', []))} -> {len(derived['runes'])} "
                 f"agents (normal form)"]
        if commit:
            self._install_mantle(derived)
            lines.append(f"installed mantle '{into}' (now active)")
        return {"ok": True, "lines": lines, "data": derived}

    def _install_mantle(self, m: dict) -> None:
        """Recreate a derived mantle as a live mantle (so it's persisted + undoable), as one
        atomic frame. Glyphs must already be registered."""
        cmds = [f"mantle new {m['name']}"]
        for r in m["runes"]:
            name = r["spirit"]["name"]
            cmds.append(f"rune new {r['glyph']} {name}")
            for f, v in (r.get("content") or {}).items():
                cmds.append(f"setjson {name} {f} {self._q(v)}")
        for e in m["layout"]["edges"]:
            cmds.append(f"link {e['from']} {e['to']} --relation {e['relation']}")
        self._run(cmds)
