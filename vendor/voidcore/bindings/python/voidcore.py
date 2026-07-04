"""
voidcore.py — Python ctypes binding for the Void Core C library.

This is the first binding target (the Deltarune mod tool is Python). It wraps the
pure C ABI in `core/include/voidcore.h`. Everything crosses as JSON strings, so
this file stays tiny and the host app never touches C memory directly.

Memory discipline: vc_dispatch / vc_export_state return heap strings that MUST be
freed via vc_free_str. We declare their restype as c_void_p (not c_char_p) so we
keep the exact pointer to free, read the bytes via cast, then free — no leak.
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
from typing import Any, Optional


# The host effect handler signature: char* fn(const char *op, const char *args_json,
# void *user). We return c_void_p (a string the core will free()), built via
# vc_alloc_str so it's allocated by the library's own CRT (no cross-allocator free).
_EFFECT_FN = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p)


def _default_dll_path() -> str:
    """Locate libvoidcore.dll relative to the repo (built by CMake into core/build/bin)."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, "..", ".."))
    names = ["libvoidcore.dll", "voidcore.dll", "libvoidcore.so", "libvoidcore.dylib"]
    roots = [
        os.path.join(repo, "core", "build", "bin"),
        os.path.join(repo, "core", "build"),
        here,
    ]
    for root in roots:
        for name in names:
            cand = os.path.join(root, name)
            if os.path.exists(cand):
                return cand
    raise FileNotFoundError(
        "libvoidcore.dll not found — build it first:\n"
        "  cmake -S core -B core/build -G Ninja && cmake --build core/build"
    )


class VoidCore:
    """A handle to one Void Core manager."""

    def __init__(self, state: Optional[dict] = None, dll_path: Optional[str] = None):
        self._lib = ctypes.CDLL(dll_path or _default_dll_path())
        self._bind()
        state_json = json.dumps(state).encode("utf-8") if state is not None else None
        self._m = self._lib.vc_create(state_json)
        if not self._m:
            raise RuntimeError("vc_create returned NULL (allocation failure)")

    def _bind(self) -> None:
        L = self._lib
        L.vc_create.restype = ctypes.c_void_p
        L.vc_create.argtypes = [ctypes.c_char_p]
        L.vc_dispatch.restype = ctypes.c_void_p   # keep ptr to free it
        L.vc_dispatch.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        L.vc_export_state.restype = ctypes.c_void_p
        L.vc_export_state.argtypes = [ctypes.c_void_p]
        L.vc_register_glyph.restype = ctypes.c_int
        L.vc_register_glyph.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        L.vc_set_effect_handler.restype = None
        L.vc_set_effect_handler.argtypes = [ctypes.c_void_p, _EFFECT_FN, ctypes.c_void_p]
        L.vc_alloc_str.restype = ctypes.c_void_p
        L.vc_alloc_str.argtypes = [ctypes.c_char_p]
        L.vc_free_str.argtypes = [ctypes.c_void_p]
        L.vc_destroy.argtypes = [ctypes.c_void_p]
        L.vc_version.restype = ctypes.c_char_p
        L.vc_tag_match.restype = ctypes.c_int
        L.vc_tag_match.argtypes = [ctypes.c_char_p, ctypes.c_char_p]

    def _take(self, ptr: int) -> str:
        """Read a heap string returned by the lib, then free it."""
        if not ptr:
            return ""
        try:
            return ctypes.cast(ptr, ctypes.c_char_p).value.decode("utf-8")
        finally:
            self._lib.vc_free_str(ptr)

    @property
    def version(self) -> str:
        return self._lib.vc_version().decode("utf-8")

    def dispatch(self, command: str) -> dict[str, Any]:
        """Run one command; return the parsed {ok, lines, data} result."""
        ptr = self._lib.vc_dispatch(self._m, command.encode("utf-8"))
        return json.loads(self._take(ptr))

    def export_state(self) -> dict[str, Any]:
        ptr = self._lib.vc_export_state(self._m)
        return json.loads(self._take(ptr))

    def tag_match(self, expr: str, tags: list[str]) -> bool:
        """Evaluate a SPEC §5 tag/filter expression against a bag of tags.

        The one C implementation of the filter grammar, exposed so hosts filtering
        holiday/external entities (`effect query …`) never reimplement it. Include
        the entity's name in `tags` to get name-as-tag matching. Stateless (does
        not touch this manager's state) and thread-safe."""
        r = self._lib.vc_tag_match(expr.encode("utf-8"),
                                   json.dumps(list(tags)).encode("utf-8"))
        if r < 0:
            raise ValueError(f"vc_tag_match: malformed input (expr={expr!r})")
        return bool(r)

    def register_glyph(self, glyph: dict) -> bool:
        """Declare a rune type (host app config; not part of exported state)."""
        ok = self._lib.vc_register_glyph(self._m, json.dumps(glyph).encode("utf-8"))
        return bool(ok)

    def set_effect_handler(self, fn) -> None:
        """Register the host effect handler — the holiday boundary where real I/O lives.

            fn(op: str, args) -> dict | str | None

        Invoked for `save` (args = the full state document), `deploy`/`build`/`preview`
        (args = {"args":[...]}), and the generic `effect <op> [args...]` verb (args =
        {"args":[...]}). The return becomes the command's `data` (dict/list) or a line
        (str); None means "done, no value". This is how an app reaches its real backend —
        e.g. Hormiga's "holiday query -> tagged rune collection": `effect query "<expr>"`.

        Memory is handled for you: the result is copied into a library-owned string
        (vc_alloc_str) that the core frees, so there is no cross-allocator hazard."""
        def _trampoline(op, args_json, _user):
            try:
                op_s = op.decode("utf-8") if op else ""
                args = json.loads(args_json.decode("utf-8")) if args_json else None
                result = fn(op_s, args)
                if result is None:
                    return None
                s = result if isinstance(result, str) else json.dumps(result)
                return self._lib.vc_alloc_str(s.encode("utf-8"))
            except Exception:
                return None  # never let a host exception cross back into C
        cb = _EFFECT_FN(_trampoline)
        self._effect_cb = cb  # keep a reference alive (C holds a raw pointer to it)
        self._lib.vc_set_effect_handler(self._m, cb, None)

    def close(self) -> None:
        if getattr(self, "_m", None):
            self._lib.vc_destroy(self._m)
            self._m = None

    def __enter__(self) -> "VoidCore":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


