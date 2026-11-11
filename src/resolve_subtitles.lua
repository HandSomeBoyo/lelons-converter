-- VaultHub Subtitles: makes subtitles for the timeline that's open in DaVinci Resolve.
-- Put here by VaultHub. Run it from Workspace > Scripts > VaultHub Subtitles.
-- VaultHub listens to the timeline's sound on this PC (nothing is uploaded),
-- then the subtitles are put on the timeline, timed to it.

local LAUNCH = [[{{LAUNCH}}]]  -- how to start VaultHub if it isn't open
local PORT_FILE = os.getenv("LOCALAPPDATA") .. [[\LelonsConverter\running.port]]
local TEMP = os.getenv("TEMP") or os.getenv("TMP") or "."

-- ---------------------------------------------------------------- little helpers

local function run(command)
  local p = io.popen(command)
  if not p then return "" end
  local out = p:read("*a") or ""
  p:close()
  return out
end

-- A Windows message box, so you know what happened.
local function tell(text)
  print("VaultHub: " .. text)
  local safe = text:gsub("'", "''"):gsub('"', "'")
  run('powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; '
    .. "[void][System.Windows.MessageBox]::Show('" .. safe .. "', 'VaultHub Subtitles')\"")
end

local function sleep(seconds)
  run("ping -n " .. (seconds + 1) .. " 127.0.0.1 >nul")
end

