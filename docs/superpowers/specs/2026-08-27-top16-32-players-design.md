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

### Playoff bracket seeding — two independent streams, corrected from initial design

**Correction from the version approved in chat:** the first pass at this section described a
"pod" model (a group-pair's two qualifiers reconverge one round later). Deriving the exact
generalized algorithm and checking it against the real hardcoded `PLAYOFFS` array line-by-line
showed that isn't what the existing code does. The real invariant is stronger: every group's two
qualifiers are placed in two entirely separate halves of the bracket from round one, so they can
only ever meet in the Grand Final, never earlier. This section replaces the pod description with
the correct one. It changes nothing about outcomes already agreed — 16-player mode stays exactly
today's tool, 32-player mode still guards against early same-group rematches (more strongly, not
less).

Two independent "streams" run through the whole bracket — **primary** and **mirror**. For each
group pair `(X,Y)` (groups taken two at a time: A&B, C&D, …): the primary stream's first-round
match is `1st(X) v 2nd(Y)`; the mirror stream's is `1st(Y) v 2nd(X)`. Each stream is then
single-eliminated entirely on its own, independent of the other stream, down to one stream
champion. The two stream champions meet **only in the Grand Final**. Since a group's 1st always
lands in the primary stream and its 2nd always lands in the mirror stream (or vice versa,
depending on the pair), the two can never face each other before the Final.

For `groupCount:4` (today's shape, 2 group pairs → 2 matches per stream): this reproduces
`qf1`..`qf4`, `sf1`, `sf2`, `f` exactly as they exist today, key-for-key and label-for-label —
confirmed by direct comparison against the current hardcoded `PLAYOFFS` array:

```
primary stream:  qf1 = 1A v 2B  ┐
                  qf2 = 1C v 2D  ┴─ sf1 = winner qf1 v winner qf2
mirror stream:   qf3 = 1B v 2A  ┐
                  qf4 = 1D v 2C  ┴─ sf2 = winner qf3 v winner qf4

f = winner sf1 v winner sf2
```

For `groupCount:8` (32 players, 4 group pairs → 4 matches per stream, one extra round):

```
primary stream:  r16-1 = 1A v 2B  ┐                    ┐
                  r16-2 = 1C v 2D  ┴─ qf1                │
                  r16-3 = 1E v 2F  ┐                    ┴─ sf1
                  r16-4 = 1G v 2H  ┴─ qf2                │
mirror stream:   r16-5 = 1B v 2A  ┐                    ┐
                  r16-6 = 1D v 2C  ┴─ qf3                │
                  r16-7 = 1F v 2E  ┐                    ┴─ sf2
                  r16-8 = 1H v 2G  ┴─ qf4                │

f = winner sf1 v winner sf2
```

(each `qfN`/`sfN` here is "winner of the two matches directly above it," same halving pattern as
the 4-group case, just with one more round beneath it.)

Match keys: `r16-1`..`r16-8` are new (32-player mode only); `qf1`..`qf4`, `sf1`, `sf2`, `f` mean
the same thing in both modes — "N-th match of this round" — which is what keeps the
WhatsApp-export and edit-invalidation code able to walk "the playoff round after group stage"
generically without a groupCount-specific branch.

### Bracket generation is programmatic, not hardcoded per size

`GROUPS` and `PLAYOFFS` (today: two hardcoded arrays) become the output of one function,
`t16BuildBracket(groupCount)`, built from the primary/mirror-stream model above:

1. Group letters two at a time into pairs (`groupCount/2` pairs: for `groupCount:4`, (A,B) and
   (C,D); for `groupCount:8`, (A,B), (C,D), (E,F), (G,H)).
2. Build the primary stream's first-round matches: one `1st(X) v 2nd(Y)` per pair.
3. Build the mirror stream's first-round matches: one `1st(Y) v 2nd(X)` per pair.
4. Each stream is single-eliminated independently (winner of stream match `2k` v winner of
   stream match `2k+1`, repeating until each stream has one champion match).
5. The two streams' champion matches feed one final match: `winner(primary champion) v
   winner(mirror champion)`.

Because there are only ever two supported sizes, the function branches once on `podCount`
(`groupCount/2`, either 2 or 4) rather than being written as an arbitrary-depth recursive
structure — for `podCount:2` this directly produces `qf1..qf4, sf1, sf2, f` (verified
key-for-key and label-for-label against today's hardcoded `PLAYOFFS`); for `podCount:4` it
produces `r16-1..r16-8` ahead of the same `qf1..qf4, sf1, sf2, f` shape. Every match's key,
display label (e.g. `"QF1"`, `"Semifinal 1"`, `"Grand Final"`), and "waiting on" hint text (e.g.
`"1st Group A"`, `"Winner QF1"`) are computed together so nothing is hand-duplicated per size.

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
   Top-16 playoff bracket (R16 → QF → SF → Final) both seeds and plays correctly per the
   primary/mirror-stream model above (a group's two qualifiers never face each other before the
   Final). Run one full synthetic tournament to a champion.
3. Confirm editing an early result (a group match, and an `r16-` match) correctly clears every
   downstream result and only those.
4. Confirm the WhatsApp export text is well-formed for both sizes.
5. Confirm a previously-saved 16-player `data.top16` (no `groupCount` key) still loads and renders
   correctly after this change ships.
