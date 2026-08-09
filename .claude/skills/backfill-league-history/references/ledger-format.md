# The league history ledger

The ledger is the second file inside each city's Gist. It is the chronological record of every
match: who played whom, when, in which event, tagged with the Riftbound set.

It complements `rivalry.h2h` in the main file, which is a lifetime aggregate with no dates.
**One owner per question** — the aggregate answers "how do these two compare", the ledger answers
"when did that change". An aggregate cannot be decomposed by subtraction, so never partially
supersede one with the other.

## Where it lives

`CITIES` near the top of `index.html` is the single source of truth. Gist ids, filenames and
`localStorage` keys are all named explicitly — **never derive one city's filename from the other's**,
because that is exactly how one league ends up writing into the other's file.

| City | Gist | Files |
|---|---|---|
| Abu Dhabi | `CITIES.abudhabi.gistId` | `riftbound.json` + `riftbound_history.json` |
| Dubai | `CITIES.dubai.gistId` | `riftbound_dubai.json` + `riftbound_dubai_history.json` |

## Shape

```json
{
  "v": 1,
  "city": "Dubai",
  "players": ["Astrum", "Glowkw", "..."],
  "aliases": {},
  "sets": [
    {"id":"origins","name":"Origins","order":1},
    {"id":"spiritforged","name":"Spiritforged","order":2},
    {"id":"unleashed","name":"Unleashed","order":3},
    {"id":"vendetta","name":"Vendetta","order":4,"released":"2026-07-31","current":true}
  ],
  "events": [
    {
      "id": "252948",
      "set": "origins",
      "date": "2025-11-06",
      "src": "locator",
      "label": "Thursday Evening Nexus Nights - 1v1",
      "r": [[1,"s"],[2,"s"],[3,"s"],[4,"s"]],
      "m": ["0,0,1,2,0", "0,2,3,2,0", "1,0,4,1,2"]
    }
  ],
  "archive": []
}
```

### Match encoding

`"slot,playerAIdx,playerBIdx,winsA,winsB"`

- `slot` is the **index into `r`**, not the round number. `r[slot]` is `[roundNumber, 's'|'p']`
  where `'p'` marks a playoff / top-cut round.
- `playerAIdx` / `playerBIdx` index into `players`.
- `winsA` / `winsB` are game wins. A draw is `1,1`.

Five dictionary-encoded integers per match beat nine verbose keys per pair — the ledger is roughly
8× smaller than the aggregate it complements.

## Rules that must not be broken

Each of these encodes a bug that already happened.

1. **`players` is append-only.** An index, once assigned, is a permanent id for that name.
   Reordering the array silently repoints every stored match row in the file.

2. **Events are sorted by `date` then `id` at write time.** Every downstream derivation is a single
   forward pass, which is what makes uploading events out of order self-healing rather than
   corrupting.

3. **Re-recording an event replaces it wholesale.** `rvHistRecordEvent` upserts by id. Replacing
   rather than merging is what makes a re-upload structurally incapable of double-counting.

4. **Byes are dropped at parse time.** `"BYE"` in any dressing (`"*** Bye ***"`, `"- bye -"`) is a
   placeholder, not a player. Byes never score and never count as attendance. Note the platform
   *does* count a bye as a match win in its standings — account for that when corroborating.

5. **The history file is never PATCHed alone.** `syncToGist` sends both keys in one body. Writing
   history by itself will desynchronise it from the main file.

6. **A loaded file must be a plain object.** `[]` is valid JSON, passes a naive `!== '{}'` check,
   and accepts named properties — then `JSON.stringify` drops everything non-index and the next
   save writes two bytes. This has actually happened. Guard with
   `!!d && typeof d === 'object' && !Array.isArray(d)`.

7. **Write compact.** `JSON.stringify(data)` with no indent. Gists truncate at 1 MB.

## Sets

Origins → Spiritforged → Unleashed → Vendetta, stored as **editable data in `hist.sets`**, not a
constant — new sets must not require a redeploy.

Release dates: `2025-10-31`, `2026-02-13`, `2026-05-08`, `2026-07-31`.

**Do not assign by date alone.** Prerelease events carry the *new* set despite preceding its street
date — Abu Dhabi `525835` (2026-05-02) is tagged `unleashed`, and Dubai ran "Spiritforged Pre-Rift"
events on 2026-02-06..08. A set name in the event title beats the date; confirm with the user.

## Scoring is not the ledger's job

3 points per match win, 1 per draw, 0 per loss — and nothing else. Rivalries and Vendettas are
narrative only and score zero. Byes never score. The ladder sorts on points → match wins → fewer
losses. Do not introduce a rivalry term into any tiebreak, and do not write points into the ledger:
they are derived.
