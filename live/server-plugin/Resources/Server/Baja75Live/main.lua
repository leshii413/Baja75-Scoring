--[[
Baja75Live — BeamMP server plugin (Lua 5.3, BeamMP-Server 3.x)

Every 3 seconds, while a race is on, sends every player's live data to the Baja75 live relay (a Cloudflare Worker):
  * position, speed and heading of the car (read by the server: MP.GetPositionRaw)
  * resets (counted by the server: onVehicleReset)
  * what the Baja75 Navigation Unit reports through the live bridge client mod (event "baja75live_nav"):
    course, run state, elapsed time, race mile, laps, VCPs, off course / speeding / damage … counters

Setup: edit data/config.json (created on first start):  url = your relay address, key = the PUSH_KEY you set on it.
Optional route lines: data/routes/<anything>.json  →  { "course": "BAJA75 Series: October 3rd Race", "points": [[x, y], …] }
Console: "b75live" shows the status.

Nothing is sent while nobody is on a course. Sending uses curl in the background (the same way plugins post to
Discord), so the server never waits for the network.
]]

local PLUGIN = "Baja75Live"
local ROOT = "Resources/Server/" .. PLUGIN
local DATA = ROOT .. "/data"           -- written files live here, never in the plugin root (that would hot-reload it)
local VERSION = "1.0.0"

local cfg = { url = "", key = "", serverName = "", intervalMs = 3000, enabled = true }
local nav = {}        -- player key -> { data = {...}, at = os.time(), vid = n }
local resets = {}     -- player key -> resets seen since the player joined
local keyOf = {}      -- pid -> player key
local routes = {}     -- course -> points
local lastNavAt = 0   -- last time any Navigation Unit report arrived
local lastRouteSend = 0
local seq = 0
local curlOk = nil
local lastStatus, lastStatusLogged = "", ""
local isWin = false

local function log(msg) print("[" .. PLUGIN .. "] " .. msg) end
local function now() return os.time() end

local function readFile(p)
  local f = io.open(p, "r"); if not f then return nil end
  local s = f:read("a"); f:close(); return s
end
local function writeFile(p, s)
  local f, err = io.open(p, "w"); if not f then return false, err end
  f:write(s); f:close(); return true
end
local function shq(s)  -- quote one shell argument
  if isWin then return '"' .. tostring(s):gsub('"', '') .. '"' end
  return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

local function loadConfig()
  FS.CreateDirectory(DATA)
  FS.CreateDirectory(DATA .. "/routes")
  FS.CreateDirectory(DATA .. "/tmp")
  local p = DATA .. "/config.json"
  local text = readFile(p)
  if not text then
    writeFile(p, Util.JsonPrettify and Util.JsonPrettify(Util.JsonEncode(cfg)) or Util.JsonEncode(cfg))
    log("created " .. p .. ": set url and key to start sending live data")
    return
  end
  local c = Util.JsonDecode(text)
  if type(c) ~= "table" then log("data/config.json is not valid JSON: live data is off"); cfg.enabled = false; return end
  if type(c.url) == "string" then cfg.url = c.url:gsub("/+$", "") end
  if type(c.key) == "string" then cfg.key = c.key end
  if type(c.serverName) == "string" then cfg.serverName = c.serverName end
  if type(c.intervalMs) == "number" and c.intervalMs >= 1000 and c.intervalMs <= 60000 then cfg.intervalMs = math.floor(c.intervalMs) end
  if c.enabled == false then cfg.enabled = false end
  if not cfg.url:match("^https?://") or cfg.key == "" or cfg.key == "CHANGE-ME" then
    log("data/config.json needs url (https://…) and key: live data is off until then")
  end
end

