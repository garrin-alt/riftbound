# Rework "League Standings" into GNL: Vendetta Event Day, scope Awards to current set

## Context

The site has two unrelated scoring systems living side by side:

1. **The legacy "League Standings" tab** (`#tab-league`) — a melee-CSV-upload season
   tracker from an older league format. Scores each event with three components (Match
   Points `mp`, Placement Points `pp`, Attendance Points `ap`), sums them per player
   across events, and supports a "drop worst event" mechanic. Built around
   `buildStandings()` ([index.html:3030](../../../index.html)), `renderLB`/`renderEvents`,
   `exportCSV`, and a "Reset All Data" button. Nobody runs leagues this way anymore.
2. **GNL: Vendetta** — the real, current ladder. Win/draw/loss scores 3/1/0
   (`rvScoreRound`), fed by the "Event Day" workflow that today lives inside the
   **Rivalry Analyzer** tab (`#rvtab-eventday`, roughly [index.html:1613-1695](../../../index.html)):
   upload attendance → Generate Vendettas → Record Results & Award League Points →
   Post-Event Processing (for events nobody was around to record live). Its JS spans
   roughly [index.html:5421](../../../index.html) to [index.html:6700](../../../index.html),
   including `rvApplyRoundToRivalry`.

This is confusing: the prominent, first sidebar item ("League Standings", 🏆, top of the
nav) is the *dead* system, while the *live* GNL: Vendetta event-processing workflow is
buried inside a sub-tab of Rivalry Analyzer.

Separately, **Awards** (`rvComputeAwards`, [index.html:2554](../../../index.html)) are
computed from `rivalry.h2h`, an all-time aggregate spanning every Riftbound set the
league has ever played (Origins → Spiritforged → Unleashed → Vendetta). For the current
Vendetta set, awards should only reflect matches played in that set.

## Goals

1. Delete the legacy melee-CSV League Standings system entirely — markup, JS, scoring
   logic, exports.
2. Physically relocate the Event Day workflow (attendance/Vendetta generation, live
   result recording, post-event batch processing) from Rivalry Analyzer's `#rvtab-eventday`
   sub-tab into the `#tab-league` panel, keeping the top-level 🏆 sidebar slot as its new
   home. This is a move, not a duplication — the code is removed from Rivalry Analyzer.
3. Scope all computed Awards to the current Riftbound set only (`vendetta`), so a
   player's award-eligible stats reset in practice at each new set, without requiring a
   manual reset step each time the set rolls over.

## Non-goals

- No change to GNL: Vendetta's scoring rule (3/1/0), Vendetta-pairing algorithm, or the
  ledger/aggregate dual-record design.
- No change to which awards exist or their thresholds — only the data they're computed
  from.
- No "League event" vs. "non-League event" distinction — the ledger has no such tag
  today, and this spec doesn't add one. Scoping is by **set** only.
- Organiser overrides and custom awards are unaffected — they already bypass computed
  data entirely.

## Part 1 — Remove the legacy League Standings system

Delete:
- The `#tab-league` markup's upload zone, Events card, Roster card, Export/Reset card
  (roughly [index.html:975-1020](../../../index.html) and whatever the panel contains
  below that).
- `buildStandings`, `renderLB`, `renderEvents`, `renderRoster`, `renderTicketPool` (if
  exclusively used here), `exportCSV`, `getWorstEvent`, `playerDrops`, and any other
  function that exists solely to serve this feature.
- The CSV-parsing path feeding `fileIn`/`adminGate('import'|'rosterAll'|'rosterNone'|'reset'|'remove')`
  for this feature specifically — but only the parts private to League Standings.
  `adminGate` itself is shared infrastructure and stays.

Verify via `grep`/search that no other tab (Raffle, TCG Raffle, Player Stats, etc.)
calls into any of the above before deleting — the implementer must confirm each function
has no other caller, not assume it from this spec.

## Part 2 — Move Event Day into `#tab-league`

