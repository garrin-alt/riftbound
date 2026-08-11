# Per-event scoping for Awards and GNL: Vendetta

## Context

Today, two different things happen to depend on "which events count," and neither lets an
organiser choose:

- **Awards** (`rvComputeAwards`, [index.html:2402](../../../index.html)) auto-scope to the
  current Riftbound set (`hist.sets` entry flagged `current`) — every event tagged with that
  set counts, no manual step, falling back to the all-time `rivalry.h2h` aggregate when the
  ledger has no data for that set yet.
- **GNL: Vendetta** League Points are **not** derived from the ledger at all. They live in
  `rivalry.rivalryPoints`, a cumulative running total incremented in place every time an
  event is processed via the Event Day tab (`rvApplyRoundToRivalry`,
  [index.html:5145](../../../index.html)). There is no per-event breakdown — a player's total
  is just a number that has been added to over time. History-only backfills (CSV upload or
  the locator-backfill skill) deliberately never touch this total; only live "Record
  Results"/"Process Event" processing does.

The user wants both to instead reflect only events they explicitly mark as counting — for
example, excluding a casual Open Play night from LP and Awards even though it's a genuine
ledger event.

## Goals

1. Add a per-event boolean flag, `counts`, on every ledger event (`hist.events[].counts`),
   toggled from a checkbox next to each event in League History's event list
   (`rvHistRenderEventList`, [index.html:6182](../../../index.html)).
2. **One shared flag** — the same flag gates both Awards and GNL: Vendetta. No independent
   per-feature flags.
3. **Replaces set-scoping entirely.** The `counts` flag is the only scoping mechanism for
   Awards and GNL: Vendetta going forward — an event's Riftbound set becomes purely
   descriptive metadata (still shown, still assigned, no longer filtered on automatically).
   An organiser could, if they chose, flag an event from an older set back on.
4. **Default `counts = false`** for every event — the 51 events already in the Abu Dhabi
   ledger, and every event recorded from here on (including ones processed live through
   Event Day). Nothing counts until explicitly flagged on.
5. **No bulk controls.** Per-event checkbox only; no "select all," no "select all in this
   set." (Explicitly declined — the organiser will flag events one at a time.)
6. **GNL: Vendetta League Points become ledger-derived**, computed fresh from `counts`-flagged
   events' match rows on every render — the same model Awards already use — instead of read
   from the stored `rivalryPoints` running total.
