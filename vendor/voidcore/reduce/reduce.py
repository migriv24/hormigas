"""
reduce/reduce.py — the Reduce layer: the interaction-net executor (graph rewriter).

Reduce fires a [mantle](okf/concepts/mantle.md)'s interaction rules on active pairs until
no rule applies (**normal form**), producing a **derived** net — the source is never
touched. It is the executor [interaction nets](okf/concepts/interaction-nets.md) reserved.
Design + fork resolutions: `notes/reducer.md`.

The shape (resolved forks):
- **Restricted confluent subset** (fork 2): at most one rule per *unordered glyph pair*,
  principal-to-principal, local. Strong confluence holds **by construction** there — the
  normal form is unique regardless of reduction order. Uniqueness is enforced at
  registration (a duplicate pair raises).
- **`reduce(net) -> net`** (fork 3): pure; emits no effects (those live at the holiday
  boundary). Functional — returns a derived net, never mutates the source (fork 5:
  explicit + previewable).
- **Active pairs only reduce** (fork 1): a wire joining two principal ports whose glyphs
  have a rule. Everything else is inert, so feedback cycles are preserved for free; the
  host may also mark agents **opaque** (by glyph or id). Termination is not guaranteed in
  general (interaction combinators are Turing-complete), so a `max_steps` guard raises
  `ReduceError`.

A **rule** is `fn(a, b, fresh) -> Rewrite`: given the two redex agents (in the order the
rule was registered) and a fresh-id minter, return new agents + new wires. Wires address
the redex's freed auxiliary ports symbolically with `A(i)` / `B(i)` (the *external*
partner of a's / b's aux port i), or a new agent's port `(id, idx)` directly. This is the
locality discipline: a rule only rewires the redex's own ports.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from net import Agent, Net, NetError, Port


class ReduceError(RuntimeError):
    """Reduction exceeded `max_steps` (a non-terminating rule set) or a rule was malformed."""


# ── symbolic references to the redex's freed external ports ───────────────────────
@dataclass(frozen=True)
class Ext:
    side: str   # 'A' or 'B'
    port: int   # aux index 1..arity


def A(i: int) -> Ext:
    """The external partner of redex-agent A's aux port i (use in a Rewrite link)."""
    return Ext("A", i)


def B(i: int) -> Ext:
    """The external partner of redex-agent B's aux port i."""
    return Ext("B", i)


PortRef = "Ext | Port"  # an Ext, or a concrete (agent_id, idx) for a new agent


@dataclass
class Rewrite:
    """The right-hand side of an interaction rule: agents to introduce and the wires that
    reconnect the redex's freed ports. Linearity is checked when applied."""
    new_agents: list[Agent] = field(default_factory=list)
    links: list[tuple] = field(default_factory=list)   # (PortRef, PortRef)


Rule = Callable[[Agent, Agent, Callable[[], str]], Rewrite]


