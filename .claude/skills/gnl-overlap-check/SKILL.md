---
name: gnl-overlap-check
description: Check for players who appear on BOTH Abu Dhabi's and Dubai's live GNL: Vendetta standings, and detect cross-added events that inflate the overlap. Use when asked to check/find/report an overlap between the two cities' players, leaderboards, or standings, or to investigate why the same names show up ranked in both cities.
---

# GNL: Vendetta cross-city overlap check

Abu Dhabi and Dubai are two entirely separate leagues, but many players attend events in both
cities. That alone is not a problem worth reporting - a player having their own name in both
cities' historical ledgers is common and expected (roughly two-thirds of Abu Dhabi's roster also
appears somewhere in Dubai's ledger, lifetime). **What actually matters is who is currently
*ranked* on both cities' live GNL: Vendetta boards** - that's a much smaller, much more
actionable number, and it's the one an organiser asking for "the overlap" almost always means.

**Scope this to counted events, never the raw ledger.** GNL: Vendetta standings are driven
entirely by `rvComputeLeaguePoints(hist, rivalry)`, which only counts events flagged
`counts: true` (see CLAUDE.md's "GNL: Vendetta and Awards only count events the organiser has
explicitly flagged"). Checking for shared names across the *full* lifetime ledger instead answers
a different, far less interesting question and inflates the number dramatically - confirmed live:
96 shared names across full lifetime ledgers, only 29 of those on both current boards, and after
the cross-added-event fix below, only 7 of those 29 were independently earned.

## The recurring root cause: cross-added events

**Always check for this before reporting a number.** It has happened at least once for real and
is the single largest source of inflated overlap: an event gets entered into *both* cities'
ledgers under the identical event id, flagged `counts: true` in both. Every player in that event
then earns full League Points in both cities' standings for the exact same matches.

Confirmed case: event `701984`, "Vendetta 'Win-A-Box' Tournament At The Playgrounds" (Abu Dhabi,
2026-08-15), was cross-added into Dubai's ledger - Dubai's own copy even carries a label noting
it: `"...(Abu Dhabi event, cross-added at explicit user request)"`. That single event was
responsible for 22 of 29 shared names on the boards at the time. `compute-overlap.js` (below)
detects this automatically: any event id flagged `counts: true` in *both* ledgers is exactly this
bug, and the script reports both the raw overlap and a report-only recompute with those events'
`counts` cleared in a clone (never in the real data) - that second number is almost always the one
worth acting on.

## Workflow

This is entirely **read-only reporting**. Nothing here writes to either Gist. If the organiser
wants to act on what you find - excluding specific players from one city's standings - that's the
separate `rivalry.vendettaExcluded` feature (see CLAUDE.md's GNL: Vendetta section and the
"Excluded players" box under the leaderboard in Rivalry Analyzer); do that as its own explicit,
confirmed step, never bundled into this check.

1. **Fetch both cities fresh.** Never trust a cached copy from earlier in the session - run
   `scripts/Fetch-CityData.ps1 -City abudhabi -OutDir <dir>` and again with `-City dubai`, same
   `-OutDir`. Each call writes `<city>-main.json` and `<city>-hist.json` plus a dated raw-gist
   file, and prints event/player counts so you can sanity-check the fetch landed.

2. **Copy those four files under the served repo root**, same-origin as `index.html` - e.g. a
   scratch subfolder like `.overlap-data/` at the repo root (git-ignored scratch; delete it when
   done, same as the harvest cache dirs under `backfill-league-history/scripts/`). A fetch from
   the browser tab to a *second* local server (a different port) is cross-origin and gets blocked
   by CORS with no useful error - same-origin avoids the whole class of problem.

3. **Serve the repo and open it.** `scripts/serve-repo.ps1 -Port <port>` (background it), then
   open `http://localhost:<port>/index.html` in the browser tool. You do **not** need to unlock
   the password gate or select a city for this - `rvComputeLeaguePoints` and `rvDeriveFromLedger`
   are top-level `function` declarations, reachable on `window` the moment the page's own
   `<script>` block has run, regardless of lock-screen state.

4. **Paste `scripts/compute-overlap.js` into `javascript_tool`**, after first editing its
   `DATA_PATH` constant to match wherever you copied the four files in step 2. It returns the
   report object directly - small enough that it never needs the save-server workaround (unless
   you extend it to carry a lot more per-player detail; see the next section if so).

5. **Report the numbers, don't act on them.** State the board sizes, the raw overlap count, and -
   whenever `crossAddedEvents` is non-empty - lead with the corrected overlap and name the
   specific event(s) responsible, the way the flagged label already half-explains itself. Offer
   the exclusion feature as a distinct next step; don't invoke it unasked.

6. **Clean up** the scratch data directory and stop the local server(s) when done, same as any
   other throwaway local-testing setup this project's sessions use.

## When the result is too large to return directly

`javascript_tool`'s return value has a real size ceiling - observed failing around ~130,000
characters of response text, well below what a full per-player match history or a large rebuilt
aggregate can reach. Past that ceiling the tool auto-saves the result to a local `.txt` file
instead of erroring, but that file is the tool's own `{type, text}` envelope wrapped a second time
around your actual payload, and reliably unwrapping it from PowerShell wastes real time chasing a
problem that has an easy fix: don't return it, POST it out instead.

`scripts/save-server.ps1 -Port <port> -OutFile <path>` starts a tiny local HTTP listener that
writes any POST body straight to a fixed file, unconditionally - no path parsing, no per-request
filename logic. (An earlier version of this script tried to name the output file from the request
path using `[System.Web.HttpUtility]::UrlDecode` - that type isn't loaded in a default PowerShell
session, the decode silently produced an empty string, and every POST landed in a directory with
no filename at all, with no visible error anywhere. If you need several distinct payloads, run
this script again on a different `-Port` per payload rather than reintroducing path-based naming.)
From the same-origin page: `await fetch('http://localhost:<port>/', { method: 'POST', body:
JSON.stringify(bigThing) })`. Read the result back with `[IO.File]::ReadAllText($OutFile) |
ConvertFrom-Json`.

## Things that will waste your time

- **Checking shared names in the raw ledger instead of the counted-events board.** This is the
  single most likely mistake - it happened once already in this project's own history, and the
  number it produces (dozens of shared names) reads as alarming but is almost entirely noise once
  you re-scope to what's actually flagged `counts: true`.
- **Forgetting to re-fetch fresh data if any time has passed** since a previous check in the same
  session, especially if the organiser mentioned making changes in the live app - Gist data can
  and does change mid-session (a live edit was observed happening in real time during the
  investigation that produced this skill). `Fetch-CityData.ps1` always hits the network; never
  reuse an old local copy for a number you're about to report as current.
- **Reimplementing `rvComputeLeaguePoints` or `rvDeriveFromLedger` instead of calling the real
  ones.** Both are simple-looking enough to be tempting to copy by hand, and both encode rules
  (the `counts: true` filter, bye handling, draw scoring) that a hand copy will silently drift
  from the moment either function is touched again. They're top-level reachable specifically so
  you never have to.
