# Getting data out of the UVS Riftbound locator

Base: `https://locator.riftbound.uvsgames.com`

Everything below was established by testing against the live site. The dead ends are documented
because each one costs real time to re-discover.

## What lives where

| Data | Source | Cost |
|---|---|---|
| Event name, date, store, address, player count | event page HTML | 1 `curl` |
| Round ids, round numbers, phase type | event page HTML | same `curl` |
| First 10 registrations w/ final W-L-D | event page HTML | same `curl` |
| **Pairings (who played whom, scores)** | **browser only** | iframe + clicks |
| Full standings (all players) | browser only | iframe + pagination |
| Which events exist for a city/date range | browser only | UI filter sequence |

## The event page HTML

`curl https://locator.riftbound.uvsgames.com/events/<id>` returns ~600 KB. The data is JSON with
every quote escaped as `\"`, embedded in Next.js RSC script tags. Regex the escaped form directly;
do not try to reassemble the flight stream (it is not stable across deploys).

Useful anchors — see `scripts/Get-EventMeta.ps1`:

- Event name: `\"name\":\"...\"` **immediately followed by** `\"pinned_by_store\"`. The bare
  `name` key appears many times (formats, stores, categories); only this occurrence is the event.
- `\"start_datetime\":\"2025-11-06T13:00:00+00:00\"` → take the date part.
- `\"full_address\":\"...\"`, `\"starting_player_count\":N`
- Rounds: `\"id\":155478,\"round_number\":1,...,\"round_type\":\"PLAY_VS_OPPONENT\",\"status\":\"COMPLETE\"`
  The `id` here is the `roundid` that appears in exported CSV filenames
  (`matches-event-<eventId>-round-<n>-roundid-<roundId>.csv`).
- Registrations appear **twice** (server prefetch + client hydration). Dedupe by name.
  Only the first page (`page_size` 10) is prefetched — treat as a sample, not a roster.

### `maximum_number_of_players_in_match` does NOT identify multiplayer events

It is `2` for every event checked, including ones titled "… - Multiplayer". What actually
distinguishes them is that they publish **no pairings and no standings at all** — the page says
"No pairings available for this round". Those events contribute zero matches and drop out naturally.
Detect emptiness, not the title and not this field.

## Pairings require a browser

Verified: the HTML contains **zero** pairing markup. `?round=1`, `?roundId=<id>`, `?round_id=<id>`
all return byte-identical pages. Pairings are fetched client-side after hydration.

### Same-origin iframes let you batch

`/events/<id>` can be loaded into a same-origin iframe and its `contentDocument` read freely. This
avoids navigating the top-level page once per event.

### Timer throttling is the dominant cost

If the browser pane is not displayed, `document.hidden === true` and the browser throttles timers to
roughly one tick per second. A `sleep(400)` costs ~1000ms. **Minimise the number of waits, not their
length** — a tight 400ms poll loop with a 7s budget burns ~17 throttled ticks.

Use a few long sleeps with a small retry count instead. Check `document.hidden` and say so if the
run is slow.

### Parse cheaply

`innerText` forces layout. Do not call it on every `div`. Instead locate the pairings container by
`textContent` (no reflow) — it is a `div.grid` whose text matches `/TABLE\s*\d/` with fewer than 40
children — then call `innerText` only on its card children.

### Pairings paginate at 10 cards per page — drain every page

This is the most damaging thing to get wrong, and it did go wrong: reading only page 1 silently
drops matches on **every round** of a large event, and the resulting ledger then disagrees with the
platform's own standings — which looks exactly like "the platform didn't publish those rounds".

The pager lives *inside* `[data-testid="pairings-section"]` and reads `Page 1 of N`. Confirmed live
on event `248720` round 6 and `337169` round 3.

Cards are ordered by table number with the bye (`TABLE / - / Name / Bye`) **last**, so:

- an **11-card** round loses only the bye — harmless, byes never enter the ledger
- a **12+ card** round loses **real matches**

Roughly, an event needs ≥21 *active* players (not registered — no-shows and drops matter) before a
round exceeds one page.

### Useful `data-testid` hooks

Far more robust than text matching. Confirmed present:

| testid | Use |
|---|---|
| `pairings-section` | Scope all pairing reads and the pairings pager |
| `pairings-round-dropdown-trigger` | The round selector; has `data-state="open"/"closed"` |
| `pairings-round-dropdown-option-<N>` | **The suffix IS the round number** |
| `pairings-skeleton-matchup` | Present while still rendering — treat as "not settled" |
| `standings-section` / `standings-empty` | Scope standings; skip when empty |
| `deck-defining-card-name` | Champion name — strip before parsing cards *and* standings names |

