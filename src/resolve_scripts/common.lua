-- Shared by the VaultHub buttons in DaVinci Resolve (Workspace > Scripts). Put here by VaultHub.

local LAUNCH = [[{{LAUNCH}}]]  -- how to start VaultHub if it isn't open
local PORT_FILE = os.getenv("LOCALAPPDATA") .. [[\LelonsConverter\running.port]]
local TEMP = os.getenv("TEMP") or os.getenv("TMP") or "."
local SEP = package.config:sub(1, 1)

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
  -- (inside PowerShell's '...': a ' is written twice, and " would end the command, so it becomes ')
  local safe = text:gsub('"', "'"):gsub("'", "''"):gsub("\n", "' + [char]10 + '")
  run('powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; '
    .. "[void][System.Windows.MessageBox]::Show(('" .. safe .. "'), 'VaultHub')\"")
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
  local value = body:match('"' .. name .. '"%s*:%s*"(.-[^\\])"')
  if value == nil and body:match('"' .. name .. '"%s*:%s*""') then return "" end
  if value == nil then
    return body:match('"' .. name .. '"%s*:%s*([%w%.%-]+)')
  end
  value = value:gsub("\\u(%x%x%x%x)", function(h)
    local n = tonumber(h, 16)  -- back to UTF-8 (letters like ø in folder names)
    if n < 0x80 then return string.char(n) end
    if n < 0x800 then return string.char(0xC0 + math.floor(n / 64), 0x80 + n % 64) end
    return string.char(0xE0 + math.floor(n / 4096), 0x80 + math.floor(n / 64) % 64, 0x80 + n % 64)
  end)
  value = value:gsub('\\"', '"'):gsub("\\/", "/"):gsub("\\n", "\n"):gsub("\\\\", "\\")
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

local PORT, TOKEN

-- Ask VaultHub something. Returns its answer (JSON, or plain text for some questions).
local function ask(path, body)
  local file = TEMP .. SEP .. "vaulthub-resolve-" .. tostring(os.time()) .. ".json"
  local f = io.open(file, "wb")
  f:write(body or "{}")
  f:close()
  local out = run('curl.exe -s -m 60 -X POST -H "Content-Type: application/json" -H "X-Lelons-Token: ' .. TOKEN
    .. '" --data-binary "@' .. file .. '" http://127.0.0.1:' .. PORT .. path)
  os.remove(file)
  return out
end

-- Finds VaultHub, starting it if it isn't open. False if it couldn't.
local function connect()
  PORT, TOKEN = read_port()
  if PORT and ask("/api/rt-options", "{}") ~= "" then return true end
  run('start "" ' .. LAUNCH)
  for _ = 1, 45 do
    sleep(1)
    PORT, TOKEN = read_port()
    if PORT and ask("/api/rt-options", "{}") ~= "" then return true end
  end
  tell("Couldn't start VaultHub. Open VaultHub, then try again.")
  return false
end

-- Waits for a job VaultHub is doing. Returns its last status answer, or nil if it failed (and says why).
local function wait_for(id, keep_waiting)
  local last = ""
  while true do
    sleep(1)
    local state = ask("/api/resolve-job", '{"id":' .. json_text(id) .. "}")
    local status = json_field(state, "status")
    local message = json_field(state, "message") or ""
    if message ~= last then
      print("VaultHub: " .. message)
      last = message
    end
    if state == "" then
      tell("VaultHub closed before it was done.")
      return nil
    elseif status == "done" then
      return state
    elseif not keep_waiting[status] then
      tell("That didn't work: " .. message)
      return nil
    end
  end
end

local function frame_rate(timeline)
  local rate = tostring(timeline:GetSetting("timelineFrameRate") or "")
  local fps = tonumber(rate:match("[%d%.]+")) or 24
  if fps == 23 then fps = 23.976 elseif fps == 29 then fps = 29.97 elseif fps == 59 then fps = 59.94 end
  return fps
end

local function lines(text)
  local out = {}
  for line in (text or ""):gmatch("([^\n]*)\n") do
    out[#out + 1] = line
  end
  return out
end

local function split_tabs(line)
  local out = {}
  for field in (line .. "\t"):gmatch("([^\t]*)\t") do out[#out + 1] = field end
  return out
end

local resolve = Resolve()
local project = resolve:GetProjectManager():GetCurrentProject()
