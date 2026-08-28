# GNL Knockout — design

## Problem

The organiser wants a second bracket tool, independent of GNL Top 16 (which is GSL-groups-based):
a pure single-elimination knockout for up to 32 players (and as few as 8) that cuts round by round
until exactly 8 players remain, then switches to a standard double-elimination bracket for that
Top 8, including a bracket-reset Grand Final if the losers'-bracket finalist forces it.

## Chosen approach

A new sibling tool, **GNL Knockout**, living in its own IIFE module in `index.html`
(`// ==================== GNL KNOCKOUT ====================`), its own tab, and its own
`data.knockout` state key — structurally parallel to `GNL TOP 16` but not sharing code with it
(the two brackets' shapes are different enough that forcing a shared abstraction would cost more
than it saves; both independently reuse the same *proven UI conventions* — score-input match
rows, two-click edit/reset, downstream-invalidation-on-edit, WhatsApp export, Gist sync via
`save()` — established by `GNL TOP 16` and, before it, the Judges tool).

### Player count and bracket sizing

- Minimum 8 players, maximum 32 (confirmed: below 8 there's no meaningful "cut to Top 8").
- Organiser enters names in any order — no seeding. This is a blind random draw, not a ranked
  bracket: the tool shuffles the entered names itself.
- **Bracket size** = the next power of two ≥ player count, floored at 8: 8→8 (no byes), 9-16→16,
  17-32→32. E.g. 20 players → a 32-slot bracket with 12 byes.
- **Byes**: `(bracket size − player count)` slots are marked `BYE` and randomly interleaved with
  the shuffled real names across the bracket's slots. A bye is a walkover: the real player in that
  first-round pairing advances automatically, with no match to score. Byes exist only in the very
  first single-elimination round — every round after that has a full field of real, already-won
  players (a bracket, once trimmed of byes, is always a clean power of two by construction).

### Single-elimination phase

Standard bracket halving: round 1 has `bracketSize/2` matches, each subsequent round halves the
previous round's winner count, **continuing only while more than 8 players remain**. Concretely:
starting from 8 players plays zero single-elimination rounds (straight to the Top 8 draw); from
9–16 plays exactly one round; from 17–32 plays exactly two rounds. Round labels describe how many
players entered that round ("Round of 32", "Round of 16"); match keys are
`se-<playersEnteringRound>-<matchIndex>`, e.g. `se-32-1`..`se-32-16`, then `se-16-1`..`se-16-8`.

A bye match (one side is literally `BYE`) needs no score entered — the real player's advancement
is resolved the instant the bracket is built, the same way a group's seeding is known immediately
in GNL Top 16. The match card shows "`<Name>` advances — bye" instead of score inputs.

### The Top 8 draw

Once the single-elimination phase has produced exactly 8 survivors, the setup screen shows a
**"🎲 Draw the Top 8"** button (an explicit, deliberate action — mirroring GNL Top 16's explicit
"Start Group Stage" click rather than auto-transitioning). Clicking it **re-shuffles those 8
survivors from scratch** into a fresh double-elimination bracket — the single-elimination phase
only decided *who* made the cut, not their double-elimination seeding, which is drawn independent
of bracket path.

### Double-elimination phase (fixed 8-player structure)

```
Winners bracket:  wb-qf1..4 (4)  →  wb-sf1,wb-sf2 (2)  →  wb-f (1)
Losers bracket:   lb-r1-1,lb-r1-2 (2: the 4 wb-qf losers, paired)
                  → lb-r2-1,lb-r2-2 (2: lb-r1 winners vs the 2 wb-sf losers)
                  → lb-sf (1: the 2 lb-r2 winners)
                  → lb-f (1: lb-sf winner vs the wb-f loser)
Grand Final:      gf (1: wb-f winner vs lb-f winner)
                  gf2 (conditional — only if the lb-f winner wins gf, since the wb-f winner
                       then also has exactly 1 loss and both sides are still alive)
```

14 matches if no reset is needed, 15 if `gf2` is played. `gf2`'s match card does not render at
all until `gf` has a result **and** the loser of `gf` came from the losers bracket (i.e., the
winners-bracket finalist lost `gf`) — if the winners-bracket finalist wins `gf` outright, the
tournament ends there and `gf2` never appears.

### Edit-invalidation

Same principle as GNL Top 16's `t16Downstream`: editing any match clears its own result plus
every match that structurally depends on it, computed from a small dependency graph built the
same way `t16BuildBracket`'s is — not hand-maintained per match. A bye "match" cannot be edited
(there was never a real result to change).

### State shape

```json
{
  "bracketSize": 16,
  "slots": ["Name1", "BYE", "Name2", "Name3", "..."],
  "seResults": { "se-16-1": {"a":2,"b":0}, "...": "..." },
  "de8": null,
  "startedAt": "...",
  "updatedAt": "..."
}
```

`de8` is `null` until the "Draw the Top 8" button is clicked, then becomes:

```json
{
  "players": ["SurvivorA", "...8 total..."],
  "results": { "wb-qf1": {"a":2,"b":1}, "...": "..." },
  "drawnAt": "..."
}
```

Keeping `seResults`/`de8.results` as two separate result maps (rather than one flat namespace)
means the two phases' match keys can never collide even though both phases reuse short keys, and
mirrors the state boundary the UI itself enforces (you cannot edit a single-elimination match
after the Top 8 has been drawn — the whole `de8` object would need clearing first, which is out of
scope: redrawing is not undoable, matching the "irreversible, ask first" norm already implicit in
GNL Top 16's own two-click "Reset Tournament").

### WhatsApp export, Gist sync, reset

All three follow GNL Top 16's exact established shape: `save(data)` after every recorded result
(persists locally and syncs to the Gist); a "📋 Copy Status for WhatsApp" button producing a
text summary (bracket progress, then Top 8 double-elim bracket once drawn, then champion); a
two-click-armed "🗑 Reset Tournament" that clears `data.knockout` entirely.

## Out of scope

- No seeding by league standing — this tool is explicitly a blind random draw (unlike a possible
  future seeded variant, which is not being built now).
- No support for byes inside the double-elimination phase — the Top 8 is always exactly 8 real
  players by construction (it can only be drawn once the single-elimination phase has produced
  exactly 8 survivors).
- No 3rd-place match — the losers'-bracket finalist who loses `lb-f` is eliminated without a
  separate placement match, matching how GNL Top 16 doesn't play one either.
- No cross-tool interaction with GNL Top 16 — fully independent data (`data.knockout` vs
  `data.top16`), fully independent module, no shared bracket-building code (see Chosen approach).

## Testing

No committed automated test suite (per `CLAUDE.md`). Manual verification after implementation:

1. Start an 8-player tournament (no byes) — confirm the Top 8 draw button appears immediately,
   with zero single-elimination rounds played.
2. Start a 20-player tournament — confirm a 32-slot bracket with 12 byes, byes auto-advance with
   no score entry, two single-elimination rounds play down to 8 survivors, then the Top 8 draw
   re-shuffles them.
3. Play a full double-elimination bracket to a champion **without** triggering a reset (winners-
   bracket finalist wins `gf` outright) — confirm `gf2` never renders.
4. Play a second full double-elimination bracket **with** a reset (losers-bracket finalist wins
   `gf`) — confirm `gf2` appears and decides the champion correctly.
5. Confirm editing an early single-elimination result correctly clears every downstream match
   (both remaining single-elimination rounds and, if already drawn, does NOT touch `de8` — that
   boundary is enforced structurally per the State shape section).
6. Confirm editing a `wb-qf` result after some `lb` matches are already recorded correctly clears
   the dependent losers'-bracket and Grand Final matches.
7. Confirm the WhatsApp export text is well-formed at every stage (single-elimination in
   progress, Top 8 drawn but not started, mid double-elimination, champion decided).
