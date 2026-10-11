# Discord results → Baja75 Scoring import (ChatGPT template)

> **Easier from v1.0.2:** paste the Discord posts straight into **Import Data › Paste results from Discord**: no
> ChatGPT or CSV needed. Use this template only if you want the results in a spreadsheet first.

Use this when a driver ran **without the Baja75 Navigation Unit** (or its run log wasn't sent) and the only record is the
result card the server posted to Discord. ChatGPT turns the copied Discord text into a CSV that **Import Data** reads.

Anything the Discord card doesn't show is written as **No Data Provided**. The scoring app treats those rows as
**valid results** and marks them **MANUAL REVIEW** on the race page:

| Column says No Data Provided | What the app does |
|---|---|
| a penalty count (`off_course` … `damage`) | counts as **0**; the race can still be finalized |
| `driver` | the run imports; pick the driver in Import Data |
| `vehicle` | the run imports; set its class by hand on the race page |
| `course`, `map`, `number`, `date`, `laps`, `best_lap`, `notes` | imports; shown as No Data Provided |
| `status` | taken as FINISHED |
| `time` | the result is kept but **can't be ranked**: enter the time (race page › Details › Source record › Change this run) before finalizing |

On the race page, open **Details › Source record** to see what was missing, then **Mark as reviewed…** once you've
checked it (or **Change this run…** to type in real counts; each typed value replaces its marker).

A **blank** cell is different from No Data Provided: blank still means *unknown*, and an unknown penalty count blocks
finalizing while that penalty charges time.

---

## 1. Copy this prompt into ChatGPT

````
You convert Baja75 Discord race result posts into a CSV for the Baja75 Scoring Management System.

Output ONE code block containing CSV with exactly this header row (same names, same order):
driver,number,course,map,vehicle,status,time,date,off_course,wrong_way,speeding,missed_vcps,jump_starts,resets,recoveries,damage,laps,best_lap,notes

One row per result post. Fill each column like this:
- driver: the player name on the first line of the post.
- number: No Data Provided (Discord posts don't show race numbers).
- course: the race title line exactly as written (e.g. BAJA75 Series: October 3rd Race).
- map: No Data Provided.
- vehicle: the text under "Vehicle" exactly as written.
- status: FINISHED.
- time: the total race time in backticks right under the race title (e.g. 38:32.360). NEVER the best lap or the record.
  Copy every digit exactly; keep the 3 decimals.
- date: from the footer (e.g. "10/6/2026 1:09 PM") as YYYY-MM-DD HH:MM:SS UTC+08:00 in 24-hour time (2026-10-06 13:09:00 UTC+08:00).
  The footer may also say Today or Yesterday: use the date I give you below.
- off_course, wrong_way, speeding, missed_vcps, jump_starts, resets, recoveries, damage: No Data Provided
  (Discord posts don't include penalty counts).
- laps: the number under "Laps".
- best_lap: the time under "Best lap".
- notes: start with "From Discord: " then copy any status line such as "Not counted for the leaderboard (...)",
  "New server record ...", and the "Leaderboard #x of y" value, separated by "; ".

Rules:
- If any value is missing from a post, write exactly: No Data Provided
- Never guess or invent a value. Never leave a cell blank.
- Put any cell that contains a comma inside double quotes.
- Ignore the "Record" line (that is someone else's best lap).
- After the code block, list: (1) every row with "Not counted for the leaderboard", (2) any value you were unsure of.

Today's date (for "Today"/"Yesterday" footers): [TYPE TODAY'S DATE, e.g. 2026-10-08]

Results to convert:
[PASTE THE DISCORD TEXT HERE]
````

## 2. Example

Pasted Discord text:

```
DH_FOX911
BAJA75 Series: October 3rd Race
`37:54.771`
Not counted for the leaderboard (anti-cheat options or the vehicle rule were changed)
Best lap
`7:59.556`
Laps
3
Vehicle
Brenthel Gen3 Trophy Truck - Mike Marsal
Record
`6:27.173` hilly
-►Baja75 Casual Server•10/7/2026 9:39 AM

hilly
BAJA75 Series: October 3rd Race
`38:32.360`
New server record, 0.579s faster than their old best
Leaderboard
#1 of 4
Best lap
`6:27.173`
Laps
4
Vehicle
SP Dunekicker (2008) (custom)
-►Baja75 Casual Server•10/6/2026 1:09 PM
```

Expected output:

```csv
driver,number,course,map,vehicle,status,time,date,off_course,wrong_way,speeding,missed_vcps,jump_starts,resets,recoveries,damage,laps,best_lap,notes
DH_FOX911,No Data Provided,BAJA75 Series: October 3rd Race,No Data Provided,Brenthel Gen3 Trophy Truck - Mike Marsal,FINISHED,37:54.771,2026-10-07 09:39:00 UTC+08:00,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,3,7:59.556,"From Discord: Not counted for the leaderboard (anti-cheat options or the vehicle rule were changed)"
hilly,No Data Provided,BAJA75 Series: October 3rd Race,No Data Provided,SP Dunekicker (2008) (custom),FINISHED,38:32.360,2026-10-06 13:09:00 UTC+08:00,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,No Data Provided,4,6:27.173,"From Discord: New server record, 0.579s faster than their old best; Leaderboard #1 of 4"
```

Not counted for the leaderboard: DH_FOX911.

## 3. Import it

1. Save ChatGPT's CSV as a file ending in `.csv` (e.g. `october3_discord.csv`), or paste it straight into Import Data.
2. **Import Data** › choose the file › pick the **driver** for each row and the **race event**.
3. Open the race: rows from Discord show **MANUAL REVIEW**. Check each one, decide on any
   "Not counted for the leaderboard" run (DSQ it, delete it, or keep it, with a reason), then **Mark as reviewed…**.
4. **Before importing, check every time digit by digit against Discord.** ChatGPT copying text is reliable but not perfect,
   and one wrong digit changes the order.
