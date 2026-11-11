-- VaultHub Subtitles: subtitles as Text+ titles, each at the frame it's spoken.
-- Click a video in the Media Pool first to get a new timeline with that video and its subtitles.
-- With nothing clicked, VaultHub listens to the timeline that's open. If you just clicked
-- "Put in Resolve" in VaultHub, those subtitles are used.

{{COMMON}}

local timeline = project and project:GetCurrentTimeline()
local pool = project and project:GetMediaPool()
if not pool then
  tell("Open a project first, then run VaultHub Subtitles again.")
  return
end
local fps = timeline and frame_rate(timeline) or 30
local first = timeline and timeline:GetStartFrame() or 0

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

-- Optional: a Text+ you styled yourself, copied for every subtitle (otherwise Resolve's own Text+ is used).
local template = find_template(pool:GetRootFolder())

-- The video clicked in the Media Pool, if any.
local function clicked_clip()
  local ok, list = pcall(function() return pool:GetSelectedClips() end)
  if not ok or type(list) ~= "table" then return nil end
  for _, clip in pairs(list) do
    local kind = tostring(clip:GetClipProperty("Type") or "")
    local path = tostring(clip:GetClipProperty("File Path") or "")
    if path ~= "" and (kind:find("Video") or kind:find("Audio")) then return clip end
  end
  return nil
end

if not connect() then return end

-- ---------------------------------------------------------------- which subtitles

local cue_id, place_at = nil, nil  -- place_at(seconds in the subtitles) -> timeline frame
local clip, clip_path, pending_offset = nil, nil, 0  -- a Media Pool clip (or VaultHub file) the subtitles are for

local pending = ask("/api/resolve-pending", "{}")
local pending_id = json_field(pending, "id")
if pending_id and pending_id ~= "" then
  -- Made in VaultHub's Resolve tab from a file: line them up with that file on the timeline.
  local path = json_field(pending, "path") or ""
  local name = (json_field(pending, "name") or ""):lower()
  local offset = tonumber(json_field(pending, "offset") or "0") or 0
  clip_path, pending_offset = path, offset
  local lower = path:lower():gsub("/", "\\")
  for _, kind in ipairs(timeline and { "video", "audio" } or {}) do
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
  cue_id = pending_id
elseif clicked_clip() then
  clip = clicked_clip()
  clip_path = tostring(clip:GetClipProperty("File Path"))
  local answer = ask("/api/resolve-subtitles", '{"clip":true,"name":' .. json_text(clip:GetName())
    .. ',"parts":[{"path":' .. json_text(clip_path) .. "}]}")
  cue_id = json_field(answer, "id")
  if not cue_id then
    tell(json_field(answer, "error") or "VaultHub didn't answer. Make sure it's open and try again.")
    return
  end
  print("VaultHub: listening to " .. clip:GetName() .. ". Check the words in VaultHub, then click \"Put in Resolve\".")
  if not wait_for(cue_id, { queued = true, active = true, checking = true }, "VaultHub Subtitles") then return end
elseif not timeline then
  tell("Click a video in the Media Pool (or open a timeline), then run VaultHub Subtitles again.")
  return
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

-- ---------------------------------------------------------------- the Resolve way: a timeline file

-- Resolve brings in a timeline file with the subtitles as Text+ titles: no setup needed.
local function import_timeline()
  local name = (clip and clip:GetName() or clip_path and clip_path:match("[^\\/]+$") or (timeline and timeline:GetName())
    or "Video"):gsub("%.%w+$", "") .. " (subtitles)"
  local answer = ask("/api/resolve-fcpxml", '{"id":' .. json_text(cue_id) .. ',"name":' .. json_text(name)
    .. ',"clip":' .. json_text(clip_path or "") .. ',"fps":' .. fps .. ',"offset":' .. (clip_path and pending_offset or 0) .. "}")
  local file = json_field(answer, "path")
  if not file then
    tell(json_field(answer, "error") or "VaultHub couldn't make the subtitles file.")
    return
  end
  local made = pool:ImportTimelineFromFile(file, { timelineName = name, importSourceClips = true })
  if not made then
    tell("Resolve didn't take the subtitles file. You can bring it in yourself: File › Import › Timeline, and pick\n" .. file)
    return
  end
  project:SetCurrentTimeline(made)
  -- Subtitle look: low in the picture, like normal subtitles. (Style any of them in the Inspector.)
  local count = 0
  for i = 1, made:GetTrackCount("video") do
    for _, item in ipairs(made:GetItemListInTrack("video", i) or {}) do
      pcall(function()
        local comp = item:GetFusionCompByIndex(1)
        local tool = comp and (comp:FindToolByID("TextPlus") or (comp:GetToolList(false, "TextPlus") or {})[1])
        if tool then
          tool:SetInput("Center", { 0.5, 0.12 })
          count = count + 1
        end
      end)
    end
  end
  if clip_path then
    tell("Done! The new timeline \"" .. name .. "\" has your video with the subtitles above it as Text+.")
  else
    tell("Done! The subtitles are on a new timeline, \"" .. name .. "\". To put them on your own timeline: "
      .. "select them there, copy (Ctrl+C), go back to your timeline and paste them at the start (Ctrl+V).")
  end
end

if not template or not timeline or (clip and not place_at) then
  import_timeline()
  return
end

if not place_at then
  if clip_path then
    print("VaultHub: that file isn't on this timeline, so the subtitles start where the timeline starts.")
  end
  place_at = function(t) return first + math.floor(t * fps + 0.5) end
end

-- ---------------------------------------------------------------- your own Text+: copied for each line

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
