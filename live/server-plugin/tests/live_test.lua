-- Baja75Live sending to a local relay (wrangler dev on :8787 with PUSH_KEY=dev-key-123).
local DATA = "Resources/Server/Baja75Live/data"
local function rd(p) local f = io.open(p); if not f then return nil end; local s = f:read("a"); f:close(); return s end
local function sh(c) local f = io.popen(c); local s = f:read("a"); f:close(); return s end
local function waitSend() os.execute("sleep 1.2") end
local function relay(path) return json.decode(sh("curl -s http://127.0.0.1:8787" .. path)) end
S.settings[4] = "/levels/johnson_valley/info.json"
S.settings[5] = "Baja75 Casual Server"
local COURSE = "Mock Test Course " .. os.time()

local hilly = S:join("hilly", { beammp = "1001" })
local fox = S:join("DH_FOX911", { beammp = "1002" })
local free = S:join("Cruiser", { beammp = "1003" })
local v1 = S:spawn(hilly, "dunekicker", { 100, 200, 30 })
local v2 = S:spawn(fox, "brenthel_tt", { 120, 210, 30 })
S:spawn(free, "pickup", { 0, 0, 0 })

-- no Navigation Unit report yet: nothing is sent
S:advance(3000)
expect(rd(DATA .. "/tmp/push1.json") == nil, "quiet while nobody is on a course")

local function navOf(t) return json.encode(t) end
S:clientEvent(hilly, "baja75live_nav", navOf({ course = COURSE, state = "running", elapsedMs = 60000, rm = 1.5, routeMiles = 24, vid = v1, vehicle = "SP Dunekicker (2008) (custom)", number = "413", counters = { offCourse = 1, speeding = 0, bogus = 9 } }))
S:clientEvent(fox, "baja75live_nav", navOf({ course = COURSE, state = "running", elapsedMs = 58000, rm = 2.0, routeMiles = 24, vid = v2, counters = { offCourse = 0 } }))
S:reset(fox, v2); S:reset(fox, v2)
S:setPosition(hilly, v1, 150, 260, 31)
S:advance(3000)
waitSend()
local body = rd(DATA .. "/tmp/push1.json")
expect(body and body:find(COURSE, 1, true), "push body written")
expect(not body:find("bogus"), "unknown counters dropped")
local status = rd(DATA .. "/tmp/status.txt")
expect(status and status:match("200"), "relay accepted the push (status " .. tostring(status) .. ")")
local races = relay("/api/races").races
local race
for _, r in ipairs(races) do if r.name == COURSE then race = r end end
expect(race and race.status == "live", "race is live on the relay")
expect(race.map == "johnson_valley", "map name taken from the level path")
local full = relay("/api/races/" .. race.id .. "?trails=1")
local byName = {}
for _, d in ipairs(full.drivers) do byName[d.name] = d end
expect(byName["DH_FOX911"].rank == 1 and byName["hilly"].rank == 2, "ranked by race mile")
expect(byName["DH_FOX911"].serverResets == 0, "resets before the race started don't count")
expect(byName["hilly"].pos[1] == 150 and byName["hilly"].vehicle == "SP Dunekicker (2008) (custom)", "server position and Nav Unit vehicle name")
expect(byName["hilly"].number == "413" and byName["hilly"].counters.offCourse == 1, "Navigation Unit counters")
expect(byName["Cruiser"] and byName["Cruiser"].navUnit == false and byName["Cruiser"].rank == nil, "freeroamer shown on the map only")

-- resets during the race are counted by the server
S:reset(fox, v2)
S:clientEvent(fox, "baja75live_nav", navOf({ course = COURSE, state = "finished", elapsedMs = 2274771, rm = 24, vid = v2 }))
S:clientEvent(hilly, "baja75live_nav", navOf({ course = COURSE, state = "running", elapsedMs = 2200000, rm = 22, vid = v1 }))
S:setPosition(hilly, v1, 600, 900, 40)
S:advance(3000)
waitSend()
full = relay("/api/races/" .. race.id .. "?trails=1")
byName = {}
for _, d in ipairs(full.drivers) do byName[d.name] = d end
expect(byName["DH_FOX911"].state == "finished" and byName["DH_FOX911"].finishMs == 2274771, "finish recorded")
expect(byName["DH_FOX911"].serverResets == 1, "one reset during the race, counted by the server (got " .. tostring(byName["DH_FOX911"].serverResets) .. ")")
local trail = full.trails["bmp:1001"]
expect(trail and #trail >= 2, "hilly's trail has points")

-- console status
local out = S:console("b75live")
print("console: " .. tostring(out))

-- a player leaving mid-race doesn't break anything
S:leave(hilly)
S:advance(3000)
expect(#S.errors == 0, "no plugin errors")
