---
name: backfill-league-history
description: Backfill GNL league history (riftbound_history.json / riftbound_dubai_history.json) from the UVS Riftbound locator when pairing CSVs are unavailable. Use when asked to add past events to the ledger, rebuild a city's history, fill gaps in League History, or import events for a Riftbound set.
---

# Backfilling league history from the UVS locator

The app's normal refill path needs organiser-exported pairing CSVs. Those are **not publicly
re-downloadable** — the locator has no export control for spectators. So historical events can only
be recovered by reading the locator itself.

This skill does that, and writes the result to the city's Gist.

## Before you start

Read `references/locator.md` (how to get the data) and `references/ledger-format.md` (what the
ledger must look like). Both encode failures that already happened.

Confirm with the user before any write:

1. **Which city** — Abu Dhabi and Dubai are separate Gists with explicitly-named files.
   Read `CITIES` in `index.html` and use its values verbatim. Never derive one city's filename
   from the other's; that is how one league overwrites the other.
2. **Which set** each event belongs to (see "Set assignment" below — never assume).
3. **Whether to keep or drop** any flagged events (all-draw rounds, mismatches).

## Workflow

### 1. Enumerate events

Two sources, use both:

- **`rivalry.attendance`** in the city's main JSON maps player name → `[eventId]`. This is a
  master list of every event the league has already processed. Cheap and authoritative — start here.
- **The locator UI**, for events never processed. This *requires driving the browser*: URL params
  (`?latitude=`, `?location=`, `?search=`) are ignored, and an anonymous `curl` returns
  IP-geolocated results. See `references/locator.md` for the exact click sequence.

Diff the two: anything in the locator but not in the ledger is a gap.

### 2. Fetch metadata

```
scripts/Get-EventMeta.ps1 -EventId <id>
```

One `curl` per event. Returns name, date, address, player count, round ids, and a partial
standings sample. Fast, no browser.

**`maxPlayersPerMatch` is 2 even for events titled "Multiplayer"** — it does not identify them.
What actually identifies a no-data event is that it publishes **no pairings at all** (see step 3);
those contribute zero matches and drop out naturally.

### 3. Harvest pairings

Pairings are **not** in the page HTML — they are fetched client-side after hydration. A browser is
mandatory. Use `scripts/Harvest-Events.js` via the browser's `javascript_tool`.

It loads each event in a **same-origin iframe** so many events can be processed without navigating
the top-level page, and it **runs in the background** because the tool call itself times out at 30s.
Launch it, then poll `window.__H` for progress. Do not navigate the top page while it runs — that
destroys the accumulated results. Each finished event is persisted to `localStorage`, and the
harvester resumes from it, so a closed pane costs at most the event in flight.

**Pairings paginate at 10 cards per page — drain every page.** Reading only page 1 silently drops
matches on every round of a large event, and the ledger then contradicts the platform's own
standings, which is indistinguishable from "the platform didn't publish those rounds". This
mis-diagnosis actually happened. See `references/locator.md`.

Draining is not just "click Next" — after the click the grid **empties while loading**, so a wait
that only checks "content changed" accepts the empty state and the loop breaks at page 1 anyway.
Require a settled grid (no skeletons, at least one card, text different from before). Tell-tale:
every round returns exactly 10 matches regardless of attendance.

Run serially. Concurrency causes enough CPU contention to trigger spurious timeouts and is barely
faster.

Budget roughly 30–120 seconds per event depending on player count and round count.

### 4. Corroborate — this gate is the point of the whole exercise

For every event, recompute each player's W-L-D from the harvested pairings and compare against the
locator's own standings. Two card shapes have **no opponent and therefore no pairing row**, yet both
appear in standings: a **bye** (a win) and a **`Loss` card** (its exact mirror). So the check is:

```
harvestedWins   + byesThisPlayer  ==  standingsWins
harvestedLosses + lossCards       ==  standingsLosses
harvestedDraws                    ==  standingsDraws
```

**If every event comes back with zero standings, you have the scoping bug, not a quiet platform** —
the hidden mobile copy carries a permanent `standings-empty` element, so an unscoped
`document.querySelector` for it disables this entire gate. See `references/locator.md`.

An event that fails is **reported and excluded, never silently imported**. This is not theoretical:
event `252948` (Dubai, 2025-11-06) publishes 4 rounds but its standings show 5 matches per player —
a whole round of pairings the platform never published.

`scripts/Merge-Ledger.ps1` performs this check and prints a per-event table.

### 5. Set assignment — propose, never assume

Release dates: Origins `2025-10-31`, Spiritforged `2026-02-13`, Unleashed `2026-05-08`,
Vendetta `2026-07-31`.

**Date alone is wrong.** Prerelease events are tagged with the *new* set despite preceding its
street date. Confirmed twice: Abu Dhabi `525835` (2026-05-02) is tagged `unleashed`; Dubai ran
"Spiritforged Pre-Rift" events on 2026-02-06..08.

Rule: **a set name in the event title overrides the date** — then show the user the proposal and
get confirmation before writing.

### 6. Dry run, then write

`Merge-Ledger.ps1` emits the ledger plus a validation table. Show the user the diff — events,
players, matches, date range, encoded size — and get approval.

Then PATCH via `gh api`, sending **both files in one body**. The history file is never PATCHed
alone; see `references/ledger-format.md`.

### 7. Verify

- Read the Gist back; confirm event count, match count, date range.
- **Re-read the other city's Gist and confirm it is byte-identical.** Cross-city writes are the
  highest-consequence failure mode here.
- Load the live site, hard refresh, switch to the city, and confirm League History renders.
- Regenerate the lifetime aggregate **in the app**, not in PowerShell — see below.

## Never reimplement the aggregate

`rvHistScorePairs` (`index.html`) reads its weights from **live DOM sliders** (`wMeet`, `wClose`,
`wSwing`). A PowerShell reimplementation will silently diverge.

After writing the ledger, use the app's own **`♻ Rebuild lifetime H2H from ledger`** button. It runs
`rvHistScorePairs(rvDeriveFromLedger(hist).h2h)` and saves through the tested path. It is idempotent
once `rivalry.history.lifetimeSource === 'ledger'` — and setting that flag is also what unlocks the
button when starting from an empty aggregate.

`rivalry.attendance` is *not* regenerated by that button, but is trivially derived from the ledger
(name → event ids) and safe to build in PowerShell — no weighting involved.

## Things that will waste your time

- **The hydraproxy API is a dead end.** `api.cloudflare.riftbound.uvsgames.com/hydraproxy` answers
  at its base but 404s every guessed path; the path map lives in the JS bundle. Don't re-chase it.
- **Store pages list only upcoming events** — useless for backfill.
- **The page has two DOM copies** (desktop sidebar + mobile sheet). Half the element refs are the
  hidden copy and clicking them silently no-ops at coordinate `(0,0)`.