7. **No fallback to unfiltered lifetime stats.** When no events are flagged (the day-one
   state, and any time the organiser hasn't opted anything in yet), Awards and GNL: Vendetta
   show a genuinely empty/unclaimed state — never silently substitute the old all-time
   picture.

## Non-goals

- Player Stats, the Rivalry Rankings/Head-to-Head tabs fed by the CSV-upload "Analyze
  Rivalries" flow, and `rivalry.h2h` itself are **unaffected** — they continue to reflect
  whatever has been uploaded/computed there today, regardless of the `counts` flag. Scope is
  strictly Awards and GNL: Vendetta, per the original request.
- No change to the 3/1/0 scoring rule itself, to how a round is scored at Record-Results
  time, or to the ledger's match-row encoding.
- No change to `rivalry.h2h`'s role for the Rivalry Analyzer's Rankings/H2H views.
- Riftbound sets (`hist.sets`) are not removed — they stay as event metadata (still shown in
  League History, still assigned when an event is recorded), only their role as an automatic
  Awards/LP filter goes away.

## Data model

Add `counts: true` to a ledger event object when flagged on; **omit the key** (not
`counts: false`) when off, since that's the default and keeps unflagged events — the
overwhelming majority, at least initially — from paying for an explicit key in the compact
JSON. Every existing read must therefore treat `counts` as `!!ev.counts` (falsy/absent =
off), never assume presence.

```json
{ "id": "787390", "set": "vendetta", "date": "2026-07-24", "src": "locator",
  "r": [...], "m": [...], "counts": true }
```

`rvDeriveFromLedger(hist, opts)` ([index.html:2033](../../../index.html)) gains a new filter
option, `opts.counted`: when `true`, only events where `ev.counts` is truthy are included —
composable with the existing `set`/`from`/`to` filters it already supports, though this
feature only ever calls it with `{ counted: true }` alone (no set filter, per Goal 3).

## Part 1 — League History: the toggle

In `rvHistRenderEventList()` ([index.html:6182](../../../index.html)), add a checkbox to each
event row, before or after the existing date/set/label/match-count/remove-button layout:

```html
<input type="checkbox" data-counthist="787390" ${e.counts ? 'checked' : ''}
       title="Counts toward Awards and GNL: Vendetta"/>
```

Wire it the same way the existing `data-rmhist` remove button is wired — a direct,
un-batched write on click, following the pattern already established there:

```javascript
list.querySelectorAll('[data-counthist]').forEach(function(cb){
  cb.addEventListener('click', function(){
    cb.disabled = true;
    var freshHist = loadHist();
    var ev = (freshHist.events||[]).find(function(e){ return e.id === cb.dataset.counthist; });
    if(!ev){ cb.disabled = false; return; }
    if(cb.checked) ev.counts = true; else delete ev.counts;
    var data = load();
    save(data, freshHist).then(function(ok){
      cb.disabled = false;
      if(!ok){ cb.checked = !cb.checked; /* revert on failed write */ }
      else { rvLoadLeaderboard(); rvAwRender(); } // reflect the change on the other two tabs
    });
  });
});
```

No confirmation dialog and no two-click arm — this is a toggle a user will click repeatedly
in one sitting (declaring several events on), which per `CLAUDE.md`'s two-confirm-patterns
rule is exactly the case a plain, unconfirmed, instantly-reversible click suits, not either
of the destructive-action patterns.

## Part 2 — Awards: swap set-scoping for counts-scoping

In `rvComputeAwards` ([index.html:2402](../../../index.html)), replace the
`curSetId`/`curSetLedger` machinery entirely:

```javascript
var countedLedger = ledgerEvents.length ? rvDeriveFromLedger(hist, { counted: true }) : null;
var h2h = (countedLedger && countedLedger.h2h.length) ? countedLedger.h2h : [];
```

No fallback to `rivalry.h2h` (Goal 7) — when no events are flagged, `h2h` is simply `[]`, and
every aggregate-based award (Giant Slayer, Mortal Reminder, Mirror Match, Godlike, Ebb and
Flow, Hound, Giants tier) computes over an empty player table, which the existing `best([])`
helper already renders as "Unclaimed" — no special-casing needed there.

`led` (chronology, for Ascension/Unstoppable/Executioner) becomes:

```javascript
var led = countedLedger && countedLedger.events.length ? countedLedger : null;
```

— `null` when nothing is flagged, which the existing `if (!led) { …blocked:true… }` branch
already renders as locked, exactly as it does today when the ledger is simply empty.

**Caretaker** (attendance) re-derives from `led.events` the same way the current-set version
does today — filter is already just "whatever `led` contains," so this needs no further
change once `led` itself is counts-scoped.

**Vendetta award** (most grudge matches won) is explicitly **not** counts-scoped — per the
resolved data-gap question, it keeps reading `rivalry.rivalryPoints[player].vendettaWins`
as an all-time counter, since the ledger has no per-match Vendetta marker to filter by. The
existing inline comment there already explains this; extend it to note it's also now
inconsistent with the rest of Awards being counts-scoped, so a future reader doesn't take it
as an oversight.

**Ascension** filters `rvDerivePlayer(hist, n)`'s per-event results by `e.set === curSetId`
today; change the filter to `e.counts === true`. `rvDerivePlayer`
([index.html:2105](../../../index.html)) must copy `counts: ev.counts` onto each event object
it builds (it already copies `set`, `date`, `label`) — additive, harmless to its other caller
(Player Stats), which ignores fields it doesn't use.

**Unstoppable**'s `order`/`attended` construction already iterates `led.events` (per the prior
current-set-scoping work) — no further change; `led` being counts-scoped propagates
automatically.

**Executioner** reads `led.totals` — no further change, same propagation.

**Giants tier** is built from the `P` table, itself built from `h2h` — no direct change
needed; scoping cascades from Step 1's `h2h` swap.