- Relocate the DOM block currently at `#rvtab-eventday`
  ([index.html:1613-1695](../../../index.html)) into `#tab-league`, replacing the deleted
  legacy content. Update the panel title (currently "League Standings") and
  `panel-desc` to describe the new purpose, e.g. "GNL: Vendetta — Event Day" /
  "Run tonight's league night: declare Vendettas, record results, or process a past event."
  Exact copy is an implementation judgment call, not specified further here.
- Relocate every function that exists solely to serve this workflow (Vendetta
  generation/pairing UI glue, `rvApplyRoundToRivalry` callers, live-record and
  post-event-processing handlers) out of the Rivalry Analyzer IIFE scope to wherever it
  needs to live to be reachable from the new tab — respecting the existing module-boundary
  rules in `CLAUDE.md` (top-level functions reachable from `window`, IIFE-internal
  functions are not).
- Remove the `#rvtab-eventday` sub-tab and its nav entry from Rivalry Analyzer. Rivalry
  Analyzer keeps its other sub-tabs (Rivalries, Leaderboard, Awards, etc.) untouched.
- `showTab('league')` must call whatever init function the relocated code needs on every
  visit (per the existing `pdInit`/`jdInit`-style pattern: merge remote state with
  unsaved local state, never blindly replace it).
- The sidebar nav item keeps its `id="snav-league"` and 🏆 icon; only its label text
  changes (e.g. "GNL: Vendetta" or "Event Day" — implementer's call, confirm with user
  if unsure).
- All existing behavior of the Event Day workflow (declared-Vendetta persistence to Gist,
  live round recording with Swiss/Playoff toggle, post-event multi-round batch processing,
  the "Process Event"/"Save to Gist" button flow) must work identically after the move —
  this is a relocation, not a rewrite of behavior.

## Part 3 — Scope Awards to the current set

In `rvComputeAwards(rivalry, hist)`:

- Determine the current set id via the existing `currentSetId(hist)`-style helper
  ([index.html:2144](../../../index.html)).
- Where the ledger is populated (`led` is non-null), derive the current-set slice with
  `rvDeriveFromLedger(hist, { set: currentSetId })` and use **that** as the `h2h` source
  for every award computation, instead of `rivalry.h2h`.
- **Attendance** (`rivalry.attendance`) and **`vendettaWins`** (`rivalry.rivalryPoints`)
  are not currently set-tagged — they're lifetime dicts keyed by player name. The
  Caretaker and Vendetta awards must be re-derived from the ledger's current-set slice
  instead (per-player event count and grudge-match win count for events tagged with the
  current set), not read from those lifetime dicts, so they honor the same set boundary
  as everything else.
- Where the ledger is **not** populated (`led` is null) — no chronological data exists at
  all — fall back to the existing all-time `rivalry.h2h` behavior as today, since there's
  no way to slice by set without the ledger. This matches the existing pattern where
  ledger-only awards already show as locked/pending without a ledger; the difference here
  is that the *aggregate*-sourced awards (Giant Slayer, Mirror Match, Godlike, Hound,
  Caretaker, Vendetta) keep working but without set-scoping until history is uploaded —
  same as today's behavior, not a regression.
- The three ledger-only awards (Ascension, Unstoppable, Glorious Executioner) already
  run entirely off the ledger; apply the same `{set: currentSetId}` filter to their
  derivation so they too reflect only the current set.
- "Giants" (the top-quartile tier other awards measure against) must be recomputed from
  the same current-set player table, not the lifetime one — a player's Giant status
  should reflect their form in the current set.
- No new persisted state, no migration step, and no manual "reset" action — this is a
  permanent change to how `rvComputeAwards` sources its data. When a new set becomes
  current in `hist.sets`, awards naturally start reflecting that set on the next render.

## Testing

No local node/Playwright available on this machine (see project memory). Verification
will be via the in-app browser preview against the deployed/staging behavior:
- Legacy League Standings content is gone; the tab loads the Event Day workflow.
- Declaring Vendettas, recording live results, and post-event processing all still work
  and still write to the correct Gist files.
- Awards panel shows different (correctly narrower) results when the current set has
  fewer matches than all-time history, and still functions (falls back sanely) when no
  ledger exists yet.

If the user has the standalone Playwright test suite available in a session scratchpad
elsewhere, offer to have them run it, per `CLAUDE.md`'s Testing section.
