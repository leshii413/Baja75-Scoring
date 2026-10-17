# Baja75 Live: live race timing for your website and the scoring app

While a race runs, your BeamMP server sends every car's position, time, resets and penalty counts every 3 seconds.
Your website shows a live leaderboard and a map of the route with each car's last known position, and the scoring
app shows the same with penalty estimates from your Penalty Sheet.

```
 Players' game                       PedalHost (BeamMP server)                Cloudflare (free)                 Viewers
 ┌───────────────────────┐ every 3 s ┌──────────────────────────┐ every 3 s ┌─────────────────────────┐  live  ┌──────────────────────┐
 │ Navigation Unit        │ ────────▶ │ Baja75Live plugin         │ ────────▶ │ baja75-live relay        │ ─────▶ │ website <iframe>     │
 │  + Baja75 Live Bridge  │  counters │  + positions, speed,      │   HTTPS   │  races, trails (route),  │        │ scoring app › Live   │
 │    (client mod)        │  & time   │    resets (server-side)   │   + key   │  WebSocket to viewers    │        └──────────────────────┘
 └───────────────────────┘           └──────────────────────────┘           └─────────────────────────┘
```

| Part | Folder | Goes to |
|---|---|---|
| **Relay** (Cloudflare Worker + Durable Object) | `live/relay` | your free Cloudflare account |
| **Server plugin** `Baja75Live` | `live/server-plugin/Resources/Server/Baja75Live` | PedalHost: `Resources/Server/Baja75Live/` |
| **Live Bridge** client mod | `live/baja75_live_bridge.zip` | PedalHost: `Resources/Client/` |
| **Navigation Unit hook** | one line, below | the Navigation Unit editions |

---

## 1. Put the relay on Cloudflare (once, about 10 minutes)

The relay receives the server's data and serves the live page. It runs on Cloudflare's free plan: 100,000 requests a
day. A race sends one request every 3 seconds (1,200 an hour), and viewers watching live cost nothing extra.

**A. From the Cloudflare dashboard (no command line)**
1. Make a free account at https://dash.cloudflare.com/sign-up.
2. **Workers & Pages › Create › Import a repository** › connect GitHub › pick **Leshii413/Baja75-Scoring**.
3. Set **Root directory** to `live/relay`. Leave the deploy command as `npx wrangler deploy`. Deploy.
4. The worker's page shows its address, like `https://baja75-live.<your-name>.workers.dev`.
5. **Settings › Variables and Secrets › Add › Secret**: name `PUSH_KEY`, value a long random password
   (30+ characters, letters and numbers; a password manager can make one). Deploy again if asked.
6. Check: open `https://baja75-live.<your-name>.workers.dev/api/health` → `{"ok":true,"pushKeySet":true}`.

**B. Or from a terminal** (Node.js 20+):
```
cd live/relay
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put PUSH_KEY      # paste your long random password
```

Optional: a custom address like `live.baja75series.com` (Worker › Settings › Domains & Routes), if your domain is on Cloudflare.

## 2. Install on the BeamMP server (PedalHost)

1. With the PedalHost file manager, upload `main.lua` to `Resources/Server/Baja75Live/main.lua`.
2. Upload `baja75_live_bridge.zip` to `Resources/Client/` (players download it automatically when they join).
3. Restart the server. The plugin creates `Resources/Server/Baja75Live/data/config.json`. Edit it:
   ```json
   { "url": "https://baja75-live.<your-name>.workers.dev", "key": "<the same PUSH_KEY>", "serverName": "Baja75 Casual Server", "intervalMs": 3000, "enabled": true }
   ```
   `serverName` is optional: blank uses the server's own name.
4. Restart again. In the server console type **`b75live`**: it shows the relay, whether `curl` is available, how many
   Navigation Units are reporting and the last send result (`OK`, `HTTP 401` = wrong key, `HTTP 000` = address wrong
   or not reachable). The log also says "relay accepted live data" when the first race data arrives.

Nothing is sent while nobody is on a course. It starts by itself when a driver starts a run and stops 10 minutes after the last report.

**Route line (optional).** Without one, the map draws the route from the paths the cars have driven, so it fills in
as the race goes. For the full route from the start, add a file per course in `Resources/Server/Baja75Live/data/routes/`,
e.g. `october3.json`:
```json
{ "course": "BAJA75 Series: October 3rd Race", "points": [[-512.4, 1290.0], [-498.1, 1301.7], [-470.0, 1330.2]] }
```
`course` must match the course name exactly; `points` are world x, y in metres (any number of points).

## 3. Hook the Navigation Unit in (one line)

The Live Bridge carries the Navigation Unit's live state to the server. Wherever the Navigation Unit updates its run
state (once a frame or once a second, both fine; the bridge sends every 3 s and at once on start or finish), add:

```lua
if extensions.baja75_liveBridge then
  extensions.baja75_liveBridge.report({
    course = courseName,                 -- same name as in the run log, e.g. "BAJA75 Series: October 3rd Race"
    state = "running",                   -- "running" | "finished" | "dnf" | "idle"
    elapsedMs = elapsedMs,               -- race time so far (ms)
    finishMs = finishMs,                 -- when finished
    rm = raceMile, routeMiles = routeLength,
    lap = lap, laps = laps,
    vcp = { vcpsCleared, vcpsTotal },
    counters = { offCourse = n, wrongWay = n, speeding = n, missedVcps = n, jumpStarts = n, resets = n, recoveries = n, damageHits = n },
    number = "413", unit = "Adventure Edition", vehicle = vehicleDisplayName,
  })
end
```
Every field except `course` is optional. Send the Navigation Unit files and this can be wired in for you.

**Before the Navigation Unit is hooked in**, the bridge falls back to BeamJoy's race state (course, lap, finished or
DNF), so races still appear live with every car's position and server-counted resets, just without the penalty
counts and race time.

## 4. Show it

- **Website**: paste this where the live results should appear (it always follows the race that's on):
  ```html
  <iframe src="https://baja75-live.<your-name>.workers.dev/embed" title="Baja75 live results" width="100%" height="640" style="border:0;border-radius:8px" loading="lazy"></iframe>
  ```
  `/embed/<race id>` shows one race; add `?view=board` or `?view=map` for one half, `?title=0` to hide the header.
- **Scoring app › Live**: paste the same embed code (or the link) → **Connect** → pick a race that's on → **Watch live**.
  The leaderboard updates every 3 seconds, with off course, wrong way, speeding, missed VCPs, jump starts, resets,
  recoveries and damage, plus an estimated penalty and adjusted time from the Penalty Sheet you choose. The live view
  draws the route and each car's last known position (faded after 15 seconds without an update).

Live numbers are estimates while the race runs. Official results still come from the run logs or Discord results,
imported and finalized as usual.

## What's tested

- Relay: unit tests (`npm test` in `live/relay`) and a local run with `wrangler dev`: key check, races, WebSocket, embed.
- Server plugin: BeamMP test harness (Lua 5.3) sending real requests to the local relay: `live/server-plugin/tests`.
- Bridge: LuaJIT tests with the game stubbed: `live/client-bridge/tests`.
- **Still to check in game**: the Navigation Unit hook, BeamJoy fallback field names on your BeamJoy build, and that
  PedalHost allows `curl` (the `b75live` console command tells you).

Data kept: races and paths for 48 hours after a race ends. Driver names, positions and counts only. No IP addresses.