# ── the reducer ───────────────────────────────────────────────────────────────────
@dataclass
class Reducer:
    # key: frozenset({ga, gb}) -> (ga, gb registered order, fn). One rule per pair.
    rules: dict = field(default_factory=dict)

    def rule(self, ga: str, gb: str, fn: Rule) -> "Reducer":
        """Register the (single) rule for the unordered glyph pair {ga, gb}. Raises on a
        duplicate — this *is* the confluence conflict guard (fork 2)."""
        key = frozenset((ga, gb))
        if key in self.rules:
            raise ValueError(f"a rule for the pair {set(key)} is already registered "
                             f"(at most one rule per glyph pair — confluence guard)")
        self.rules[key] = (ga, gb, fn)
        return self

    # ── active pairs ───────────────────────────────────────────────────────────────
    def active_pairs(self, net: Net, opaque: set[str]) -> list[tuple[str, str]]:
        """Unordered (a_id, b_id) pairs joined principal-to-principal with a rule, neither
        opaque. Sorted for a canonical default schedule."""
        seen = set()
        out = []
        for a in net.agents.values():
            if a.id in opaque or a.glyph in opaque:
                continue
            q = net.partner((a.id, 0))
            if q is None or q[1] != 0 or q[0] == a.id:
                continue
            b = net.agents[q[0]]
            if b.id in opaque or b.glyph in opaque:
                continue
            if frozenset((a.glyph, b.glyph)) not in self.rules:
                continue
            key = tuple(sorted((a.id, b.id)))
            if key not in seen:
                seen.add(key)
                out.append(key)
        return sorted(out)

    # ── one rewrite step ─────────────────────────────────────────────────────────
    def _fire(self, net: Net, a_id: str, b_id: str, fresh: Callable[[], str]) -> None:
        a, b = net.agents[a_id], net.agents[b_id]
        ga, gb, fn = self.rules[frozenset((a.glyph, b.glyph))]
        # present agents to the rule in its registered order
        if a.glyph != ga or b.glyph != gb:
            a, b = b, a
        # snapshot external partners of the redex's aux ports *before* deletion
        ext = {
            "A": {i: net.partner((a.id, i)) for i in range(1, a.arity + 1)},
            "B": {i: net.partner((b.id, i)) for i in range(1, b.arity + 1)},
        }
        redex = {a.id, b.id}
        rw = fn(a, b, fresh)

        def resolve(ref):
            if isinstance(ref, Ext):
                p = ext[ref.side].get(ref.port)
                if p is not None and p[0] in redex:
                    raise ReduceError(
                        f"rule for {set((ga, gb))} referenced {ref.side}({ref.port}), "
                        f"which is an internal redex wire ({p}) — rules may only rewire "
                        f"ports leading *out* of the redex (locality).")
                return p  # may be None == that boundary was free
            return ref  # a concrete (id, idx) on a new agent

        net.remove_agent(a.id)
        net.remove_agent(b.id)
        for ag in rw.new_agents:
            net.add(ag)
        for r1, r2 in rw.links:
            p, q = resolve(r1), resolve(r2)
            if p is None or q is None:
                continue  # a freed boundary stays free
            net.connect(p, q)

    # ── reduce to normal form ──────────────────────────────────────────────────────
    def reduce(self, net: Net, *, max_steps: int = 100_000,
               opaque: Optional[set] = None,
               pick: Optional[Callable[[list], tuple]] = None) -> Net:
        """Reduce `net` to normal form, returning a **new** net (source untouched).
        `opaque` freezes agents by id or glyph; `pick` chooses the next redex from the
        available list (default: canonical first — confluence makes the choice immaterial
        on the restricted subset). Raises `ReduceError` past `max_steps`."""
        work = net.copy().check()
        opq = set(opaque or ())
        choose = pick or (lambda pairs: pairs[0])
        cnt = [0]

        def fresh() -> str:
            cnt[0] += 1
            return f"_r{cnt[0]}"

        steps = 0
        while True:
            pairs = self.active_pairs(work, opq)
            if not pairs:
                return work
            steps += 1
            if steps > max_steps:
                raise ReduceError(
                    f"exceeded max_steps={max_steps}; the rule set is non-terminating on "
                    f"this net (interaction combinators are Turing-complete — supply a "
                    f"terminating rule set, or mark agents opaque).")
            a_id, b_id = choose(pairs)
            self._fire(work, a_id, b_id, fresh)

    # ── a confluence/conflict report for the restricted subset ────────────────────
    def validate(self, signatures: Optional[dict] = None) -> list[str]:
        """Report potential confluence hazards. By construction there is ≤1 rule per glyph
        pair (uniqueness is structural). With `signatures`, also flags `annihilate` pairs
        whose glyphs have mismatched arity (the cross-link would be ill-formed)."""
        issues = []
        for key, (ga, gb, fn) in self.rules.items():
            if signatures and getattr(fn, "_annihilate", False):
                if signatures.get(ga, 0) != signatures.get(gb, 0):
                    issues.append(f"annihilate rule {set(key)}: arity "
                                  f"{signatures.get(ga,0)} != {signatures.get(gb,0)}")
        return issues


# ── rule constructors ──────────────────────────────────────────────────────────────
def annihilate() -> Rule:
    """The classic *annihilation*: a same-glyph active pair vanishes, cross-linking matched
    aux ports `A(i) <-> B(i)`. Both agents must share arity (use for γγ/δδ; for ε, arity 0,
    the pair simply disappears — erasure)."""
    def fn(a: Agent, b: Agent, fresh) -> Rewrite:
        if a.arity != b.arity:
            raise ReduceError(f"annihilate needs equal arity: {a.glyph}/{b.glyph} "
                              f"have {a.arity}/{b.arity}")
        return Rewrite(links=[(A(i), B(i)) for i in range(1, a.arity + 1)])
    fn._annihilate = True  # type: ignore[attr-defined]
    return fn


def commute() -> Rule:
    """The classic *commutation*: distinct-glyph principals meeting spawn a grid of copies
    (this is how duplication/structure propagates through a net). For α (arity m) meeting
    β (arity n): m copies of β take α's external aux ports, n copies of α take β's, and the
    copies interconnect in an m×n grid."""
    def fn(a: Agent, b: Agent, fresh) -> Rewrite:
        m, n = a.arity, b.arity
        # m copies of b (one per a's aux port), n copies of a (one per b's aux port)
        bcopies = [Agent(fresh(), b.glyph, n, dict(b.content)) for _ in range(m)]
        acopies = [Agent(fresh(), a.glyph, m, dict(a.content)) for _ in range(n)]
        links: list[tuple] = []
        for k in range(m):                       # b-copy k -> a's external aux (k+1)
            links.append(((bcopies[k].id, 0), A(k + 1)))
        for j in range(n):                       # a-copy j -> b's external aux (j+1)
            links.append(((acopies[j].id, 0), B(j + 1)))
        for j in range(n):                       # the m×n internal grid
            for k in range(m):
                links.append(((acopies[j].id, k + 1), (bcopies[k].id, j + 1)))
        return Rewrite(new_agents=bcopies + acopies, links=links)
    return fn


def expand(build: Callable[[Agent, Agent, Callable[[], str]], Rewrite]) -> Rule:
    """A reference-expansion rule (Fountain's 'inline a fragment'): the active pair is
    consumed and replaced by whatever subnet `build` returns. Transient by definition —
    re-derived each reduction, never written to owned state (that's `materialize`, in Scry)."""
    return build