local function loadRoutes()
  routes = {}
  local dir = DATA .. "/routes"
  for _, name in ipairs(FS.ListFiles(dir) or {}) do
    if name:match("%.json$") then
      local r = Util.JsonDecode(readFile(dir .. "/" .. name) or "")
      if type(r) == "table" and type(r.course) == "string" and type(r.points) == "table" and #r.points > 1 then
        local pts = {}
        for i = 1, math.min(#r.points, 20000) do
          local q = r.points[i]
          if type(q) == "table" and type(q[1]) == "number" and type(q[2]) == "number" then pts[#pts + 1] = { q[1], q[2] } end
        end
        if #pts > 1 then routes[r.course] = pts end
      end
    end
  end
end

local function checkCurl()
  local f = io.popen(isWin and "curl --version 2>NUL" or "curl --version 2>/dev/null")
  local out = f and f:read("a") or ""
  if f then f:close() end
  curlOk = out:match("^curl") ~= nil
  if not curlOk then log("curl was not found on this server: live data can't be sent (ask your host to allow curl)") end
end

local function playerKey(pid)
  local ids = MP.GetPlayerIdentifiers(pid) or {}
  if ids.beammp and ids.beammp ~= "" then return "bmp:" .. ids.beammp, ids.beammp end
  return "name:" .. string.lower(MP.GetPlayerName(pid) or ("pid" .. pid)), nil
end

-- --------------------------------------------------------------------------- events

function onInit()
  isWin = MP.GetOSName() == "Windows"
  loadConfig(); loadRoutes(); checkCurl()
  MP.RegisterEvent("onPlayerJoin", "b75live_onJoin")
  MP.RegisterEvent("onPlayerDisconnect", "b75live_onDisconnect")
  MP.RegisterEvent("onVehicleReset", "b75live_onReset")
  MP.RegisterEvent("baja75live_nav", "b75live_onNav")
  MP.RegisterEvent("onConsoleInput", "b75live_onConsole")
  MP.RegisterEvent("b75live_tick", "b75live_tick")
  MP.CreateEventTimer("b75live_tick", cfg.intervalMs)
  log("v" .. VERSION .. " ready" .. (cfg.enabled and "" or " (disabled in config)"))
end

function b75live_onJoin(pid)
  local k = playerKey(pid)
  keyOf[pid] = k
  resets[k] = resets[k] or 0
end

function b75live_onDisconnect(pid)
  local k = keyOf[pid]
  if k then nav[k] = nil end
  keyOf[pid] = nil
end

function b75live_onReset(pid, vid)
  local k = keyOf[pid] or playerKey(pid)
  keyOf[pid] = k
  resets[k] = (resets[k] or 0) + 1
end

local STATES = { running = true, finished = true, dnf = true, idle = true }
local COUNTERS = { "offCourse", "wrongWay", "speeding", "missedVcps", "jumpStarts", "resets", "recoveries", "damageHits" }
local function n(v, lo, hi) if type(v) == "number" and v == v and v >= lo and v <= hi then return v end end
local function s(v, max) if type(v) == "string" then return (v:gsub("[%c]", "")):sub(1, max) end end

-- the Navigation Unit's report, sent by the live bridge client mod. Treated as untrusted input.
function b75live_onNav(pid, data)
  if type(data) ~= "string" or #data > 4000 then return end
  local d = Util.JsonDecode(data)
  if type(d) ~= "table" then return end
  local course = s(d.course, 100)
  if not course or course == "" then return end
  local out = {
    course = course, state = STATES[d.state] and d.state or nil,
    elapsedMs = n(d.elapsedMs, 0, 86400000), finishMs = n(d.finishMs, 0, 86400000),
    rm = n(d.rm, 0, 10000), routeMiles = n(d.routeMiles, 0, 10000), lap = n(d.lap, 0, 1000), laps = n(d.laps, 0, 1000),
    number = s(d.number, 8), unit = s(d.unit, 40), counters = {},
  }
  if type(d.vcp) == "table" and n(d.vcp[1], 0, 10000) and n(d.vcp[2], 0, 10000) then out.vcp = { d.vcp[1], d.vcp[2] } end
  if type(d.counters) == "table" then
    for _, c in ipairs(COUNTERS) do local v = n(d.counters[c], 0, 100000); if v then out.counters[c] = math.floor(v) end end
  end
  local k = keyOf[pid] or playerKey(pid)
  keyOf[pid] = k
  nav[k] = { data = out, at = now(), vid = n(d.vid, 0, 1000), vehicle = s(d.vehicle, 80) }
  lastNavAt = now()
end

function b75live_onConsole(input)
  if type(input) ~= "string" or not input:match("^%s*b75live") then return end
  local active = 0
  for _, v in pairs(nav) do if now() - v.at < 10 then active = active + 1 end end
  return string.format("%s v%s · relay %s · key %s · curl %s · Nav Units reporting %d · last send: %s",
    PLUGIN, VERSION, cfg.url ~= "" and cfg.url or "(not set)", cfg.key ~= "" and "set" or "(not set)",
    curlOk and "ok" or "missing", active, lastStatus ~= "" and lastStatus or "nothing sent yet")
end

-- --------------------------------------------------------------------------- sending

local function yaw(rot)
  if type(rot) ~= "table" or #rot < 4 then return nil end
  local x, y, z, w = rot[1], rot[2], rot[3], rot[4]
  return math.atan(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
end

local function vehicleName(raw)
  if type(raw) ~= "string" then return nil end
  local j = Util.JsonDecode(raw:match("{.*$") or "")
  if type(j) ~= "table" then return nil end
  return s(j.jbm, 60) or s(j.vcf and j.vcf.model, 60)
end

local function collect()
  local players = {}
  for pid, name in pairs(MP.GetPlayers() or {}) do
    local k, beammp = playerKey(pid)
    keyOf[pid] = k
    local navd = nav[k]
    if navd and now() - navd.at > 10 then navd = nil end           -- stale reports are not sent
    local vehicles = MP.GetPlayerVehicles(pid) or {}
    local vid = navd and navd.vid
    if vid == nil or vehicles[vid] == nil then vid = nil; for v in pairs(vehicles) do if vid == nil or v < vid then vid = v end end end
    local p = { pid = pid, name = name, beammp = beammp, resets = resets[k] or 0, nav = navd and navd.data or nil }
    if vid ~= nil then
      local pos, err = MP.GetPositionRaw(pid, vid)
      if err == "" and type(pos) == "table" and type(pos.pos) == "table" then
        p.pos = { pos.pos[1], pos.pos[2], pos.pos[3] }
        if type(pos.vel) == "table" then p.speed = math.sqrt((pos.vel[1] or 0) ^ 2 + (pos.vel[2] or 0) ^ 2 + (pos.vel[3] or 0) ^ 2) end
        p.heading = yaw(pos.rot)
      end
      p.vehicle = (navd and navd.vehicle) or vehicleName(vehicles[vid])
    end
    players[#players + 1] = p
  end
  return players
end

local function readStatus()
  local st = readFile(DATA .. "/tmp/status.txt")
  if not st then return end
  st = st:gsub("%s+$", "")
  if st == "" then return end
  lastStatus = (st == "200" and "OK" or ("HTTP " .. st)) .. " at " .. os.date("!%H:%M:%S") .. " UTC"
  if st ~= lastStatusLogged then
    if st == "200" then log("relay accepted live data")
    elseif st == "401" then log("relay refused the key (401): check key in data/config.json")
    elseif st == "000" then log("relay not reachable: check url in data/config.json")
    else log("relay answered HTTP " .. st) end
    lastStatusLogged = st
  end
end

local function post(body)
  seq = (seq % 3) + 1                                     -- rotate files: the previous send may still be running
  local file = DATA .. "/tmp/push" .. seq .. ".json"
  if not writeFile(file, body) then log("can't write " .. file); return end
  local hdr = DATA .. "/tmp/auth.txt"
  writeFile(hdr, "Authorization: Bearer " .. cfg.key .. "\n")   -- the key stays out of the process list
  local cmd = "curl -s -m 8 -X POST -H " .. shq("Content-Type: application/json") .. " -H @" .. shq(hdr)
    .. " --data-binary @" .. shq(file) .. " -o " .. (isWin and "NUL" or "/dev/null") .. " -w " .. shq("%{http_code}")
    .. " " .. shq(cfg.url .. "/api/push") .. " > " .. shq(DATA .. "/tmp/status.txt")
  if isWin then os.execute('start "" /B cmd /C "' .. cmd .. ' 2>NUL"') else os.execute(cmd .. " 2>/dev/null &") end
end

function b75live_tick()
  readStatus()
  if not cfg.enabled or not curlOk or cfg.key == "" or cfg.key == "CHANGE-ME" or not cfg.url:match("^https?://") then return end
  -- only while a race is on: a Navigation Unit reported in the last 10 minutes
  if lastNavAt == 0 or now() - lastNavAt > 600 then return end
  local payload = { v = 1, server = cfg.serverName ~= "" and cfg.serverName or (MP.Get(MP.Settings.Name) or ""), map = "", t = now(), players = collect() }
  local map = MP.Get(MP.Settings.Map) or ""
  payload.map = map:match("/levels/([^/]+)/") or map
  if now() - lastRouteSend >= 60 then
    local r, any = {}, false
    for _, v in pairs(nav) do local c = v.data.course; if routes[c] and not r[c] then r[c] = routes[c]; any = true end end
    if any then payload.routes = r; lastRouteSend = now() end
  end
  post(Util.JsonEncode(payload))
end
