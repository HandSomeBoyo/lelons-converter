-- VaultHub Import Project: brings the project folder that's on in VaultHub into the Media Pool,
-- as bins with the same names (Footage, Audio - Music, VFX...). Run it again to add new files.

{{COMMON}}

if not project then
  tell("Open a project first.")
  return
end
if not connect() then return end

local listing = lines(ask("/api/resolve-project", "{}"))
if #listing == 0 or listing[1] == "" then
  tell("Turn on a project folder in VaultHub first (the Resolve tab, under Project folder).")
  return
end

local pool = project:GetMediaPool()
local root = pool:GetRootFolder()
local function bin(parent, name)
  for _, folder in ipairs(parent:GetSubFolderList() or {}) do
    if folder:GetName() == name then return folder end
  end
  return pool:AddSubFolder(parent, name)
end

local top = bin(root, listing[1])
local wanted, order = {}, {}
for i = 2, #listing do
  local f = split_tabs(listing[i])
  if f[1] and f[1] ~= "" then
    if not wanted[f[1]] then
      wanted[f[1]] = {}
      order[#order + 1] = f[1]
    end
    if f[2] and f[2] ~= "" then table.insert(wanted[f[1]], f[2]) end
  end
end

local added = 0
local here = pool:GetCurrentFolder()
for _, name in ipairs(order) do
  local folder = bin(top, name)
  local have = {}
  for _, clip in ipairs(folder:GetClipList() or {}) do
    have[tostring(clip:GetClipProperty("File Path") or ""):lower()] = true
  end
  local new = {}
  for _, path in ipairs(wanted[name]) do
    if not have[path:lower()] then new[#new + 1] = path end
  end
  if #new > 0 then
    pool:SetCurrentFolder(folder)
    added = added + #(pool:ImportMedia(new) or {})
  end
end
if here then pool:SetCurrentFolder(here) end
tell(added > 0 and ("Done! Added " .. added .. " files to the \"" .. listing[1] .. "\" bin.")
  or ("The \"" .. listing[1] .. "\" bin is up to date."))
