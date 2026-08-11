# Post-Event Processing: inline "counts" checkbox

## Problem

GNL: Vendetta League Points and Awards are only computed from ledger events flagged
`counts: true` (`rvDeriveFromLedger(hist, {counted: true})`). Nothing on the Event Day tab sets
that flag — it currently requires a second, separate trip to the League History tab to tick a
per-event checkbox after every event.

The organiser's actual workflow is exclusively **Post-Event Processing**: drop all of an event's
round-results CSVs at once, click Process Event, then Save to Gist. They don't use the live
Declare-Vendetta or Record-Results flows. The goal is to make that one flow, by itself, produce a
counted event — without losing the ability to opt an event out.

## Change

Scoped entirely to the Post-Event Processing card (`#tab-league`, the `🌙 Post-Event Processing`
section). The live Declare-Vendetta / Record-Results flows are untouched.

1. **UI**: add a checkbox to the Post-Event Processing card, above or beside the
   Process Event / Save to Gist buttons, checked by default:
   `☑ Counts toward Awards & GNL: Vendetta`.

2. **Save handler**: the `rvPeSaveBtn` click handler (`index.html:5900`) currently calls, per
   event id:
   ```js
   rvHistRecordEvent(hist, {
     id: id, set: rvHistCurrentSet(hist),
     date: new Date().toISOString().slice(0,10),
     src: 'postevent', rounds: byEvent[id]
   });
   ```
   Add `counts: <checkbox checked state>` to that call, read at save time (not at process time),
   so toggling the checkbox after Process Event but before Save still takes effect.

3. **`rvHistRecordEvent`** (`index.html:1967`): currently builds `row` without ever looking at
   `ev.counts`. Add, alongside the existing `if (ev.label) row.label = ev.label;` line:
   ```js
   if (ev.counts) row.counts = true;
   ```
   Matches the existing convention documented in CLAUDE.md: the field is omitted (not set to
   `false`) when off, and every reader already treats absence as off.

## Behavior

- Default path (checkbox left checked): drop CSVs → Process Event → Save to Gist, and the event
  is immediately counted — no visit to League History required.
- Unchecking before Save produces an uncounted event, same as if it had been processed and then
  left unflagged in League History today.
- The League History tab's own checkbox continues to work unchanged and remains the source of
  truth for changing an event's counted status later (e.g. flipping it back on/off after the
  fact, or correcting an event saved via the live flow, which is not touched by this change).
- Re-uploading/re-saving the same event id through Post-Event Processing already replaces the
  whole event row (existing behavior — "re-uploading with a file removed actually removes it").
  This change means a re-save also re-applies whatever the checkbox is set to at that time; if the
  checkbox is unchecked on a re-save, a previously-counted event would lose its `counts` flag.
  This is consistent with "replaces the whole event" semantics already documented and is not a new
  risk introduced by this change, but is worth the organiser knowing about.

## Out of scope

- The live Declare-Vendetta and Record-Results (round-by-round) flows are not touched and gain no
  checkbox — the organiser has said they don't use them.
- No change to `rvDeriveFromLedger`, award computation, or the League History tab's own checkbox
  and toggle handler.
- No change to `vendettaWins`/Vendetta award all-time scoping — unaffected by this change.

## Testing

No committed test suite (see CLAUDE.md — tests are scratchpad-only and not verified as available
this session). Verify manually via the browser preview:

1. Unlock the app, go to Event Day, Post-Event Processing.
2. Confirm the checkbox renders, defaults to checked.
3. Drop round CSVs, Process Event, Save to Gist with checkbox checked — confirm the saved ledger
   event (via mocked/gist state or League History tab) shows `counts: true` and the checkbox in
   League History is pre-ticked for that event.
4. Repeat with the checkbox unchecked before Save — confirm the event has no `counts` key and
   League History shows it unticked.
5. Confirm GNL: Vendetta leaderboard and Awards reflect the counted event immediately after save,
   with no other action taken.
