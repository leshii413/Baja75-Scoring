# Baja75 Scoring Management System: user guide

## The idea in one minute

1. Drivers race a course with the **Baja75 Navigation Unit** in BeamNG. Every timed run goes into their
   `settings/TreadXLGPS/race_log.txt`. From Navigation Unit v3.1.5 they can press **MENU › Times › Export** to get a
   copy named after them (`settings/TreadXLGPS/exports/Baja75_results_<driver>_<number>_<date>.txt`) and send it to you.
2. You **import** the files, telling the app **who drove** each file and **which race event** the runs belong to.
3. You **map vehicles to classes** once (e.g. model `utv` → Class 1).
4. You set your **penalty seconds** per warning.
5. You pick each driver's **official attempt** (or let a time-trial event take the best one), check the class results,
   and **finalize** the event.
6. **Overall Score** adds up the finalized events of the season, class by class.

Everything saves on its own (top right: *All changes saved on this device*). Download a **backup** now and then.

## Importing (Import Data)

- **Choose files**, drag them onto the box, or **paste** the text of a run log. Several files at once is fine.
- Accepted: run logs (`.txt`), times files (`times/<map>/<name>.json`, finished runs only, no warnings or driver, and
  you type the map), and the **manual CSV template** (Settings / Backup › CSV template) for results typed by hand.
- **1. Driver for each file.** The log doesn't reliably say who drove, so you choose. If the log has a *Driver* field
  (v3.1.5+) and it matches one registered driver exactly, it's pre-selected: check it. **+ New driver** creates one.
  A file with several drivers: change the driver row by row in the review table.
- **2. Race event for each course.** Runs are grouped by the course name exactly as the log shows it (e.g.
  `route 20261007 082741`). Pick the event (round) they belong to, or **+ New event for this course**. The same course
  can be raced in several rounds: runs never merge into another round by themselves.
- **3. Review.** Each run shows **ADD**, **DUPLICATE** (already imported for this driver and event, even from a renamed
  file), **HOLD** (a changed copy of a run you already have: kept for review, never overwriting), or **UNASSIGNED**
  (no driver or event yet: kept, listed under *Unassigned runs*, never scored). Lines the app can't read are listed as
  **rejected** with the reason, and kept with the import.
- Missing warning counts stay **unknown** (not zero). A run log written with the damage log turned off has no Damage
  count, for example.

## Classes & Vehicles

- The 14 classes: Class 1, 2, 3, 4, 5, 5U, 6, 7, 8, 9, 10, 11, 15, 18. Class 5 and 5U are separate.
- A run is only in a class when its vehicle is **mapped**: by **model ID** (the last bracket in the vehicle, e.g. `utv`)
  or by the **exact configuration** as shown (e.g. `Hirochi Aurata Race (CVT)`). Nothing is guessed from names.
- A mapping can apply to **all events** (template) or **only one event**. Most specific wins: set by hand on a run ›
  the event's configuration › the event's model › template configuration › template model.
- Two mappings at the same level pointing to different classes are a **conflict**: those runs stay unassigned until
  you remove one.
- Unmapped vehicles appear under **Unassigned vehicles** here and on each race page, with a quick class picker.
- A single run can be put in a class by hand: race page › Details › Source record › Class (asks for a reason).

## Penalties

- One rule per counter from the log: Off course, Wrong way, Speeding, Missed VCPs, Jump starts, Resets, Recoveries,
  Damage. Each has a name, a reason (required) and **seconds per occurrence: a whole number 0–9999**. Blank = not set
  (an enabled rule with no seconds stops the event from being finalized).
- **Rates start at 0.** They are not official amounts: set what the Baja75 rulebook says.
- `penalty = count × seconds`; `adjusted time = raw time + all penalties`. All in whole milliseconds.
- The **default template** is copied into each new event; each event then has its own rules (Rule set picker).
  *Reset from template* copies the template in again. A finalized event's rules are frozen with its results.
- The counts in the run line are what's charged. The off-course moments and damage hits listed under a run are details
  (and may be cut short in long runs): they're never charged on top. One crash that broke five parts is **one** damage
  incident. **Time off course** is for review and isn't charged.
- Two rules on the same counter only count when you tick **Stacking intended** on both.
- On a race page, open a driver's **Details** to **waive** a penalty, **correct** a count (both need a reason), or
  **add a manual penalty** (name, reason, count, seconds each).
- The **live preview** under the rules shows the selected event's results as you type.

## Race events (Races)

