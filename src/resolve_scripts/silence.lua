-- VaultHub Cut Silence: makes a new timeline from the clip you picked in the Media Pool, with the
-- quiet parts cut out. Every cut is a normal cut, so you can still change any of them.

{{COMMON}}

if not project then
  tell("Open a project first.")
  return
end
local pool = project:GetMediaPool()

local clip = nil
for _, c in pairs(pool:GetSelectedClips() or {}) do
  if not clip then clip = c end
end
if not clip then
  tell("Click a clip in the Media Pool first, then run VaultHub Cut Silence again.")
  return
end
local path = clip:GetClipProperty("File Path")
if not path or path == "" then
  tell("That clip isn't a video file on this PC.")
  return
end
local fps = tonumber(tostring(clip:GetClipProperty("FPS") or ""):match("[%d%.]+"))
local current = project:GetCurrentTimeline()
if not fps then fps = current and frame_rate(current) or 24 end

if not connect() then return end
local answer = ask("/api/resolve-silence", '{"path":' .. json_text(path) .. "}")
local id = json_field(answer, "id")
if not id then
  tell(json_field(answer, "error") or "VaultHub didn't answer. Make sure it's open and try again.")
  return
end
print("VaultHub: finding the quiet parts...")
if not wait_for(id, { queued = true, active = true }) then return end

local infos = {}
for _, line in ipairs(lines(ask("/api/resolve-keep", '{"id":' .. json_text(id) .. "}"))) do
  local f = split_tabs(line)
  local s, e = tonumber(f[1]), tonumber(f[2])
  if s and e then
    local from, to = math.floor(s * fps + 0.5), math.floor(e * fps + 0.5) - 1
    if to > from then
      infos[#infos + 1] = { mediaPoolItem = clip, startFrame = from, endFrame = to }
    end
  end
end
if #infos == 0 then
  tell("Couldn't find anything to keep in this clip.")
  return
end

local name = tostring(clip:GetName() or "Clip"):gsub("%.%w+$", "") .. " (no silence)"
local timeline = pool:CreateEmptyTimeline(name)
if not timeline then
  timeline = pool:CreateEmptyTimeline(name .. " " .. os.date("%H.%M.%S"))
end
if not timeline then
  tell("Resolve wouldn't make a new timeline.")
  return
end
project:SetCurrentTimeline(timeline)
for i = 1, #infos, 50 do
  local chunk = {}
  for j = i, math.min(#infos, i + 49) do chunk[#chunk + 1] = infos[j] end
  pool:AppendToTimeline(chunk)
end
tell("Done! The new timeline \"" .. name .. "\" has " .. #infos .. " parts, with the quiet in between cut out.")
