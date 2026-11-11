-- VaultHub Subtitles: subtitles as Text+ on your timeline, each at the frame it's spoken.
-- If you just clicked "Put in Resolve" in VaultHub, those subtitles are used. Otherwise VaultHub
-- listens to the timeline, you check the words in VaultHub, then they come in here.

{{COMMON}}

local timeline = project and project:GetCurrentTimeline()
if not timeline then
  tell("Open a timeline first, then run VaultHub Subtitles again.")
  return
end
local fps = frame_rate(timeline)
local first = timeline:GetStartFrame()
local pool = project:GetMediaPool()

-- ---------------------------------------------------------------- the Text+ to copy

-- Any Text+ in the Media Pool. Style it how you like: every subtitle copies it.
local function find_template(folder)
  for _, clip in ipairs(folder:GetClipList() or {}) do
    local kind = tostring(clip:GetClipProperty("Type") or "")
    local name = tostring(clip:GetName() or "")
    if kind:find("Fusion Title") or kind:find("Title") and name:find("Text") or name:find("Text%+") then
      return clip
    end
  end
  for _, sub in ipairs(folder:GetSubFolderList() or {}) do
    local found = find_template(sub)
    if found then return found end
  end
  return nil
end

local template = find_template(pool:GetRootFolder())
if not template then
  tell("One-time setup: in the Edit page open Effects › Titles, and drag \"Text+\" into your Media Pool. "
    .. "Style it how you like (font, size, color, position): all subtitles will copy it.\n\nThen run VaultHub Subtitles again.")
  return
end

if not connect() then return end

-- ---------------------------------------------------------------- which subtitles

local cue_id, place_at = nil, nil  -- place_at(seconds in the subtitles) -> timeline frame

local pending = ask("/api/resolve-pending", "{}")
local pending_id = json_field(pending, "id")
if pending_id and pending_id ~= "" then
  -- Made in VaultHub's Resolve tab from a file: line them up with that file on the timeline.
  local path = json_field(pending, "path") or ""
  local name = (json_field(pending, "name") or ""):lower()
  local offset = tonumber(json_field(pending, "offset") or "0") or 0
  local lower = path:lower():gsub("/", "\\")
  for _, kind in ipairs({ "video", "audio" }) do
    for i = 1, timeline:GetTrackCount(kind) do
      for _, item in ipairs(timeline:GetItemListInTrack(kind, i) or {}) do
        local media = item:GetMediaPoolItem()
        local p = media and tostring(media:GetClipProperty("File Path") or ""):lower():gsub("/", "\\")
        -- The same file, or (for a file dropped on VaultHub, which works on a copy) the same file name.
        local base = p and p:match("[^\\]+$") or ""
        if not place_at and p and (p == lower or (name ~= "" and base == name)) then
          local from = (item:GetLeftOffset() or 0) / fps
          local start = item:GetStart()
          place_at = function(t) return start + math.floor((t + offset - from) * fps + 0.5) end
        end
      end
    end
  end
  if not place_at then
    print("VaultHub: that file isn't on this timeline, so the subtitles start where the timeline starts.")
    place_at = function(t) return first + math.floor(t * fps + 0.5) end
  end
  cue_id = pending_id
else
  -- Listen to the whole timeline: every clip with sound, where it is on the timeline.
  local parts = {}
  local function add_track(kind, index)
    for _, item in ipairs(timeline:GetItemListInTrack(kind, index) or {}) do
      local enabled = true
      if item.GetClipEnabled then enabled = item:GetClipEnabled() end
      local media = item:GetMediaPoolItem()
      local path = media and media:GetClipProperty("File Path")
      if enabled and path and path ~= "" then
        parts[#parts + 1] = "{" .. '"path":' .. json_text(path)
          .. ',"from":' .. string.format("%.4f", (item:GetLeftOffset() or 0) / fps)
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
  local answer = ask("/api/resolve-subtitles",
    '{"name":' .. json_text(timeline:GetName()) .. ',"parts":[' .. table.concat(parts, ",") .. "]}")
  cue_id = json_field(answer, "id")
  if not cue_id then
    tell(json_field(answer, "error") or "VaultHub didn't answer. Make sure it's open and try again.")
    return
  end
  print("VaultHub: listening to the timeline. Check the words in VaultHub, then click \"Put in Resolve\".")
  if not wait_for(cue_id, { queued = true, active = true, checking = true }, "VaultHub Subtitles") then return end
  place_at = function(t) return first + math.floor(t * fps + 0.5) end
end

-- ---------------------------------------------------------------- onto the timeline

local cues = {}
for _, line in ipairs(lines(ask("/api/resolve-cues", '{"id":' .. json_text(cue_id) .. "}"))) do
  local f = split_tabs(line)
  if #f >= 3 then
    cues[#cues + 1] = { start = tonumber(f[1]), stop = tonumber(f[2]), text = f[3]:gsub("\\n", "\n") }
  end
end
if #cues == 0 then
  tell("There were no subtitles to put in.")
  return
end

timeline:AddTrack("video")
local track = timeline:GetTrackCount("video")
if timeline.SetTrackName then pcall(function() timeline:SetTrackName("video", track, "Subtitles") end) end

local placed = 0
local batch, texts = {}, {}
local function flush()
  if #batch == 0 then return end
  local items = pool:AppendToTimeline(batch) or {}
  for i, item in ipairs(items) do
    local text = texts[i]
    pcall(function()
      local comp = item:GetFusionCompByIndex(1)
      local tool = comp and (comp:FindToolByID("TextPlus") or (comp:GetToolList(false, "TextPlus") or {})[1])
      if tool then
        tool:SetInput("StyledText", text)
        placed = placed + 1
      end
    end)
  end
  batch, texts = {}, {}
end

for _, cue in ipairs(cues) do
  local from = place_at(cue.start)
  local to = place_at(cue.stop)
  if to - from >= 2 then
    batch[#batch + 1] = { mediaPoolItem = template, startFrame = 0, endFrame = to - from - 1,
                          recordFrame = from, trackIndex = track }
    texts[#texts + 1] = cue.text
    if #batch >= 40 then flush() end
  end
end
flush()

if placed > 0 then
  tell("Done! " .. placed .. " subtitles are on the new \"Subtitles\" track. Change any of them in the Inspector.")
else
  tell("Resolve didn't take the subtitles. Make sure the Text+ in your Media Pool is a Text+ title, then try again.")
end