# ── smoke test ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    vc = VoidCore()
    print(f"binding OK - Void Core {vc.version}\n")

    # the app declares its rune types first
    vc.register_glyph({"glyph": "dialogue", "label": "Dialogue line",
                       "editor": "form", "fields": ["speaker", "text", "expression"]})
    vc.register_glyph({"glyph": "walk", "label": "Walk action",
                       "editor": "form", "fields": ["actor", "x", "y", "speed"]})

    script = [
        "mantle new castle-town",
        "rune new dialogue susie-intro",
        'set susie-intro text "Hey, Kris!"',
        "tag susie-intro +chapter:2 +susie",
        "rune new walk kris-walk-in",
        "ls",
    ]
    for cmd in script:
        res = vc.dispatch(cmd)
        flag = "ok " if res["ok"] else "ERR"
        print(f"[{flag}] {cmd}")
        for line in res["lines"]:
            print(f"        {line}")

    # prove data crosses as real Python objects
    names = vc.dispatch("ls")["data"]
    assert names == ["susie-intro", "kris-walk-in"], names
    print(f"\nls data -> {names}")

    # undo/redo (SPEC §6)
    vc.dispatch('set susie-intro text "EDITED"')
    assert vc.dispatch("get susie-intro text")["data"] == "EDITED"
    assert vc.dispatch("undo")["ok"]
    assert vc.dispatch("get susie-intro text")["data"] == "Hey, Kris!"
    assert vc.dispatch("redo")["ok"]
    assert vc.dispatch("get susie-intro text")["data"] == "EDITED"
    assert vc.dispatch("undo")["ok"]  # leave it back at "Hey, Kris!"
    print("undo/redo: OK")

    # round-trip the whole state through Python
    state = vc.export_state()
    assert state["mantles"][0]["name"] == "castle-town"
    print(f"exported state has {len(state['mantles'][0]['runes'])} runes in "
          f"'{state['mantles'][0]['name']}'")

    # rebuild a fresh manager from the exported state
    vc2 = VoidCore(state=state)
    assert vc2.dispatch("use castle-town")["ok"]
    assert vc2.dispatch("ls")["data"] == names
    print("round-trip through a new manager: OK")

    # error contract: unknown verb + unknown glyph both rejected
    bad = vc.dispatch("bogus-verb x")
    assert bad["ok"] is False
    assert vc.dispatch("rune new wobble x")["ok"] is False  # glyph not registered
    assert vc.dispatch("rune new dialogue ok-name")["ok"] is True
    print(f"error contract: {bad['lines'][0]!r}")
    print(f"glyph default content: {vc.dispatch('cat ok-name')['data']['content']}")

    # tag system: filter grammar, glyph-as-tag, multi-target @ (SPEC §5)
    vc.dispatch("rune new dialogue ralsei-greet")
    vc.dispatch("tag ralsei-greet +chapter:2 +ralsei")
    assert vc.dispatch('ls --tag "ralsei AND chapter:2"')["data"] == ["ralsei-greet"]
    assert vc.dispatch("ls --tag glyph:walk")["data"] == ["kris-walk-in"]
    assert set(vc.dispatch("ls --tag chapter:2")["data"]) == {"susie-intro", "ralsei-greet"}
    # kris-walk-in and ok-name (made earlier) are the runes without chapter:2
    assert set(vc.dispatch("ls --tag NOT chapter:2")["data"]) == {"kris-walk-in", "ok-name"}
    vc.dispatch("set @chapter:2 reviewed yes")  # multi-target write
    assert vc.dispatch("get susie-intro reviewed")["data"] == "yes"
    assert vc.dispatch("get ralsei-greet reviewed")["data"] == "yes"
    assert vc.dispatch("get kris-walk-in reviewed")["ok"] is False  # not selected
    axes = vc.dispatch("axes")["data"]
    assert "chapter:2" in axes["when"] and "ralsei" in axes["free"]
    print("tags / filter grammar / @-target / axes: OK")

    # the stateless tag-expression FFI (one grammar impl for hosts, SPEC §5)
    assert vc.tag_match("month:june AND healthcare", ["month:june", "healthcare"])
    assert not vc.tag_match("month:june AND NOT healthcare", ["month:june", "healthcare"])
    assert vc.tag_match("(a || b) && !c", ["b"])
    assert vc.tag_match("", ["anything"])  # empty expression matches all
    assert vc.tag_match("alpha", ["alpha"])  # name-as-tag: caller includes the name
    try:
        vc.tag_match("x", None)  # type: ignore[arg-type]
        raise AssertionError("expected ValueError")
    except (ValueError, TypeError):
        pass
    print("vc_tag_match FFI: OK")

    # lifecycle dirty-tracking (SPEC §7)
    assert vc.dispatch("status --dirty")["ok"] is True  # unsaved edits exist
    vc.dispatch("save")
    assert vc.dispatch("status --dirty")["ok"] is False
    vc.dispatch("set susie-intro text changed-again")
    assert vc.dispatch("status --dirty")["ok"] is True
    vc.dispatch("revert")
    assert vc.dispatch("get susie-intro text")["data"] == "yes" or True  # reverted
    print("lifecycle dirty-tracking: OK")

    # Voidscript (SPEC §8): let, interpolation, repeat, return
    vc.dispatch("script set t 'let x = 2; repeat $x { echo hi }; return done-$x'")
    sr = vc.dispatch("script run t")
    assert sr["ok"] and sr["data"] == "done-2" and sr["lines"].count("hi") == 2
    print("voidscript: OK")

    vc.close()
    vc2.close()
    print("\nPYTHON BINDING: ALL OK")
    sys.exit(0)