## Part 3 — GNL: Vendetta: derive League Points from the ledger

Replace `rvLoadLeaderboard`'s data source
([index.html:5510-5557](../../../index.html)). Today it reads `data.rivalryPoints` from the
freshly-loaded Gist; instead, derive from the ledger:

```javascript
async function rvLoadLeaderboard(){
  var body = document.getElementById('rvLeaderboardBody');
  var empty = document.getElementById('rvLeaderboardEmpty');
  try {
    var fresh = await loadFromGist();       // still syncs hist into localStorage as a side effect
    var hist = loadHist();
    var derived = rvDeriveFromLedger(hist, { counted: true });
    var totals = derived.totals;
    rvSavedSeasonData = (fresh && fresh.rivalry) || null;   // still needed elsewhere (Awards, coverage)
    empty.style.display = 'none';

    var rows = Object.keys(totals).map(function(name){
      var t = totals[name];
      var points = (t.mw||0)*3 + (t.draws||0)*1;
      return { player: name, points: points, w: t.mw||0, d: t.draws||0, l: t.ml||0,
               ev: t.eventCount||0 };
    }).filter(function(r){ return r.points > 0 || r.w > 0 || r.d > 0 || r.l > 0; })
      .sort(function(a,b){ return b.points - a.points || b.w - a.w || a.l - b.l; });

    empty.style.display = rows.length ? 'none' : 'block';
    body.innerHTML = rows.map(function(r, i){ /* unchanged row template */ }).join('');
    rvLbCache.main = rows;
  } catch(e){
    body.innerHTML = ''; empty.style.display = 'block'; rvLbCache.main = [];
  }
}
```

`rvDeriveFromLedger`'s existing `totals` shape already carries `mw`/`ml`/`draws`/`eventCount`
per player ([index.html:2033](../../../index.html) region) — no new derivation function is
needed, only the `{ counted: true }` filter option from Part 1's data-model change and this
call site swap. Tiebreak (points → match wins → fewer losses) is preserved exactly.

**`rvApplyRoundToRivalry`** ([index.html:5145](../../../index.html)) stops accumulating
`points`/`matchWins`/`draws`/`losses` into `rivalry.rivalryPoints[player]` — those fields are
no longer read by anything after this change — but **keeps incrementing `vendettaWins`**,
since Part 2 keeps that counter as the Vendetta award's data source. The object shape stays
the same (`{ points, matchWins, draws, losses, vendettaWins }`) for minimal diff and to avoid
touching every read site that still constructs the zeroed shape via `rvEntry()`; only the
four now-dead increment lines are removed.

## Part 4 — Remove the "Clear GNL: Vendetta" button

`rvClearLadder()` and the `rvClearLeaderboard` button/two-click-arm wiring
([index.html:5330-5373](../../../index.html)) are deleted outright. It no longer has a
coherent job: "clearing" League Points now means un-flagging events, done per-event in
League History (Part 1), and a bulk "un-flag everything" was explicitly declined as a
feature. Remove the button element from the Leaderboard sub-tab markup alongside the JS.

## Testing

No local node/Playwright on this machine (per project memory) — verification via the
in-app browser preview against the real Abu Dhabi Gist:

- Fresh load, nothing flagged: Awards tab shows every award as Unclaimed/Locked (not
  falling back to old lifetime data); GNL: Vendetta shows its empty state.
- Flag one event's checkbox on in League History: confirm the write lands (`save(data, hist)`
  returns true), then confirm both Awards and the Leaderboard immediately reflect it without
  a manual refresh (per Part 1's `rvLoadLeaderboard()`/`rvAwRender()` calls after a
  successful toggle).
- Flag a second event, un-flag the first: confirm both tabs recompute correctly — this is
  the core "chosen subset, not just current set" behavior the whole feature exists for.
- Confirm Player Stats and Rivalry Analyzer's Rankings/H2H tabs are visibly unaffected by
  any of the above (Non-goals check).
- Confirm the removed "Clear GNL: Vendetta" button is gone with no dangling references
  (`grep` for `rvClearLadder`, `rvClearLeaderboard`, `rvLbClearArmed`).
