# Gulf Nexus League (GNL) — Season Framework

> **Status:** agreed framework, ingested 2026-10-28 as supplied by the organiser. **Implemented in `index.html`**
> (the `GNL 2.0 SCORING` block, shown on the GNL tab). The finals, LCQ and group-stage parts are not app features.
> Awards were scrapped. The old 3/1/0 scoring is described only in `league-and-awards.md` as history.
>
> **Organiser decisions, 2026-10-28 (not part of the supplied text):**
> - Events from **16 Oct 2026** (Radiance start) through 8 Nov are part of GNL 2.0, although the framework's season dates start 9 Nov.
> - Eligible events are designated with the existing per-event **counts** flag.
> - The awards system is **scrapped entirely** in favour of this points structure (not yet removed from the app).
> - Event type is recorded per ledger event (`type`: NN / PR / C / S, same codes as Judges). It is set **only for GNL events** (no back-fill), and an event **cannot be flagged `counts` without one**.
> - Pre-Rift events and open play are **ineligible**; they stay in the ledger for history and back-fill only.
> - **Byes count as match wins.**
> - A player who **drops** forfeits participation points. Participation = completing the Nexus Night, or completing **all** Swiss rounds of a Skirmish.
> - Designated Nexus Nights are **always 3-round** events.
> - **Tie-break sequence (agreed):** 1) GNL score; 2) Skirmish raw points (best 4); 3) total Swiss match wins across counted events; 4) head-to-head, if they played each other; 5) a playoff or organiser decision. Cutoff and LCQ dates are irrelevant to the app, since every event is harvested.
> - **Home emirate (interim rule):** the emirate where the player has played more *eligible* events (tie: the emirate of their most recent one). To be revisited. Dubai data is being fixed by the organiser, so Dubai work waits.
>
> **How the app implements the open points (decided during the build):**
> - Byes are stored in the ledger (`b`) and score as wins; an event with no bye record is flagged on the GNL tab.
> - Participation = a result (match or bye) in every Swiss round of that event; a Skirmish with fewer than 5 rounds is still eligible and simply scores less (no normalisation).
> - Skirmish placement is read from the ledger's top-cut rounds by round size (≤8 = Top 8, ≤4 = Top 4, 2 = Final, last one-match round's winner = champion).
> - The Nexus Night undefeated bonus is "won every Swiss round", flagged if the event isn't 3 rounds.
> - Head-to-head uses every counted match between the tied players; players still level share a rank and are flagged "unresolved".

**Season:** November 9, 2026 – January 16, 2027  
**Regions:** Abu Dhabi and Dubai  
**Championship Finals:** Saturday, January 16, 2027  
**Finalists:** 16 total (8 from each emirate)

## 1. League structure

GNL combines two event types into separate Abu Dhabi and Dubai league standings:

- **Nexus Nights:** Casual events, assumed to consist of 3 Swiss rounds. Each player's **best 6** eligible Nexus Night results count.
- **Skirmishes:** Competitive events, assumed to consist of 5 Swiss rounds followed by a top cut. Each player's **best 4** eligible Skirmish results count, selected from their **first 8 eligible Skirmish appearances**.

Players declare a home emirate before earning GNL points. Eligible events attended in either emirate may contribute to the player's declared emirate standings.

## 2. Nexus Night event scoring

| Achievement | Raw points |
|---|---:|
| Participation (complete event) | 2 |
| Each Swiss match win | 2 |
| Each Swiss match draw | 1 |
| Undefeated 3–0 bonus | 2 |
| **Maximum per event** | **10** |

Examples without draws: 3–0 = 10; 2–1 = 6; 1–2 = 4; 0–3 = 2.

## 3. Skirmish event scoring

| Achievement | Raw points |
|---|---:|
| Participation (complete Swiss) | 3 |
| Each Swiss match win | 3 |
| Each Swiss match draw | 1 |
| Reach Top 8 | 6 |
| Reach Top 4 | 4 additional |
| Reach Final | 4 additional |
| Win tournament | 5 additional |
| **Maximum per event** | **37** |

Placement bonuses are cumulative: Top 8 = 6, Top 4 = 10, finalist = 14, champion = 19. Only Swiss matches generate win/draw points; top-cut matches are reflected in placement bonuses.

**Scoring assumption:** Use the agreed fixed five-round Swiss scoring; no adjustment or normalization for other Swiss round counts.

## 4. League scoring and weighting

The league has a maximum of **200 weighted points**, divided into **60% Skirmishes** and **40% Nexus Nights**.

| Component | Results counted | Maximum raw points | Maximum weighted points |
|---|---:|---:|---:|
| Skirmishes | Best 4 | 148 | 120 |
| Nexus Nights | Best 6 | 60 | 80 |
| **Total** | | **208** | **200** |

**Formula:**

```text
GNL Score = (Sum of best 4 Skirmish raw scores / 148) * 120
          + (Sum of best 6 Nexus Night raw scores / 60) * 80
```

The 60/40 split refers to the *maximum available points*, not a mandatory split in each player's actual score. Retain calculation precision; no additional rounding rule has been adopted.

## 5. Qualification pathway

Each emirate has its own standings and qualification places:

1. **Direct qualification:** The top **6** players on the emirate's final league standings qualify for the GNL Finals.
2. **Last Chance Qualifier (LCQ):** Each emirate holds one LCQ for players who have not already qualified directly. The **top 2** players from each LCQ qualify for the Finals.
3. **GNL Finals:** 8 Abu Dhabi qualifiers + 8 Dubai qualifiers = **16 finalists**.

LCQs are standalone events: their results do **not** award regular-season league points. Proposed LCQ structure is Swiss rounds into a Top 8 cut, subject to turnout. Already-qualified players are not eligible for LCQs.

## 6. GNL Championship Finals

**Date:** Saturday, January 16, 2027.

- **Group stage:** 16 players divided into 4 groups of 4.
- **Group format:** GSL-style double-elimination groups.
- **Advancement:** Top 2 from each group advance (8 players total).
- **Playoffs:** Top 8 single-elimination bracket, ending with one GNL Champion.
- **Seeding approach:** Aim for 2 Abu Dhabi and 2 Dubai players in each group.

## 7. Operational rules and open items

- The **first 8 eligible Skirmish appearances** are the pool from which each player's best 4 results are counted. This limits the advantage of having access to more Skirmishes.
- Nexus Night standings use the best 6 eligible results; no separate Nexus Night attempt cap has been agreed.
- Eligible events should be announced as GNL-counting events in advance.
- Participation points require completing the relevant event/Swiss rounds, subject to organizer-approved exceptions.
- If a directly qualified player declines, the next eligible player from the same emirate's standings receives the invitation.
- **Still to finalize:** Regular-season points cutoff date, LCQ dates, exact tie-break sequence, treatment of byes/drops, and scoring for Skirmishes with nonstandard top cuts or Swiss-only formats.

---

*Framework version: GNL 2.0 — agreed scoring and qualification structure as of October 28, 2026.*
