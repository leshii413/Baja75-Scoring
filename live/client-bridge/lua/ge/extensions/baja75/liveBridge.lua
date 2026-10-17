--[[
Baja75 Live Bridge (BeamNG GE Lua, LuaJIT). Extension: baja75_liveBridge

Sends this player's live race state to the Baja75Live server plugin every 3 seconds (and right away when a run
starts or ends). The server adds the car's position and resets and forwards everything to the live results page.

Where the state comes from:
  1. The Baja75 Navigation Unit, which calls (any time, as often as it likes):
       if extensions.baja75_liveBridge then extensions.baja75_liveBridge.report(state) end
     state = { course =, state = "running"|"finished"|"dnf"|"idle", elapsedMs =, finishMs =, rm =, routeMiles =,
               lap =, laps =, vcp = { cleared, total }, number =, unit =, vehicle =,
               counters = { offCourse =, wrongWay =, speeding =, missedVcps =, jumpStarts =, resets =, recoveries =, damageHits = } }
  2. Without Navigation Unit reports: BeamJoy's race state (course name, lap, finished / DNF), so the live page still
     has the race and every car's position. No penalty counts in that case.
]]
local M = {}
local TAG = "baja75Live"
local EVENT = "baja75live_nav"
local INTERVAL = 3.0
local STALE = 10.0

local latest, latestAt, lastSentState = nil, -1e9, nil
local clock, sinceSend = 0, 1e9

local function isMP()
  return MPCoreNetwork ~= nil and MPCoreNetwork.isMPSession ~= nil and MPCoreNetwork.isMPSession() and TriggerServerEvent ~= nil
end

local function myServerVid()
  if not (be and MPVehicleGE and MPVehicleGE.getServerVehicleID) then return nil end
  local veh = be:getPlayerVehicle(0)
  if not veh then return nil end
  local sid = MPVehicleGE.getServerVehicleID(veh:getID())  -- "pid-vid"
  local vid = type(sid) == "string" and tonumber(sid:match("%-(%d+)$")) or nil
  return vid
end

-- BeamJoy fallback: course and run state from BeamJoy's race runner (nil-checked: BeamJoy may not be loaded)
local function fromBeamJoy()
  local rr = rawget(_G, "beamjoy_raceRunner") or (extensions and extensions.beamjoy_raceRunner)
  local s = rr and rr.session
  if type(s) ~= "table" or s.state ~= "RACE" then return nil end
  local me = MPConfig and MPConfig.getNickname and MPConfig.getNickname()
  local part
  for _, p in ipairs(s.participants or {}) do if p.playerName == me then part = p end end
  if not part then return nil end
  local name = s.raceName or s.name
  local races = rawget(_G, "beamjoy_races") or (extensions and extensions.beamjoy_races)
  if not name and races and type(races.data) == "table" then
    for _, r in ipairs(races.data) do if r.id == s.raceId then name = r.name end end
  end
  if not name then return nil end
  return {
    course = tostring(name), state = part.dnf and "dnf" or (part.finished and "finished" or "running"),
    lap = tonumber(part.currentLap), laps = s.settings and tonumber(s.settings.laps) or nil, source = "beamjoy",
  }
end

local function send(state)
  local t = {}
  for k, v in pairs(state) do t[k] = v end
  t.vid = myServerVid()
  TriggerServerEvent(EVENT, jsonEncode(t))
  sinceSend = 0
  lastSentState = state.state
end

--- Called by the Navigation Unit with its current state (see the top of this file).
function M.report(state)
  if type(state) ~= "table" or type(state.course) ~= "string" or state.course == "" then return end
  latest, latestAt = state, clock
  -- a run starting or ending goes out straight away (at most once a second)
  if isMP() and state.state ~= lastSentState and sinceSend >= 1.0 then send(state) end
end

function M.onUpdate(dtReal)
  clock = clock + (dtReal or 0)
  sinceSend = sinceSend + (dtReal or 0)
  if not isMP() then return end
  -- a start / finish / DNF that came in just after a send goes out within a second
  if latest and latest.state ~= lastSentState and sinceSend >= 1.0 and clock - latestAt <= STALE then send(latest) return end
  if sinceSend < INTERVAL then return end
  local state = (latest and clock - latestAt <= STALE) and latest or fromBeamJoy()
  if state then send(state) else sinceSend = INTERVAL - 0.5 end  -- check again shortly
end

function M.onBeamMPServerLeave() latest, lastSentState = nil, nil end
function M.onExtensionLoaded() log("I", TAG, "Baja75 Live Bridge loaded") end

return M