**Every one of these appears twice** — the page renders a desktop and a mobile copy. Use the one
with a real bounding box.

The round selector is a Radix Select: a failed attempt can leave it **open**, after which every
later round reports "no option". Drive it via `data-state` and confirm the selection by reading the
trigger label back.

Round labels are **not all** `Round N` — top cut renders as `Top 8` / `Top 4` / `Top 2`. Those are
playoff rounds and should be tagged `p`, not `s`.

**Cards do not have a fixed line count.** Parsing by line count silently drops real matches —
this actually happened and produced a ledger with wrong pairings. Five shapes exist:

```
normal                    feature match                                    bye              untabled
------------------------  ---------------------------------------------   --------------   ----------------
TABLE                     FEATURE MATCH                                    TABLE            TABLE
3                         Do not start playing until you have spoken...    -                -
Balenciaga                TABLE                                            ZeroWins         RaiKen
TIE                       1                                                Bye              2 : 0
Monkey Island 2           KoktailOverDose                                                   KuroiSeraph
                          2 : 0
                          FIDO DIDO

deck-registered event  ← the score moves to the END
------------------------
TABLE / 1 / PlayerA / <champion> / PlayerB / <champion> / 2 : 1
```

Parse **structurally**: find the `TABLE` marker, strip any
`[data-testid="deck-defining-card-name"]` nodes, then locate the score by **pattern**
(`\d+ : \d+` or `TIE`) rather than by position — that way `A / score / B` and `A / B / score` both
parse identically. Whatever two fields remain are the players. Three fields ending in `Bye` → a bye.

The champion name also pollutes the **standings** name cell; strip it there too, or the same player
appears under two different names.

- `TIE` is a drawn match — record `1 : 1`. It is real data, not a rendering failure.
- The table label may be `-`. An untabled row is still a real, scored match; keep it with a null
  table number. Event `252948` round 1 carries four of them in addition to tables 1–6.
- **Bye rows are explicit**, so byes can be captured directly rather than inferred. This matters:
  the platform counts a bye as a match *win* in standings, so corroboration needs the exact count.

### Wait for a STABLE sample, not merely a changed one

After switching rounds the grid re-renders progressively. Accepting the first sample that differs
from the previous round captures a half-rendered grid — in testing this produced four wrong
pairings with null table numbers, none of which matched the real round 1.

Require all three: the sample parses completely (no malformed card), it differs from the previous
round, and it is **identical across two consecutive reads**. Treat any malformed card as
invalidating the whole sample.

### Round switching

The round `<button>` shows `Round N`. Click it, wait, then click the matching `[role="option"]`.
Allow ~1500ms for the dropdown to render — 500ms is not enough. The option list is only present
while the dropdown is open.

### Standings

A `<table>` containing `RANK`/`POINTS`, paginated 10 rows per page with a `NEXT` button. The record
cell reads `3\n-\n1\n-\n1` — strip whitespace and split on `-`.

## Enumerating events for a city

**URL parameters do not work.** `?latitude=`, `?lng=`, `?location=`, `?search=` are all ignored;
the server-rendered list is IP-geolocated, so an anonymous `curl` returns whatever is near the
exit node. Store pages (`/stores/<uuid>`) list only *upcoming* events. The UI is the only route.

Sequence (all on `/events`):

1. The page renders **two DOM copies** — a desktop sidebar and a mobile sheet. Half the element
   references belong to the hidden copy and clicking them silently no-ops at coordinate `(0,0)`.
   Prefer the element whose bounding box is real.
2. Click **Address** under "Where". A text input with placeholder `Location-Anywhere` appears.
3. Type the **full** location string, e.g. `Dubai - United Arab Emirates`. Typing a prefix and
   pressing Enter reverts to the previous location — you must select the `[role="option"]` entry.
   The suggestions only enter the accessibility tree once the full string is typed.
4. Set a distance (25mi covers a city).
5. Click **Past**, then **Custom**, and pick a start and end date. Without an explicit range the
   list shows upcoming events only — "This Year" alone does not apply a date filter.
6. Results cap at **25 per page**. The `NEXT` button sits outside the accessibility tree's
   truncation window, so click it directly rather than looking for a ref.

Read each result card for the event id (`a[href^="/events/"]`), date, name and venue.