- **Races** lists courses, each with its rounds, the vehicles seen, and the class winners. **Find results** filters
  across the season by event, class, vehicle, driver and status.
- On an event page, **Class results** shows for each class: Class rank · Driver · Race number · Vehicle · Raw time ·
  Penalty time · Adjusted time · Status · Race points. **Overall placement** (all classes by adjusted time) and
  **Raw-time order** are for information: points always come from the class position.
- **Official attempt.** In a *Selected attempt* event (the default) you choose the run that counts: Details › Attempts.
  *Select the only attempt for drivers with one run* does it in one go where there's no choice. In a *Best adjusted
  attempt* event the lowest adjusted time is used. Either way a driver scores **once per event and class**.
- **Statuses:** FINISHED, DNF (the time before stopping is shown, never as a finish time), DNS, DSQ. *Mark DNS / DSQ*
  (reason required) or **Add DNS / DSQ entry** for a driver with no run. Non-finishers get 0 points and no position.
- **Points:** 30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1, then 1 for every later finisher (Settings).
- **Ties:** equal adjusted times share the position and points (1, 1, 3), marked TIE. No hidden tie-breaker.
- **Total Points** at the bottom lists every entry's points for the race.
- **Event settings:** name, round, date, season, format, *Counts toward the season*, *Practice*.

## Finalizing and amendments

- **Finalize** is available when every run has a driver and a class, every entry has its official attempt (or a DNS /
  DSQ), no counted warning is unknown, and every enabled rule has seconds. The page lists what's missing.
- Finalizing **freezes** the results with the rules and points table used (revision 1). Later changes to the template,
  the points table or mappings don't change it.
- To change a finalized event: **Start amendment** (reason), make the changes, **Publish amendment** (reason). The new
  revision replaces the old one in Overall Score; the old one is kept under *Revisions*. Until you publish, the old
  revision still counts. *Cancel amendment* goes back.
- Every scoring change is listed in Settings › Change history (this device only, and not tamper-proof).

## Overall Score

- By class: Rank · Driver · Number · points per round · Total points · Events · Wins · Podiums · Finishes. Equal totals
  share the rank (TIE); wins and podiums don't break ties.
- Only **finalized** events that **count toward the season** and aren't **practice** are added. Tick/untick events
  under *Events in this season*. **Draft preview** adds draft events, clearly marked, for a look ahead.
- A driver who raced in two classes has two separate totals. A Class 7 win adds nothing to their Class 1 total.
- *All drivers, every class combined* adds each driver's class totals together, for reference only: it doesn't crown
  an overall champion.

## Exports, printing, backups

- Race page: **Results CSV**, **Penalties CSV** (every penalty line with its reason), **Print** (or Print to PDF).
- Overall Score: **Overall CSV**, **Print**.
- CSV files open in Excel, LibreOffice or Google Sheets; text that would look like a formula is kept as text.
- **Settings / Backup › Download backup**: one file with everything. **Restore**: the file is checked first; then
  **Merge** (adds what's new; restoring the same backup twice changes nothing) or **Replace everything** (downloads a
  backup of the current data first).

## Changing or deleting saved data (overrides)

Seasons, results and drivers are protected. To change or remove them, press the button with the lock
(**Rename…**, **Delete…**, **Change this run…**, **Delete this run…**, **Revert to draft…**, **Delete event…**, a driver's
**Save…** / **Delete…**). A prompt says exactly what will happen; type **OVERRIDE**, give a reason, and the button unlocks
after **5 seconds**. Every override is listed in Settings › Change history.

- **Seasons** (Settings / Backup › Seasons): rename, or delete a season with all its race events and their results.
  There is always at least one season.
- **Runs** (race page › Details › Source record, or Import Data › Unassigned runs): change the time, status or warning
  counts, or delete the run. The original imported text stays in the source record.
- **Race events** (race page): **Revert to draft** takes a finalized event back to draft (it stops counting until
  finalized again; old revisions are kept, set aside). **Delete event** removes it with its runs and results.
- **Drivers** (Drivers › Edit): change name / number / team, or delete. A deleted driver's runs are kept as unassigned;
  finalized results show "Removed driver" until that event is amended or reverted.
- In a finalized event, changing a run doesn't change the official results until you amend or revert the event.

## Logo and license

- **Settings / Backup › Logo:** choose a PNG, JPG, WebP, GIF or SVG for the menu; **Use the B75 logo** goes back.
- **Settings / Backup › License:** Created by Leshii413 | Baja75 Series (https://www.patreon.com/c/Baja75Series),
  licensed CC BY-NC-SA 4.0.