local function json_text(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
  return '"' .. s .. '"'
end

local function json_field(body, name)
  local value = body:match('"' .. name .. '"%s*:%s*"(.-[^\\])"') or body:match('"' .. name .. '"%s*:%s*""') and ""
  if value == nil then
    value = body:match('"' .. name .. '"%s*:%s*([%w%.%-]+)')
  end
  if type(value) == "string" then
    value = value:gsub("\\u(%x%x%x%x)", function(h)
      local n = tonumber(h, 16)  -- back to UTF-8 (letters like ø in folder names)
      if n < 0x80 then return string.char(n) end
      if n < 0x800 then return string.char(0xC0 + math.floor(n / 64), 0x80 + n % 64) end
      return string.char(0xE0 + math.floor(n / 4096), 0x80 + math.floor(n / 64) % 64, 0x80 + n % 64)
    end):gsub('\\"', '"'):gsub("\\/", "/"):gsub("\\\\", "\\")
  end
  return value
end

local function read_port()
  local f = io.open(PORT_FILE, "r")
  if not f then return nil end
  local line = f:read("*l") or ""
  f:close()
  local port, token = line:match("^(%d+)%s+(%S+)")
  return port, token
end

local function ask(port, token, path, body)
  local file = TEMP .. "\\vaulthub-resolve.json"
  local f = io.open(file, "wb")
  f:write(body)
  f:close()
  local out = run('curl.exe -s -m 30 -X POST -H "Content-Type: application/json" -H "X-Lelons-Token: ' .. token
    .. '" --data-binary "@' .. file .. '" http://127.0.0.1:' .. port .. path)
  os.remove(file)
  return out
end

-- ---------------------------------------------------------------- what's on the timeline

local resolve = Resolve()
local project = resolve:GetProjectManager():GetCurrentProject()
local timeline = project and project:GetCurrentTimeline()
if not timeline then
  tell("Open a timeline first, then run VaultHub Subtitles again.")
  return
end

local rate = tostring(timeline:GetSetting("timelineFrameRate") or "")
local fps = tonumber(rate:match("[%d%.]+")) or 24
if fps == 23 then fps = 23.976 elseif fps == 29 then fps = 29.97 elseif fps == 59 then fps = 59.94 end
local first = timeline:GetStartFrame()

local parts = {}
local function add_track(kind, index)
  local items = timeline:GetItemListInTrack(kind, index) or {}
  for _, item in ipairs(items) do
    local enabled = true
    if item.GetClipEnabled then enabled = item:GetClipEnabled() end
    local media = item:GetMediaPoolItem()
    local path = media and media:GetClipProperty("File Path")
    if enabled and path and path ~= "" then
      local from = (item:GetLeftOffset() or 0) / fps
      if item.GetSourceStartTime then
        local ok, start = pcall(function() return item:GetSourceStartTime() end)
        if ok and type(start) == "number" and start >= 0 then from = start end
      end
      parts[#parts + 1] = "{" .. '"path":' .. json_text(path)
        .. ',"from":' .. string.format("%.4f", from)
        .. ',"length":' .. string.format("%.4f", item:GetDuration() / fps)
        .. ',"at":' .. string.format("%.4f", (item:GetStart() - first) / fps) .. "}"
    end
  end
end

for i = 1, timeline:GetTrackCount("audio") do
  local on = true
  if timeline.GetIsTrackEnabled then on = timeline:GetIsTrackEnabled("audio", i) end
  if on then add_track("audio", i) end
end
if #parts == 0 then
  for i = 1, timeline:GetTrackCount("video") do add_track("video", i) end
end
if #parts == 0 then
  tell("There's nothing with sound on this timeline yet.")
  return
end

-- ---------------------------------------------------------------- asking VaultHub

local port, token = read_port()
if not port then
  run('start "" ' .. LAUNCH)
  for _ = 1, 40 do
    sleep(1)
    port, token = read_port()
    if port then break end
  end
  if not port then
    tell("Couldn't start VaultHub. Open VaultHub, then run VaultHub Subtitles again.")
    return
  end
  sleep(2)
end

local answer = ask(port, token, "/api/resolve-subtitles",
  '{"name":' .. json_text(timeline:GetName()) .. ',"parts":[' .. table.concat(parts, ",") .. "]}")
local id = json_field(answer, "id")
if not id then
  tell(json_field(answer, "error") or "VaultHub didn't answer. Make sure it's open and try again.")
  return
end

-- VaultHub shows how it's going in its Files tab. This waits until it's done.
local srt, last = nil, ""
while true do
  sleep(1)
  local state = ask(port, token, "/api/resolve-subtitles-status", '{"id":' .. json_text(id) .. "}")
  local status = json_field(state, "status")
  local message = json_field(state, "message") or ""
  if message ~= last then
    print("VaultHub: " .. message)
    last = message
  end
  if status == "done" then
    srt = json_field(state, "out")
    break
  elseif status ~= "queued" and status ~= "active" then
    if state == "" then
      tell("VaultHub closed before the subtitles were done.")
    else
      tell("The subtitles didn't work: " .. message)
    end
    return
  end
end

-- ---------------------------------------------------------------- onto the timeline

local pool = project:GetMediaPool()
local here = pool:GetCurrentFolder()
local bin = nil
for _, folder in ipairs(pool:GetRootFolder():GetSubFolderList() or {}) do
  if folder:GetName() == "VaultHub subtitles" then bin = folder end
end
bin = bin or pool:AddSubFolder(pool:GetRootFolder(), "VaultHub subtitles")
if bin then pool:SetCurrentFolder(bin) end
local imported = pool:ImportMedia({ srt }) or {}
if here then pool:SetCurrentFolder(here) end
if #imported == 0 then
  tell("The subtitles are ready, but Resolve wouldn't take them in. You can find the file here:\n" .. srt)
  return
end

local placed = nil
pcall(function()
  if timeline:GetTrackCount("subtitle") == 0 then timeline:AddTrack("subtitle") end
  local info = { mediaPoolItem = imported[1], recordFrame = first, trackIndex = 1 }
  local frames = tonumber(imported[1]:GetClipProperty("Frames") or "")
  if frames and frames > 0 then
    info.startFrame = 0
    info.endFrame = frames - 1
  end
  placed = pool:AppendToTimeline({ info })
end)
if placed and #placed > 0 then
  tell("Done! The subtitles are on your timeline. Change the words or style in the Inspector.")
else
  tell("The subtitles are in the Media Pool, in the \"VaultHub subtitles\" bin. Drag them to the very start of your timeline.")
end
