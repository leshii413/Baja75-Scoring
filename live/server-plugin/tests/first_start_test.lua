-- fresh server: the plugin writes a config template, sends nothing, and never errors
local DATA = "Resources/Server/Baja75Live/data"
local function rd(p) local f = io.open(p); if not f then return nil end; local s = f:read("a"); f:close(); return s end
local cfg = rd(DATA .. "/config.json")
expect(cfg and cfg:find('"key"') and cfg:find('"url"'), "config.json template created")
local p = S:join("hilly", { beammp = "1001" })
S:spawn(p, "dunekicker", { 1, 2, 3 })
S:clientEvent(p, "baja75live_nav", '{"course":"X","state":"running","elapsedMs":1000}')
S:advance(6000)
expect(rd(DATA .. "/tmp/push1.json") == nil, "nothing sent until url and key are set")
S:clientEvent(p, "baja75live_nav", "not json")
S:clientEvent(p, "baja75live_nav", string.rep("x", 5000))
S:clientEvent(p, "baja75live_nav", "[1,2,3]")
S:leave(p)
S:advance(3000)
