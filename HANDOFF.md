# Baja75 handoff notes (for another claude.ai account)

Repo: leshii413/Baja75-Scoring (main). Site: https://leshii413.github.io/Baja75-Scoring/ (gh-pages built by workflow from `app/`).
Layout: `app/` built site, `source/` app source (React 19/TS/Vite, IndexedDB), `live/` live timing (relay, server-plugin, client-bridge, README.md).
Build app: in source, `npm install && npm run build`, copy `dist` to `app/`.

## Versions
- 1.0.1 GitHub hosting. 1.0.2 Discord paste import, "No Data Provided" flagged for manual review, server names are just notes.
- 1.0.3 Rule/Penalty/Class sheet presets 1-3, Dashboard showing sheets used per event/result.
- 1.1.0 Live timing: Cloudflare Worker + Durable Object relay, BeamMP server plugin (Lua), client bridge mod, /embed page, app Live page, setup guide.
- 1.1.1 (this push) default send rate 1 s (was 3 s); optional `sampleMs` mode (sample 0.5 s, send 1 s, track points batched);
  relay stores per-driver trails (8000 pts cap, 1000-pt chunks, persisted every 30 s); embed animates dots between updates; bridge sends every 1 s, changes within 0.5 s.

## Live files
- `live/server-plugin/Resources/Server/Baja75Live/main.lua` config in `data/config.json`: url, key, serverName, intervalMs (500..60000), sampleMs, enabled. Sends via background curl. Console cmd `b75live`.
- `live/client-bridge/.../liveBridge.lua` (zip: `live/baja75_live_bridge.zip`, rebuild with `package_mod.py`).
- `live/relay/src/{state,index,embed}.ts`; secret `PUSH_KEY`; deploy from GitHub, root `live/relay`, `npx wrangler deploy`.
- Free plan budget: 1 s is ~3,600 requests per race hour (about 13 race hours/day if both servers race).

## Tested earlier / not retested in 1.1.1
- Relay unit tests (11) and bridge tests passed. NOT re-run: plugin mock tests (`live/server-plugin/tests`) with 1000 ms and sampleMs, wrangler dev end to end, browser check of embed animation.

## Known gaps / TODO
- App Live page (`source/src/screens/Live.tsx`): still polls at 3 s fallback, no dot interpolation, text may say "3 seconds". Update to 1 s.
- `source/USER_GUIDE.md` Live section and the Docs setup guide still say 3 s; config example `intervalMs` should be 1000.
- Edit PIN lock + public read-only results page (user chose both) never built.
- Navigation Unit hook not wired (needs user's Nav Unit files). Not yet verified in game: BeamJoy fallback field names, PedalHost curl.
- Ideas: map background calibration, `/b75route record`, relay posting to Discord.

## User preferences
Short prose replies, no tables/spreadsheet summaries; just work, minimal reporting. Never commit secrets. Commit trailers per session reminder.
