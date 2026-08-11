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
on event `248720` round 6 and `337169` round 3. The button label is `Next` (not `NEXT`), so match
it case-insensitively.

#### After clicking Next, wait for a SETTLED grid — not merely a changed one

This is the same "stable, not merely different" rule the round switcher needs, and it is just as
destructive here. On clicking Next the grid **empties while the next page loads**. A wait that only
checks "content differs from before" is satisfied instantly by that empty state; the loop then reads
zero cards, finds no Next button in the empty render, and breaks — so **every round of every large
event silently stops at page 1**.

Symptom: every round returns exactly 10 matches regardless of attendance. A 30-player event shows
`10/10/10` where it should show `15/14/12`. It looks like a cap, not a bug.

Require all three before accepting the new page: no `pairings-skeleton-matchup`, at least one card
present, and text different from the previous page.

```js
const moved = await waitFor(d, () => {
  const s = secGet(); if (!s) return null;
  if (s.querySelectorAll('[data-testid="pairings-skeleton-matchup"]').length) return null;
  const els = cardsIn(s); if (!els.length) return null;              // still loading
  return els.map(e => e.textContent).join('|') !== before ? true : null;
}, 15000);
```

Re-query the section each iteration rather than holding the node — React can replace it, and a
detached node reports zero-size for every button, which looks exactly like "no Next".

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
this actually happened and produced a ledger with wrong pairings. Six shapes exist:

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

deck-registered event  ← the score moves to the END      loss (no opponent)
------------------------                                 ------------------
TABLE / 1 / PlayerA / <champion> / PlayerB / <champion> / 2 : 1
                                                         TABLE
                                                         -
                                                         Optixus
                                                         Loss
```

### The `Loss` card — the mirror of a Bye

A **two-field body whose second field is `Loss`** is a loss awarded with no opponent. It is
structurally identical to a Bye but counts the other way, and it is easy to miss because the
obvious guard only tests for `bye`:

```js
if (body.length === 2 && /^bye$/i.test(body[1])) return { k:'b', p:body[0] };  // NOT ENOUGH
```

Anything else with a two-field body then falls through to the score search, finds no score,
returns `null`, and is counted as a mid-render card — so the loss is **silently dropped**. The
event then disagrees with its own standings by exactly one loss per dropped card, which reads
like a harvest bug rather than a parser gap.

Confirmed live on Abu Dhabi `777661` (2ESC2, Optixus), `787390` (PokéBaller, Dani) and `834660`
(JoSe, Links). Like a bye it produces **no match row** — there is nobody to have played — but it
must be captured so corroboration can add it to standings losses:

```
harvestedWins   + byes       == standingsWins
harvestedLosses + lossCards  == standingsLosses
harvestedDraws               == standingsDraws
```

Treat any *other* two-field body as an unknown token and report it rather than discarding it —
that is how this shape was found.

Parse **structurally**: find the `TABLE` marker, strip any
`[data-testid="deck-defining-card-name"]` nodes, then locate the score by **pattern**
(`\d+ : \d+` or `TIE`) rather than by position — that way `A / score / B` and `A / B / score` both
parse identically. Whatever two fields remain are the players. Three fields ending in `Bye` → a bye.

The champion name also pollutes the **standings** name cell; strip it there too, or the same player
appears under two different names.

- `TIE` is a drawn match — record `1 : 1`. It is real data, not a rendering failure.
- A `Loss` row is a real recorded loss with no opponent — capture it, drop it from the ledger,
  and feed it to corroboration (see "The `Loss` card" above).
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

**Scope the `standings-empty` check to the VISIBLE section.** The hidden mobile copy carries a
permanent "No standings available for this round" element, so an unscoped document-wide query:

```js
if (st && !d.querySelector('[data-testid="standings-empty"]')) { … }   // WRONG
```

is true on *every* event, and standings are skipped every single time. That silently disables the
whole corroboration gate — every event comes back `UNVERIFIED` and nothing is ever checked against
the platform. Query within the visible section instead, and wait for the table to actually render
before grabbing (the pairings finish first):

```js
const st = pick(d, '[data-testid="standings-section"]');
const empty = st && st.querySelector('[data-testid="standings-empty"]');
if (st && !empty) {
  await waitFor(d, () => tblOf() ? true : null, 20000);
  …
}
```

Sanity check: a healthy event returns roughly as many standings rows as it has players. `stand=0`
across the board means this bug, not a quiet platform.

**Standings names can carry a ` (Guest)` suffix that the pairing cards omit** — Abu Dhabi `315067`
lists `Vaccinated Monk (Guest)` in standings and `Vaccinated Monk` on the card. Strip it before
corroborating or that player looks like they never played.

#### Partial standings make corroboration pass VACUOUSLY — count the rows

Standings pagination can stop after the first 10 rows. Corroboration then only ever checks those 10
players, so an event with dropped matches still reports `OK` as long as the loss falls on someone
outside the top 10. **A green result on 10 standings rows for a 28-player event proves almost
nothing.**

This is not hypothetical: Dubai `662679` round 3 has 14 matches, a re-harvest captured only 10 (a
page-1 cap), and the event still passed corroboration because standings had also stopped at 10 rows
— the 4 dropped matches belonged to players further down. It was caught only by diffing against a
ledger already known to be good.

So always carry the roster size (`starting_player_count` from `Get-EventMeta.ps1`) alongside the
standings count, and treat a large shortfall as **UNVERIFIED, not OK**:

```
standingsRows >= playerCount            -> fully corroborated
standingsRows <  playerCount            -> PARTIAL: say how many were actually checked
standingsRows <= 10 && playerCount > 12 -> treat as UNVERIFIED; the gate proved nothing
```

Two independent signals should agree before trusting an event: the standings check, and the match
count per round being consistent with attendance (roughly `players / 2`, minus byes and drops). A
round that lands on exactly 10 when attendance implies more is a page-1 cap regardless of what
corroboration says.

**One display name can belong to two different registrations.** In Abu Dhabi `525835` "Guineabear"
appears twice in the same round — impossible for one player, so the platform holds two entries under
that name. Handle-space cannot separate them. Detect it (a name appearing twice in one round) and
report it rather than letting the tally silently double.

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
