# Partition Judges by city — design

## Problem

The Judges tool (`gnl_judges.json`, in its own shared Gist `JUDGES_GIST_DEFAULT`) is currently one
roster and one shift log shared across both Abu Dhabi and Dubai, by explicit original design (see
CLAUDE.md's Judges section). The organiser wants this fully partitioned instead: two independent
judge pools, one per city, with no shared identity or rank between a judge in one city and a
same-named judge in the other.

## Current state (confirmed against the live Gist before designing)

- 12 judges, 98 shifts total.
- **Every single shift's `city` field is `"abudhabi"`.** Dubai has never actually been used through
  this tool. This is not a data-splitting problem — it's closer to "Abu Dhabi keeps everything,
  Dubai starts blank."
- Every judge has at least one shift (no shiftless/zero-activity judges to place).
- The existing data shape (flat, one shared object):
  ```json
  {"v":1, "judges":[{"id":"jmsdgd3vf","riotName":"Galoonga","level":1,"active":true}, ...],
   "shifts":[{"date":"2025-12-20","type":"C","judge":"jmsg0yvyk","city":"abudhabi"}, ...],
   "updatedAt":"..."}
  ```

## Chosen approach

**One shared Gist, city-keyed internally** (approach "C" from the three options discussed). The
Gist ID (`JUDGES_GIST_DEFAULT`) and the file name (`JUDGES_FILE` = `gnl_judges.json`) do not
change, and neither does the Settings "custom judges Gist" override (`rb_judges_gist`) — there is
still exactly one Gist to point at, just with a different internal shape.

### New data shape

```json
{
  "v": 2,
  "abudhabi": { "judges": [ ...same shape as today... ], "shifts": [ ...same shape as today... ] },
  "dubai":    { "judges": [], "shifts": [] },
  "updatedAt": "..."
}
```

Each city's `judges`/`shifts` arrays keep their exact current per-item shape (`{id, riotName,
level, active}` for a judge; `{date, type, judge, city}` for a shift) — only the top-level wrapper
changes, from flat to city-partitioned. `shift.city` becomes redundant once a shift lives inside
its own city's bucket, but the field is left in place rather than stripped — nothing downstream
needs it removed, and removing it buys nothing.

### Behavior after the change

- Switching the app to Abu Dhabi and opening Judges shows exactly what it shows today — same 12
  judges, same 98 shifts, same computed ranks. Nothing regresses for Abu Dhabi.
- Switching to Dubai and opening Judges shows an **empty roster**. Log-a-Shift's judge picker shows
  zero existing candidates — there is no cross-city lookup or name suggestion. The first Dubai
  shift for any judge (including someone already active in Abu Dhabi under the same Riot Name) must
  be typed as a brand-new name, which creates a brand-new judge record that exists only in Dubai's
  bucket, with its own independent rank starting from zero shifts. This was explicitly confirmed as
  the wanted behavior, not a gap to fill later.
- A judge's identity, rank, retired/active status, and shift history are now entirely scoped to one
  city. There is no path in the UI or data model for a single judge record to appear in both
  buckets.

## Code changes (`index.html`)

All of the following currently operate on the whole shared object; each becomes scoped to
`getCityConfig()`/`activeCity`'s bucket instead. None of their internal logic changes — they still
just take a `d` (a judges data object) and don't currently care whether `d` is "the whole file" or
"one city's slice", so passing a bucket instead of the whole object requires no changes to:
`jdCompute`, `jdShiftsOn`, `jdNightType`, `jdFindByName`, `jdById`, `jdTierOf`, `jdNextTier`.

What does need to change:

- **`jdNew()`**: currently returns `{v:1, judges:[], shifts:[], updatedAt:null}`. Needs a bucket
  variant — the per-city shape (`{judges:[], shifts:[]}`) — used both for a brand-new file and for
  filling in a missing city key on an existing file (e.g. Dubai's bucket not existing yet
  immediately after migration, or on any load before migration has run).
- **`loadJudges()` / `loadJudgesFromGist()`**: read the whole file (still one Gist, one file), then
  return `whole[activeCity]` (falling back to the bucket-shaped `jdNew()` if that key is missing or
  not itself a plain object — same `jdIsFile`-style guard, applied one level deeper).
- **`saveJudges(d)`**: `d` here is one city's bucket, not the whole file. The write must not
  clobber the *other* city's bucket — same GET-then-merge-then-PATCH shape already used for the
  League Points external mirror (`rvSyncLeagueMirror`), but higher-stakes here since this is a
  primary data store, not a read-only mirror. Concretely: fetch the current whole file, replace
  `whole[activeCity]` with the bucket being saved, PATCH the whole merged object back. The existing
  rollback-on-rejected-write behavior (documented in CLAUDE.md as load-bearing, "don't reintroduce
  an unconditional/deferred write without re-deriving why rollback was chosen") is preserved: same
  optimistic-write-then-snapshot-then-rollback-on-failure shape, just operating on the bucket layer
  now in addition to the whole-file layer.
- **`jdIsFile`**: unchanged as a plain-object guard, but now also needs to gate each city's *bucket*
  the same way it already gates the whole file — a poisoned `whole.abudhabi` (e.g. hand-edited to
  `[]`) must fall back to an empty bucket rather than being built on, exactly mirroring the existing
  "a loaded file must be a plain object, never assumed" rule one level deeper.

## Migration

A one-time script (not app code, run once by hand against the live Gist before the code change
ships):

1. Fetch the current flat file.
2. Since every shift is already `city: "abudhabi"`, the new shape is simply
   `{v:2, abudhabi: {judges: <current judges as-is>, shifts: <current shifts as-is>}, dubai:
   {judges:[], shifts:[]}, updatedAt: <now>}`. No per-judge splitting logic is actually needed given
   the confirmed 100%-Abu-Dhabi current state — this is captured here as a fact about *this*
   migration, not as something the migration script needs to compute generally.
3. Dry run: print old vs. new judge/shift counts per bucket for confirmation before writing.
4. PATCH the single file back to the same Gist ID, same file name.
5. Verify: re-read the Gist, confirm `abudhabi` bucket has 12 judges / 98 shifts (byte-identical
   judge and shift objects, only relocated), confirm `dubai` bucket is present and empty.

The app's `loadJudges()`/`loadJudgesFromGist()` are written to also tolerate an old-shape flat file
being present (i.e., `whole.abudhabi` missing but `whole.judges` present) by falling back to
`jdNew()`'s empty bucket rather than crashing — this is a safety net in case the code deploys before
the migration runs, or the migration needs to be re-run, not a feature to rely on generally.

## Out of scope

- No change to `JD_TIERS`, `JD_TYPES`, rank-computation thresholds, or the retire/un-retire flow —
  all of that logic is untouched, just re-scoped to run over one city's bucket at a time.
- No change to how a shift is logged (still requires an active night/event per city, per the
  existing "one event per night per city" rule) — that rule already operates per-city and needed no
  change.
- No cross-city judge lookup/suggestion in Log-a-Shift, per explicit confirmation above.
- No change to the Settings "custom judges Gist ID" override mechanism.

## Testing

No committed automated test suite (per CLAUDE.md — tests are scratchpad-only, and this session has
no local node/python to run one anyway). Manual verification after migration + deploy:

1. Load the live site as Abu Dhabi, open Judges — confirm roster, ranks, and shift history are
   unchanged from before the migration (12 judges, same ranks, same shift counts).
2. Switch to Dubai, open Judges — confirm an empty roster and Log-a-Shift shows no existing
   candidates.
3. Log a brand-new shift in Dubai for a name that already exists in Abu Dhabi's roster (e.g.
   "Galoonga") — confirm it creates a **new, independent** Dubai judge record (rank starts at
   Bronze/1 shift), and that Abu Dhabi's "Galoonga" is completely unaffected (still their original
   rank/shift count).
4. Re-fetch the Gist directly and confirm Abu Dhabi's bucket still has its original 12 judges'
   worth of data plus the untouched pre-existing shifts, and Dubai's bucket has exactly the one new
   judge/shift just logged — proving the save-path merge didn't clobber the other city's bucket.
