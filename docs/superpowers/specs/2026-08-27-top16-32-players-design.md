# GNL Top 16 — support 32 players — design

## Problem

The GNL Top 16 tool (`index.html`, `// ==================== GNL TOP 16 ====================`)
runs a fixed-size playoff: 4 groups of 4 (GSL format — Match1/Match2/Winners/Losers/Decider,
top 2 advance) feeding a fixed 7-match Top-8 single-elimination bracket. Both the group count and
the entire playoff bracket shape (`GROUPS`, `PLAYOFFS`, `t16Downstream`) are hardcoded for exactly
4 groups / 8 playoff qualifiers. The organiser wants to run a 32-player edition — 8 groups feeding
a Top-16 playoff — without losing the ability to run a 16-player edition.

## Chosen approach

Generalize the tool to a selectable size (16 or 32 players, chosen at setup), rather than replacing
the 16-player format outright. `t16State` gains a `groupCount: 4|8` field. Every previously-hardcoded
4-group assumption becomes a value derived from `groupCount`. A tournament saved before this change
has no `groupCount` key and is treated as `4` — today's exact behavior, no migration needed.

### Group stage (unchanged in format, just repeated)

The GSL per-group format (Match1 = Seed1 v Seed4, Match2 = Seed2 v Seed3, then
Winners/Losers/Decider, top 2 advance) is untouched. `GROUPS` becomes `['A','B','C','D']` for
`groupCount:4` or `['A'..'H']` for `groupCount:8`, generated from `groupCount` rather than a fixed
literal.

### Playoff bracket seeding — the pod rule, applied one level deeper

The existing scheme pairs groups into **pods of 2**. For pod (A,B): first-round matches are
`1A v 2B` and `1B v 2A`; their winners meet in that pod's next round. This delays a group's own
1st/2nd rematching by (at least) one round, without hard-forbidding it later. For `groupCount:4`
(today's shape) there are exactly 2 pods (AB, CD), each pod's mini-bracket winner goes straight to
a Semifinal, and the two Semifinal winners meet in the Final — this is exactly today's `qf1..qf4,
sf1, sf2, f` structure, unchanged, with unchanged match keys for backward compatibility with saved
tournaments.

For `groupCount:8` (32 players), the same pod rule is applied one level deeper: **4 pods of 2
groups each** (AB, CD, EF, GH). Each pod runs its own mini-bracket:

```
R16-1: 1A v 2B   ┐
R16-2: 1B v 2A   ┴─ QF1 (pod AB final)
R16-3: 1C v 2D   ┐
R16-4: 1D v 2C   ┴─ QF2 (pod CD final)
R16-5: 1E v 2F   ┐
R16-6: 1F v 2E   ┴─ QF3 (pod EF final)
R16-7: 1G v 2H   ┐
R16-8: 1H v 2G   ┴─ QF4 (pod GH final)

SF1: winner QF1 v winner QF2   (pod AB/CD side)
SF2: winner QF3 v winner QF4   (pod EF/GH side)
F:   winner SF1 v winner SF2
```

Match keys: `r16-1`..`r16-8` are new; `qf1`..`qf4`, `sf1`, `sf2`, `f` are reused with the same
meaning they already have today (a pod-final rather than a group-final, but the same *role* in the
bracket — this keeps the WhatsApp-export and edit-invalidation code able to treat "the playoff
round after group stage" generically without a groupCount-specific branch for label text).

### Bracket generation is programmatic, not hardcoded per size

`GROUPS` and `PLAYOFFS` (today: two hardcoded arrays) become the output of one function,
`t16BuildBracket(groupCount)`, which:

1. Builds `groupCount` pods of 2 adjacent groups each (`groupCount/2` pods).
2. Builds the first playoff round: for each pod `(X,Y)`, two matches `1X v 2Y` and `1Y v 2X`.
3. Builds every subsequent round as the standard single-elimination halving of the previous
   round's winners (winner of match `2k` v winner of match `2k+1`), continuing until 1 match (the
   Final) remains.

For `groupCount:4` (2 pods), round 1 has 2×2=4 matches — this is exactly today's `qf1..qf4`, with
round 2 (2 matches) as `sf1,sf2` and round 3 (1 match) as `f`: today's shape, produced rather than
hand-written. For `groupCount:8` (4 pods), round 1 has 8 matches (`r16-1..r16-8`), round 2 has 4
(`qf1..qf4`), round 3 has 2 (`sf1,sf2`), round 4 has 1 (`f`). Round *labels* (`R16`, `QF`, `SF`, `Grand Final`) are assigned
by how many matches are in each round (8→"R16", 4→"QF", 2→"SF", 1→"Grand Final"), not hardcoded per
groupCount, so the same labeling function serves both sizes without a branch.

### Edit-invalidation (`t16Downstream`)

Currently a hand-written chain for the fixed 4-group/Top-8 shape. Replaced with a walk over the
bracket structure `t16BuildBracket(groupCount)` returns: given a match key, downstream is every
match (in-group chain, then every later playoff round) that structurally depends on it, computed
from the bracket graph rather than pattern-matched per size. Behavior for `groupCount:4` is
unchanged — the graph the walk operates on is identical to today's hardcoded chain, it's just
derived instead of hand-written.

### Setup UI

A "16 players / 32 players" toggle at the top of the setup screen, defaulting to 16 (matching
today's only option). Choosing 32 renders 8 group-cards (A–H) of 4 seed inputs each instead of 4;
choosing 16 renders exactly what exists today. The toggle sets `groupCount` (4 or 8) on
`t16State` when the tournament is started, and is not editable afterward (matches the existing
"setup, then locked in" flow — there's no path today to change group count mid-tournament, and
none is being added).

### WhatsApp export

`t16WhatsAppText()` already loops over `GROUPS`; it gains a loop over `t16BuildBracket(groupCount)`'s
rounds instead of the current hardcoded `PLAYOFFS` array iteration. Output format (labels, winner
lines, champion banner) is unchanged — only the size of what's iterated changes.

## Out of scope

- No change to the GSL per-group format itself (still exactly 4 players, Match1/Match2/W/L/D).
- No change to how a group's results are entered, edited, or the two-click reset/edit-arm pattern.
- No change to the Settings/Gist sync mechanism — `t16SaveState()` is untouched.
- No retroactive migration of saved 16-player tournaments — they keep working exactly as before by
  defaulting `groupCount` to 4 when absent.
- This tool's playoff bracket stays single-elimination throughout (explicitly confirmed) — it does
  **not** adopt the new separate bracket tool's single→double-elimination-at-Top-8 behavior. The
  two tools share no code by this change; if useful overlap emerges later it can be extracted then.

## Testing

No committed automated suite (per CLAUDE.md). Manual verification after implementation:

1. Start a 16-player tournament — confirm setup, group play, and Top-8 playoffs render and behave
   identically to the current deployed tool (same labels, same seeding, same edit/reset behavior).
2. Start a 32-player tournament — confirm 8 group cards render, group play works for all 8, and the
   Top-16 playoff bracket (R16 → QF → SF → Final) both seeds and plays correctly per the pod rule
   above. Run one full synthetic tournament to a champion.
3. Confirm editing an early result (a group match, and an `r16-` match) correctly clears every
   downstream result and only those.
4. Confirm the WhatsApp export text is well-formed for both sizes.
5. Confirm a previously-saved 16-player `data.top16` (no `groupCount` key) still loads and renders
   correctly after this change ships.
