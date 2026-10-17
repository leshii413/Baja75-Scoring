-- LuaJIT test of the bridge with the game and BeamMP globals stubbed.
local sent = {}
log = function() end
jsonEncode = function(t)  -- tiny encoder for flat-ish tables
  local function enc(v) if type(v) == "table" then local o = {} for k, x in pairs(v) do o[#o+1] = string.format("%q:%s", tostring(k), enc(x)) end return "{" .. table.concat(o, ",") .. "}" elseif type(v) == "string" then return string.format("%q", v) else return tostring(v) end end
  return enc(t) end
MPCoreNetwork = { isMPSession = function() return true end }
TriggerServerEvent = function(name, data) sent[#sent+1] = { name = name, data = data } end
MPConfig = { getNickname = function() return "hilly" end }
be = { getPlayerVehicle = function() return { getID = function() return 4242 end } end }
MPVehicleGE = { getServerVehicleID = function(gid) return gid == 4242 and "3-1" or nil end }
local B = dofile(arg[1] .. "/lua/ge/extensions/baja75/liveBridge.lua")
local fails = 0
local function expect(c, m) if not c then fails = fails + 1; print("FAIL " .. m) else print("ok   " .. m) end end
local function run(sec) for _ = 1, math.floor(sec * 10) do B.onUpdate(0.1) end end

run(5); expect(#sent == 0, "nothing sent without a report or a BeamJoy race")
B.report({ course = "C", state = "running", elapsedMs = 1000, counters = { offCourse = 1 } })
expect(#sent == 1 and sent[1].name == "baja75live_nav" and sent[1].data:find('"vid":1'), "run start sent at once with the server vehicle id")
run(2.9); expect(#sent == 1, "no second send within 3 s")
run(0.2); expect(#sent == 2, "next send after 3 s")
for i = 1, 100 do B.report({ course = "C", state = "running", elapsedMs = 1000 + i }) end
expect(#sent == 2, "reporting every frame doesn't flood the server")
run(3.0); expect(#sent == 3 and sent[3].data:find('"elapsedMs":1100'), "latest state is what goes out")
B.report({ course = "C", state = "finished", elapsedMs = 2274771 })
expect(#sent == 3, "finish right after a send waits for the 1 s minimum gap")
run(1.05); expect(#sent == 4 and sent[4].data:find('"state":"finished"'), "finish sent within a second")
run(11); local n = #sent; run(6)
expect(#sent == n, "stops sending once Navigation Unit reports are stale")
B.report({ course = "", state = "running" }); B.report("junk"); B.report(nil)
expect(#sent == n, "ignores bad reports")
-- BeamJoy fallback
beamjoy_raceRunner = { session = { state = "RACE", raceName = "BJ Race", settings = { laps = 3 }, participants = { { playerName = "hilly", currentLap = 2, finished = false } } } }
run(3.1)
expect(#sent == n + 1 and sent[#sent].data:find('"course":"BJ Race"') and sent[#sent].data:find('"source":"beamjoy"') and sent[#sent].data:find('"lap":2'), "BeamJoy race state used when the Navigation Unit is silent")
beamjoy_raceRunner.session.state = "FINISHED"; local m = #sent; run(6)
expect(#sent == m, "nothing sent when BeamJoy has no race running")
-- single player: never calls BeamMP
MPCoreNetwork.isMPSession = function() return false end
m = #sent; B.report({ course = "C", state = "running" }); run(6)
expect(#sent == m, "single player: nothing sent")
print(fails == 0 and "ALL PASSED" or (fails .. " FAILED")); os.exit(fails == 0 and 0 or 1)
