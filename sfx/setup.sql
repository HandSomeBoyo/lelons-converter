-- VaultHub (was Lelons Converter, then Ultimate Recording): the shared Library (accounts, roles and sounds).
--
-- Run this in your Supabase project: SQL Editor > New query > paste all of
-- this > put your username in the line marked 1. > Run.
-- Running it again later is fine. (It also updates the older friend-code
-- version: the sounds stay, the friend codes go.)

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists lelons;

-- 1. Your username. The account with this name is the owner (make it in the
--    app with "Create account" if you haven't yet). Upper/lower case doesn't matter.
create table if not exists lelons.config (id int primary key default 1 check (id = 1));
alter table lelons.config add column if not exists owner_username text;
alter table lelons.config add column if not exists channels text[];  -- the YouTube channels on the Home page (1.23.0; empty: the app's own list)
alter table lelons.config drop column if exists friend_hash;  -- (from the friend-code version)
alter table lelons.config drop column if exists owner_hash;
insert into lelons.config (id, owner_username) values (1, lower(btrim('CHANGE-ME-your-username')))
on conflict (id) do update set owner_username = case  -- left as CHANGE-ME: keep the owner you set before
  when excluded.owner_username = 'change-me-your-username' then lelons.config.owner_username
  else excluded.owner_username end;

-- 2. Everything below sets up accounts, sounds and where the files go.

-- The friend-code version's parts.
drop policy if exists "lelons upload" on storage.objects;
drop policy if exists "lelons see" on storage.objects;
drop policy if exists "lelons remove" on storage.objects;
drop function if exists public.lelons_check(text, text);
drop function if exists public.lelons_list(text, text);
drop function if exists public.lelons_add(text, text, text, text, text, real, int, text);
drop function if exists public.lelons_delete(text, text, text, uuid);
drop function if exists lelons.check_code(text);
drop function if exists lelons.folder();

create or replace function lelons.hash(code text) returns text
  language sql immutable set search_path = '' as
  $$ select encode(sha256(convert_to('lelons:' || lower(btrim(code)), 'UTF8')), 'hex') $$;

create table if not exists lelons.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  pass_hash text not null,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'viewer')),
  avatar text,
  created_at timestamptz not null default now(),
  failed int not null default 0,
  locked_until timestamptz
);
create unique index if not exists accounts_username on lelons.accounts (lower(username));
-- There's already an owner (who may have changed their username since): they stay the
-- owner, whatever name is in line 1, so there can never be two.
update lelons.config set owner_username = (select lower(a.username) from lelons.accounts a where a.role = 'owner' limit 1)
where exists (select 1 from lelons.accounts a where a.role = 'owner');

create table if not exists lelons.sessions (
  token_hash text primary key,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  last_used timestamptz not null default now()
);
-- (2.33.0) Your devices: which PC each login is on, so you can see them and log them out.
alter table lelons.sessions add column if not exists id uuid not null default gen_random_uuid();
alter table lelons.sessions add column if not exists created_at timestamptz not null default now();
alter table lelons.sessions add column if not exists device text;
alter table lelons.sessions add column if not exists app_version text;
-- (2.33.0) Each lockout after wrong passwords lasts longer (2 min, 10 min, 50 min... up to a day).
alter table lelons.accounts add column if not exists lockouts int not null default 0;

-- A ticket lets the app put one file in storage (or delete one), once.
create table if not exists lelons.tickets (
  path text primary key,
  kind text not null check (kind in ('upload', 'delete')),
  account_id uuid references lelons.accounts (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create table if not exists lelons.sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  category text not null check (category in ('sfx', 'music', 'memes', 'ambience', 'other')),
  path text not null unique,
  seconds real not null default 0,
  bytes int not null default 0,
  uploader text not null default '' check (length(uploader) <= 40),
  created_at timestamptz not null default now()
);
alter table lelons.sounds add column if not exists uploader_id uuid references lelons.accounts (id) on delete set null;
alter table lelons.sounds drop column if exists owner_hash;
-- (1.31.0) What the uploaded file was, so the same file can't go in twice.
alter table lelons.sounds add column if not exists source_hash text;
create index if not exists sounds_source_hash on lelons.sounds (source_hash);
-- (1.32.0) The song check: null = not checked yet, {"match": null} = no known song,
-- {"match": {title, artist, album, link, score}} = most likely a copyrighted song.
alter table lelons.sounds add column if not exists copyright jsonb;
-- (2.5.0) A genre inside the category, like Action in Music. Memes and Other are gone: they became SFX.
alter table lelons.sounds add column if not exists genre text check (genre is null or length(genre) between 1 and 40);
update lelons.sounds set genre = coalesce(genre, 'Memes'), category = 'sfx' where category = 'memes';
update lelons.sounds set category = 'sfx' where category = 'other';
-- (2.5.1) The waveform, worked out once and shared (so not every app downloads every sound to draw it),
-- and who's checking a sound for a known song right now (so not everyone checks the same one).
alter table lelons.sounds add column if not exists peaks jsonb;
alter table lelons.sounds add column if not exists checking_at timestamptz;
create index if not exists sounds_created on lelons.sounds (created_at);
create index if not exists sounds_uploader on lelons.sounds (uploader_id);
create index if not exists sounds_name on lelons.sounds (lower(btrim(name)));
create index if not exists sessions_account on lelons.sessions (account_id);

-- Bug reports and wishes people send to the owner.
create table if not exists lelons.feedback (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references lelons.accounts (id) on delete set null,
  username text not null,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null check (length(message) between 1 and 2000),
  app_version text not null default '',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- Everyone's starred sounds.
create table if not exists lelons.favorites (
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  sound_id uuid not null references lelons.sounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, sound_id)
);

-- Who has the app open right now (each app sends a "still here" every minute).
create table if not exists lelons.presence (
  client_id text primary key check (client_id ~ '^[0-9a-f]{32}$'),
  account_id uuid references lelons.accounts (id) on delete cascade,
  seen_at timestamptz not null default now()
);
create index if not exists presence_seen on lelons.presence (seen_at);

-- The live chat.
create table if not exists lelons.chat (
  id bigint generated always as identity primary key,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  message text not null check (length(message) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists chat_by_account on lelons.chat (account_id, created_at);
-- Private messages (to_id set; empty for the chat with everyone), and sounds or clips in a message.
alter table lelons.chat add column if not exists to_id uuid references lelons.accounts (id) on delete cascade;
alter table lelons.chat add column if not exists sound_id uuid references lelons.sounds (id) on delete set null;
alter table lelons.chat add column if not exists file text;
alter table lelons.chat add column if not exists file_name text check (length(file_name) <= 120);
alter table lelons.chat add column if not exists file_seconds real;
alter table lelons.chat drop constraint if exists chat_message_check;
alter table lelons.chat add constraint chat_message_check check (length(message) <= 500);
create index if not exists chat_private on lelons.chat (to_id, account_id, id) where to_id is not null;
-- (2.4.0) Group chats: a name, a picture and the people in it. Their messages have group_id set.
create table if not exists lelons.chat_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 50),
  picture text,
  owner_id uuid references lelons.accounts (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists lelons.chat_group_members (
  group_id uuid not null references lelons.chat_groups (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, account_id)
);
create index if not exists chat_group_members_by_account on lelons.chat_group_members (account_id);
alter table lelons.chat add column if not exists group_id uuid references lelons.chat_groups (id) on delete cascade;
create index if not exists chat_in_group on lelons.chat (group_id, id) where group_id is not null;

create table if not exists lelons.chat_reactions (
  message_id bigint not null references lelons.chat (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '😂', '🔥', '❤️', '😮', '😢')),
  primary key (message_id, account_id, emoji)
);
-- (2.31.0) React with any emoji, not just the 6.
alter table lelons.chat_reactions drop constraint if exists chat_reactions_emoji_check;
alter table lelons.chat_reactions drop constraint if exists chat_reactions_emoji_any;
alter table lelons.chat_reactions add constraint chat_reactions_emoji_any check (length(emoji) between 1 and 16 and emoji !~ '[A-Za-z0-9<>&"'']');

-- (2.31.0) Replies, threads, pins, edits, voice messages, GIFs and stickers, and polls.
alter table lelons.chat add column if not exists call_seconds int;  -- (from 2.11.0, below; needed this early on a new setup)
alter table lelons.chat add column if not exists reply_to bigint;  -- the message this one answers (it may be deleted since)
alter table lelons.chat add column if not exists thread_of bigint; -- a reply in the thread under that message
alter table lelons.chat add column if not exists pinned_at timestamptz;
alter table lelons.chat add column if not exists pinned_by uuid references lelons.accounts (id) on delete set null;
alter table lelons.chat add column if not exists edited_at timestamptz;
alter table lelons.chat add column if not exists voice boolean not null default false;  -- file is a voice message
alter table lelons.chat add column if not exists peaks jsonb;  -- a voice message's little waveform
alter table lelons.chat add column if not exists gif text check (gif is null or length(gif) <= 500);  -- a link, or '@file'
alter table lelons.chat add column if not exists sticker text check (sticker is null or sticker ~ '^[a-z0-9-]{1,30}$');
alter table lelons.chat add column if not exists poll jsonb;  -- {q, options: [...], multi, closed}
create index if not exists chat_thread on lelons.chat (thread_of, id) where thread_of is not null;
create index if not exists chat_pinned on lelons.chat (pinned_at) where pinned_at is not null;
create table if not exists lelons.chat_poll_votes (
  message_id bigint not null references lelons.chat (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  choice smallint not null check (choice between 0 and 9),
  primary key (message_id, account_id, choice)
);
alter table lelons.chat_poll_votes enable row level security;
-- (2.31.0) What you're up to, next to your name: Away, Busy, Recording...
alter table lelons.accounts add column if not exists mode text not null default ''
  check (mode in ('', 'away', 'busy', 'recording', 'editing', 'gaming', 'streaming'));

alter table lelons.accounts add column if not exists last_seen timestamptz;
-- (2.26.0) Your profile: a short bio, a status line, a banner picture, your color, your YouTube
-- channel and the parts of your profile you'd rather not show.
alter table lelons.accounts add column if not exists bio text not null default '' check (length(bio) <= 300);
alter table lelons.accounts add column if not exists status text not null default '' check (length(status) <= 60);
alter table lelons.accounts add column if not exists banner text;
alter table lelons.accounts add column if not exists accent text check (accent ~ '^#[0-9a-f]{6}$');
alter table lelons.accounts add column if not exists youtube text not null default ''
  check (youtube = '' or (youtube like 'https://www.youtube.com/%' and length(youtube) <= 200));
alter table lelons.accounts add column if not exists hide text[] not null default '{}';
-- (2.32.0) Your Twitch name, so friends get a ping when you go live.
alter table lelons.accounts add column if not exists twitch text not null default '' check (twitch ~ '^[a-z0-9_]{0,25}$');
-- (2.33.0) How your profile looks: a ready-made banner, a ring around your picture and up to
-- 3 pinned things (a video, a sound or a game). Like {"banner": "galaxy", "ring": "glow", "show": [...]}.
alter table lelons.accounts add column if not exists look jsonb not null default '{}'
  check (jsonb_typeof(look) = 'object' and length(look::text) <= 1500);

alter table lelons.config enable row level security;
alter table lelons.accounts enable row level security;
alter table lelons.sessions enable row level security;
alter table lelons.tickets enable row level security;
alter table lelons.sounds enable row level security;
alter table lelons.feedback enable row level security;
alter table lelons.favorites enable row level security;
alter table lelons.presence enable row level security;
alter table lelons.chat enable row level security;
alter table lelons.chat_reactions enable row level security;
alter table lelons.chat_groups enable row level security;
alter table lelons.chat_group_members enable row level security;
revoke all on all tables in schema lelons from anon, authenticated;

-- ---- helpers (not reachable from the app directly)

-- The account a login token belongs to, or an error if it's not (or no longer) valid.
create or replace function lelons.who(token text) returns lelons.accounts
  language plpgsql security definer set search_path = '' as $$
declare
  found lelons.accounts;
begin
  select a.* into found from lelons.sessions s join lelons.accounts a on a.id = s.account_id
  where s.token_hash = lelons.hash(coalesce(token, '')) and s.last_used > now() - interval '90 days';
  if found.id is null then
    raise exception 'not logged in' using hint = 'login';
  end if;
  update lelons.sessions set last_used = now()
  where token_hash = lelons.hash(token) and last_used < now() - interval '1 hour';
  if found.role <> 'owner' and lower(found.username) = (select owner_username from lelons.config) then
    update lelons.accounts set role = 'owner' where id = found.id returning * into found;
  end if;
  return found;
end $$;

create or replace function lelons.account_json(a lelons.accounts) returns json
  language sql stable set search_path = '' as
  $$ select json_build_object('id', a.id, 'username', a.username, 'role', a.role, 'avatar', a.avatar,
                             'created_at', a.created_at,
                             'sounds', (select count(*) from lelons.sounds s where s.uploader_id = a.id),
                             'open_feedback', case when a.role = 'owner'
                               then (select count(*) from lelons.feedback f where not f.done) end) $$;

drop function if exists lelons.new_session(uuid);
create or replace function lelons.new_session(account uuid, device text default null, app_version text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from lelons.sessions where last_used < now() - interval '90 days';
  insert into lelons.sessions (token_hash, account_id, device, app_version)
  values (lelons.hash(token), account, nullif(left(btrim(coalesce(device, '')), 60), ''), nullif(left(btrim(coalesce(app_version, '')), 20), ''));
  return token;
end $$;

-- (2.33.0) A new password: at least 8 characters, and not one of the passwords everyone tries first.
-- Returns the error, or null when it's fine. (Passwords made before keep working.)
create or replace function lelons.password_problem(password text, username text) returns text
  language sql immutable set search_path = '' as $$
  select case
    when length(coalesce(password, '')) < 8 then 'password'
    when lower(password) = lower(coalesce(username, '')) then 'password_name'
    when lower(password) in ('password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890',
      '87654321', '11111111', '00000000', '12341234', 'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'iloveyou',
      'abc12345', 'abcd1234', 'aaaaaaaa', 'letmein1', 'welcome1', 'football', 'baseball', 'sunshine', 'princess',
      'superman', 'trustno1', 'whatever', 'starwars', 'minecraft', 'fortnite', 'pokemon1', 'monkey12', 'dragon12',
      'vaulthub', 'vaulthub1', 'vaulthub123', 'youtube1', 'youtube123', 'passord1', 'passord123')
      or password ~ '^(.)\1+$' then 'password_common'
    end $$;

create or replace function lelons.ticket_ok(file text, wanted text) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from lelons.tickets where path = file and kind = wanted and expires_at > now()) $$;

-- True while a file is used (a sound, or someone's picture): then it can't be deleted.
create or replace function lelons.listed(file text) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from lelons.sounds where path = file)
         or exists (select 1 from lelons.accounts where avatar = file or banner = file)
         or exists (select 1 from lelons.chat c where c.file = listed.file)
         or exists (select 1 from lelons.chat_groups g where g.picture = listed.file) $$;

create or replace function lelons.delete_ticket(file text) returns void
  language sql security definer set search_path = '' as
  $$ insert into lelons.tickets (path, kind) values (file, 'delete')
     on conflict (path) do update set kind = 'delete', expires_at = now() + interval '15 minutes' $$;

grant usage on schema lelons to anon, authenticated;
-- (2.32.0) Everyone's YouTube and Twitch channels (not yours), so the app can tell you when a friend goes live.
create or replace function public.lelons_live_channels(token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar,
                                                     'youtube', a.youtube, 'twitch', a.twitch))
                   from lelons.accounts a
                   where a.id <> me.id and (a.youtube <> '' or a.twitch <> '')
                     and not ('videos' = any (coalesce(a.hide, '{}')))), '[]'::json);
end $$;

grant execute on function lelons.ticket_ok(text, text), lelons.listed(text), lelons.hash(text) to anon, authenticated;

-- ---- what the app calls

-- (2.33.0) Invite codes: a new account needs a code from the owner or an admin, so only friends can join.
-- A code works until it runs out (expires_at; null: never) or is used up (max_uses; null: no limit).
-- The owner's own account (the name in line 1) never needs one, so a brand new setup can start.
create table if not exists lelons.invites (
  code text primary key,
  made_by uuid not null references lelons.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0
);
alter table lelons.invites enable row level security;
revoke all on lelons.invites from anon, authenticated;
alter table lelons.accounts add column if not exists invite_code text;  -- the code they joined with
alter table lelons.accounts add column if not exists invited_by uuid references lelons.accounts (id) on delete set null;

-- Old apps signed up without a code: that way in is gone.
drop function if exists public.lelons_signup(text, text);
drop function if exists public.lelons_signup(text, text, text);

create or replace function public.lelons_signup(username text, password text, invite text,
                                                device text default null, app_version text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  name text := btrim(coalesce(username, ''));
  code_in text := upper(regexp_replace(coalesce(invite, ''), '[^A-Za-z0-9]', '', 'g'));
  is_owner boolean := lower(btrim(coalesce(username, ''))) = (select owner_username from lelons.config);
  inv lelons.invites;
  made lelons.accounts;
begin
  if name !~ '^[A-Za-z0-9_.-]{3,20}$' then
    return json_build_object('ok', false, 'error', 'username');
  end if;
  if lelons.password_problem(password, name) is not null then
    return json_build_object('ok', false, 'error', lelons.password_problem(password, name));
  end if;
  if not is_owner then
    -- The code, still good, made by someone who is still the owner or an admin. Locked while it's checked,
    -- so two people can't both take a code's last use.
    select i.* into inv from lelons.invites i join lelons.accounts a on a.id = i.made_by
    where i.code = code_in and a.role in ('owner', 'admin')
      and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses)
    for update of i;
    if inv.code is null then
      perform pg_sleep(0.5);  -- (slows down guessing)
      return json_build_object('ok', false, 'error', case when code_in = '' then 'no_invite' else 'bad_invite' end);
    end if;
  end if;
  if exists (select 1 from lelons.accounts a where lower(a.username) = lower(name)) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;
  if (select count(*) from lelons.accounts) >= 500 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into lelons.accounts (username, pass_hash, role, invite_code, invited_by)
  values (name, extensions.crypt(password, extensions.gen_salt('bf', 10)),
          case when is_owner then 'owner' else 'viewer' end, inv.code, inv.made_by)
  returning * into made;
  if inv.code is not null then
    update lelons.invites i set uses = i.uses + 1 where i.code = inv.code;
  end if;
  return json_build_object('ok', true, 'token', lelons.new_session(made.id, device, app_version), 'account', lelons.account_json(made));
end $$;

-- (2.33.0) Your devices: the PCs logged in to your account.
--   'list'           them (newest use first); 'this' is the one asking
--   'out'  id        log that one out (it has to log in again)
--   'out_others'     log out everywhere but here
create or replace function public.lelons_devices(token text, what text, id uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  here text := lelons.hash(token);
begin
  if what = 'out' then
    delete from lelons.sessions s where s.account_id = me.id and s.id = lelons_devices.id and s.token_hash <> here;
  elsif what = 'out_others' then
    delete from lelons.sessions s where s.account_id = me.id and s.token_hash <> here;
  elsif what <> 'list' then
    raise exception 'unknown' using hint = 'bad_input';
  end if;
  return json_build_object('ok', true, 'devices', coalesce((
    select json_agg(json_build_object('id', s.id, 'device', s.device, 'version', s.app_version,
                                      'since', extract(epoch from s.created_at), 'used', extract(epoch from s.last_used),
                                      'this', s.token_hash = here)
                    order by s.token_hash = here desc, s.last_used desc)
    from lelons.sessions s where s.account_id = me.id and s.last_used > now() - interval '90 days'), '[]'::json));
end $$;

-- (2.33.0) The owner and admins make and remove invite codes.
--   'list'                  the codes (the owner sees everyone's, an admin their own), with who joined with each
--   'make'  hours, uses     a new code; hours: how long it works (null: always), uses: how many people (null: any)
--   'delete' code           (your own, or any for the owner)
create or replace function public.lelons_invites(token text, what text, code text default null,
                                                 hours int default null, uses int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- (no 0/O or 1/I, easy to read out)
  bytes bytea;
  made text;
  n int;
begin
  if me.role not in ('owner', 'admin') then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if what = 'make' then
    if hours is not null and (hours < 1 or hours > 24 * 366) then
      raise exception 'bad hours' using hint = 'bad_input';
    end if;
    if uses is not null and (uses < 1 or uses > 500) then
      raise exception 'bad uses' using hint = 'bad_input';
    end if;
    if (select count(*) from lelons.invites i where i.made_by = me.id
        and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses)) >= 30 then
      return json_build_object('ok', false, 'error', 'many_invites');
    end if;
    loop
      bytes := extensions.gen_random_bytes(10);
      made := '';
      for n in 0..9 loop
        made := made || substr(letters, get_byte(bytes, n) % 32 + 1, 1);
      end loop;
      exit when not exists (select 1 from lelons.invites i where i.code = made);
    end loop;
    insert into lelons.invites (code, made_by, expires_at, max_uses)
    values (made, me.id, case when hours is null then null else now() + make_interval(hours => hours) end, uses);
  elsif what = 'delete' then
    delete from lelons.invites i where i.code = upper(btrim(coalesce(lelons_invites.code, '')))
      and (i.made_by = me.id or me.role = 'owner');
  elsif what <> 'list' then
    raise exception 'unknown' using hint = 'bad_input';
  end if;
  -- Codes that ran out more than a week ago go (who joined with them still shows on People).
  delete from lelons.invites i where (i.expires_at < now() - interval '7 days')
    or (i.max_uses is not null and i.uses >= i.max_uses and i.created_at < now() - interval '7 days');
  return json_build_object('ok', true, 'made', made, 'invites', coalesce((
    select json_agg(json_build_object(
      'code', i.code, 'by', a.username, 'mine', i.made_by = me.id, 'created', extract(epoch from i.created_at),
      'expires', extract(epoch from i.expires_at), 'max_uses', i.max_uses, 'uses', i.uses,
      'working', (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses),
      'joined', coalesce((select json_agg(j.username order by j.created_at) from lelons.accounts j where j.invite_code = i.code), '[]'::json))
      order by i.created_at desc)
    from lelons.invites i join lelons.accounts a on a.id = i.made_by
    where me.role = 'owner' or i.made_by = me.id), '[]'::json));
end $$;

drop function if exists public.lelons_login(text, text);
create or replace function public.lelons_login(username text, password text, device text default null, app_version text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  found lelons.accounts;
begin
  select * into found from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(lelons_login.username, '')));
  if found.id is null then
    perform pg_sleep(0.3);  -- (answers as slowly as a wrong password, so names can't be found by timing)
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  if found.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'minutes', ceil(extract(epoch from found.locked_until - now()) / 60));
  end if;
  if extensions.crypt(coalesce(password, ''), found.pass_hash) <> found.pass_hash then
    -- Five wrong passwords in a row: wait. 2 minutes the first time, then 5 times longer each time (up to a day),
    -- until the right password is typed.
    update lelons.accounts set failed = case when failed >= 4 then 0 else failed + 1 end,
      lockouts = case when failed >= 4 then lockouts + 1 else lockouts end,
      locked_until = case when failed >= 4 then now() + least(interval '1 day', interval '2 minutes' * power(5, least(lockouts, 6)))
                          else locked_until end
    where id = found.id returning * into found;
    if found.locked_until > now() then
      return json_build_object('ok', false, 'error', 'locked', 'minutes', ceil(extract(epoch from found.locked_until - now()) / 60));
    end if;
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  update lelons.accounts set failed = 0, lockouts = 0, locked_until = null,
    role = case when lower(accounts.username) = (select c.owner_username from lelons.config c) then 'owner' else accounts.role end
  where id = found.id returning * into found;
  return json_build_object('ok', true, 'token', lelons.new_session(found.id, device, app_version), 'account', lelons.account_json(found));
end $$;

create or replace function public.lelons_logout(token text)
returns void language sql security definer set search_path = '' as
$$ delete from lelons.sessions where token_hash = lelons.hash(coalesce(token, '')) $$;

create or replace function public.lelons_me(token text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  return lelons.account_json(lelons.who(token));
end $$;

create or replace function public.lelons_password(token text, old_password text, new_password text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if extensions.crypt(coalesce(old_password, ''), me.pass_hash) <> me.pass_hash then
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  if lelons.password_problem(new_password, me.username) is not null then
    return json_build_object('ok', false, 'error', lelons.password_problem(new_password, me.username));
  end if;
  update lelons.accounts set pass_hash = extensions.crypt(new_password, extensions.gen_salt('bf', 10)) where id = me.id;
  -- Logged out everywhere else.
  delete from lelons.sessions where account_id = me.id and token_hash <> lelons.hash(token);
  return json_build_object('ok', true);
end $$;

drop function if exists public.lelons_list(text);  -- (it gained columns: favorite, copyright, genre)
create or replace function public.lelons_list(token text)
returns table (id uuid, name text, category text, path text, seconds real, bytes int,
               uploader text, uploader_avatar text, created_at timestamptz, mine boolean, favorite boolean,
               copyright jsonb, genre text, peaks jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return query select s.id, s.name, s.category, s.path, s.seconds, s.bytes,
                      coalesce(a.username, s.uploader), a.avatar, s.created_at, s.uploader_id is not distinct from me.id,
                      exists (select 1 from lelons.favorites f where f.account_id = me.id and f.sound_id = s.id),
                      s.copyright, s.genre, s.peaks
               from lelons.sounds s left join lelons.accounts a on a.id = s.uploader_id
               order by s.created_at desc limit 5000;
end $$;

-- ---- feedback

create or replace function public.lelons_feedback_send(token text, kind text, message text, app_version text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  text_in text := btrim(coalesce(message, ''));
begin
  if length(text_in) < 3 then
    return json_build_object('ok', false, 'error', 'short');
  end if;
  if length(text_in) > 2000 then
    return json_build_object('ok', false, 'error', 'long');
  end if;
  if (select count(*) from lelons.feedback f where f.account_id = me.id and f.created_at > now() - interval '1 day') >= 20 then
    return json_build_object('ok', false, 'error', 'daily');
  end if;
  insert into lelons.feedback (account_id, username, kind, message, app_version)
  values (me.id, me.username, case when kind in ('bug', 'idea') then kind else 'other' end, text_in,
          left(coalesce(app_version, ''), 20));
  return json_build_object('ok', true);
end $$;

create or replace function public.lelons_feedback_list(token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if me.role <> 'owner' then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', f.id, 'username', coalesce(a.username, f.username), 'avatar', a.avatar, 'kind', f.kind,
      'message', f.message, 'app_version', f.app_version, 'done', f.done, 'created_at', f.created_at)
      order by f.done, f.created_at desc)
    from (select * from lelons.feedback order by created_at desc limit 500) f
    left join lelons.accounts a on a.id = f.account_id), '[]'::json);
end $$;

-- Mark one done (or not done), or delete it (remove = true). Owner only.
create or replace function public.lelons_feedback_set(token text, feedback_id uuid, is_done boolean, remove boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if me.role <> 'owner' then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if remove then
    delete from lelons.feedback f where f.id = feedback_id;
  else
    update lelons.feedback f set done = is_done where f.id = feedback_id;
  end if;
end $$;

-- ---- online and the live chat

-- "This app is open" (and who's logged in to it). Returns how many are online.
-- Works logged out too: then the app only counts, nobody's name shows.
create or replace function public.lelons_ping(client_id text, token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
begin
  if coalesce(client_id, '') !~ '^[0-9a-f]{32}$' then
    raise exception 'bad id';
  end if;
  select s.account_id into me from lelons.sessions s
  where s.token_hash = lelons.hash(coalesce(token, '')) and s.last_used > now() - interval '90 days';
  if me is not null then
    update lelons.accounts a set last_seen = now() where a.id = me;
  end if;
  insert into lelons.presence (client_id, account_id, seen_at) values (client_id, me, now())
  on conflict on constraint presence_pkey do update set account_id = excluded.account_id, seen_at = now();
  delete from lelons.presence p where p.seen_at < now() - interval '10 minutes';
  return lelons.online_json();
end $$;

-- The app closed: stop counting it.
create or replace function public.lelons_bye(client_id text)
returns void language sql security definer set search_path = '' as
  $$ delete from lelons.presence p where p.client_id = lelons_bye.client_id $$;

create or replace function lelons.online_json() returns json
  language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'online', (select count(*) from lelons.presence p where p.seen_at > now() - interval '150 seconds'),
    'people', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'role', a.role,
                                                          'mode', a.mode, 'status', a.status)
                                        order by lower(a.username))
                        from lelons.accounts a where a.id in (select p.account_id from lelons.presence p
                                                              where p.seen_at > now() - interval '150 seconds')), '[]'::json))
$$;

-- (1.20.0's versions, before private messages, sounds and reactions)
drop function if exists public.lelons_chat_send(text, text);
drop function if exists public.lelons_chat_list(text, bigint);
drop function if exists public.lelons_chat_delete(text, bigint);

-- Who a chat message can be seen by: everyone (to_id empty), or the two people in a private chat.
-- (2.4.0: or the people in its group)
create or replace function lelons.chat_sees(c lelons.chat, me uuid) returns boolean
  language sql stable set search_path = '' as
  $$ select case when c.group_id is not null
                 then exists (select 1 from lelons.chat_group_members m where m.group_id = c.group_id and m.account_id = me)
                 else c.to_id is null or c.to_id = me or c.account_id = me end $$;

-- (2.4.0) A group chat is asked for as "g:" and its id (where a username goes otherwise).
-- Its id, after checking you're in it; null when it isn't a group.
create or replace function lelons.group_of(with_user text, me uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  gid uuid;
begin
  if with_user is null or with_user not like 'g:%' then
    return null;
  end if;
  begin
    gid := substr(with_user, 3)::uuid;
  exception when others then
    raise exception 'no group' using hint = 'nogroup';
  end;
  if not exists (select 1 from lelons.chat_group_members m where m.group_id = gid and m.account_id = me) then
    raise exception 'no group' using hint = 'nogroup';
  end if;
  return gid;
end $$;

-- Send a chat message (everyone with an account can chat). to_user: a private message to them.
-- sound: a Library sound to share; file: a clip uploaded with a 'chat' ticket.
-- (2.31.0) reply_to: the message it answers; thread_of: a reply in that message's thread; voice: file is a
-- voice message (peaks: its waveform); gif: a GIF link (or '@file': the GIF is file); sticker; poll.
drop function if exists public.lelons_chat_send(text, text, text, uuid, text, text, real);
create or replace function public.lelons_chat_send(token text, message text, to_user text default null,
                                                   sound uuid default null, file text default null,
                                                   file_name text default null, file_seconds real default null,
                                                   reply_to bigint default null, thread_of bigint default null,
                                                   voice boolean default false, peaks jsonb default null,
                                                   gif text default null, sticker text default null, poll jsonb default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  text_in text := btrim(coalesce(message, ''));
  target uuid;
  gid uuid := lelons.group_of(to_user, me.id);
  old_files text[];
  rid bigint := reply_to;
  tid bigint := thread_of;
  gif_in text := nullif(btrim(coalesce(gif, '')), '');
  sticker_in text := nullif(btrim(coalesce(sticker, '')), '');
  poll_in jsonb;
  peaks_in jsonb;
  opts jsonb;
begin
  if poll is not null then
    select jsonb_agg(left(btrim(o), 80) order by n) into opts
    from jsonb_array_elements_text(case when jsonb_typeof(poll -> 'options') = 'array' then poll -> 'options' else '[]' end)
         with ordinality as x(o, n)
    where btrim(o) <> '' and n <= 10;
    if length(btrim(coalesce(poll ->> 'q', ''))) < 1 or coalesce(jsonb_array_length(opts), 0) < 2 then
      return json_build_object('ok', false, 'error', 'poll');
    end if;
    poll_in := jsonb_build_object('q', left(btrim(poll ->> 'q'), 200), 'options', opts,
                                  'multi', coalesce((poll ->> 'multi')::boolean, false), 'closed', false);
  end if;
  if length(text_in) < 1 and sound is null and file is null and gif_in is null and sticker_in is null and poll_in is null then
    return json_build_object('ok', false, 'error', 'short');
  end if;
  if length(text_in) > 500 then
    return json_build_object('ok', false, 'error', 'long');
  end if;
  if to_user is not null and gid is null then
    select a.id into target from lelons.accounts a where lower(a.username) = lower(btrim(to_user));
    if target is null then
      return json_build_object('ok', false, 'error', 'nobody');
    end if;
    if target = me.id then
      return json_build_object('ok', false, 'error', 'yourself');
    end if;
  end if;
  if sound is not null and not exists (select 1 from lelons.sounds s where s.id = sound) then
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  if file is not null and (file not like 'chat/%' or not exists
      (select 1 from lelons.tickets t where t.path = file and t.kind = 'upload' and t.account_id = me.id)) then
    raise exception 'wrong file';
  end if;
  if gif_in is not null and not ((gif_in = '@file' and file like 'chat/%.gif')
      or gif_in ~ '^https://(media[0-9]*\.giphy\.com|i\.giphy\.com|media[0-9]*\.tenor\.com|c\.tenor\.com|i\.imgur\.com)/[^\s"''<>\\]+$') then
    return json_build_object('ok', false, 'error', 'gif');
  end if;
  if sticker_in is not null and sticker_in !~ '^[a-z0-9-]{1,30}$' then
    sticker_in := null;
  end if;
  if voice and (file is null or gif_in is not null) then
    raise exception 'wrong file';
  end if;
  if voice and jsonb_typeof(peaks) = 'array' then
    select jsonb_agg(least(100, greatest(0, round(v::numeric)))::int order by n) into peaks_in
    from jsonb_array_elements_text(peaks) with ordinality as x(v, n) where v ~ '^[0-9.]+$' and n <= 64;
  end if;
  -- A reply or a thread reply: to a message in this same chat (a thread is under a message in the chat itself).
  if tid is not null and not exists (select 1 from lelons.chat c where c.id = tid and c.thread_of is null
                                     and lelons.in_chat(c, gid, target, me.id)) then
    return json_build_object('ok', false, 'error', 'thread');
  end if;
  if rid is not null and not exists (select 1 from lelons.chat c where c.id = rid and lelons.in_chat(c, gid, target, me.id)) then
    rid := null;  -- (deleted while you were writing: sent as a plain message)
  end if;
  if (select count(*) from lelons.chat c where c.account_id = me.id and c.created_at > now() - interval '10 seconds' and c.call_seconds is null) >= 5 then
    return json_build_object('ok', false, 'error', 'slow');
  end if;
  if (select count(*) from lelons.chat c where c.account_id = me.id and c.created_at > now() - interval '1 day' and c.call_seconds is null) >= 1000 then
    return json_build_object('ok', false, 'error', 'daily');
  end if;
  if file is not null and (select count(*) from lelons.chat c where c.account_id = me.id and c.file is not null
                           and c.created_at > now() - interval '1 day') >= 100 then
    return json_build_object('ok', false, 'error', 'daily');
  end if;
  insert into lelons.chat (account_id, message, to_id, group_id, sound_id, file, file_name, file_seconds,
                           reply_to, thread_of, voice, peaks, gif, sticker, poll)
  values (me.id, text_in, target, gid, sound, file,
          left(btrim(coalesce((select s.name from lelons.sounds s where s.id = sound), file_name, '')), 120), file_seconds,
          rid, tid, coalesce(voice, false), peaks_in, gif_in, sticker_in, poll_in);
  delete from lelons.tickets t where t.path = file;
  -- Only the newest 20000 messages are kept (the clips of older ones go too: the app deletes 'files').
  with gone as (delete from lelons.chat c
                where c.id < (select min(x.id) from (select id from lelons.chat order by id desc limit 20000) x)
                returning c.file)
  select coalesce(array_agg(x.file) filter (where x.file is not null), '{}') into old_files from gone x;
  perform lelons.delete_ticket(f) from unnest(old_files) f;
  return json_build_object('ok', true, 'files', old_files);
end $$;

-- (2.31.0) Is this message in this chat: the group gid, the private chat with peer, or (both null) everyone.
create or replace function lelons.in_chat(c lelons.chat, gid uuid, peer uuid, me uuid) returns boolean
  language sql immutable as
  $$ select case when gid is not null then c.group_id is not distinct from gid
                 when peer is null then c.to_id is null and c.group_id is null
                 else (c.account_id = me and c.to_id = peer) or (c.account_id = peer and c.to_id = me) end $$;

-- (2.31.0) The parts of a message that can change: the text (edits), reactions, pinned, its thread, poll votes.
create or replace function lelons.chat_bits(c lelons.chat, me uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'message', c.message, 'edited', c.edited_at is not null,
    'pinned', c.pinned_at is not null,
    'reactions', (select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine, 'who', x.who) order by x.n desc, x.emoji)
                  from (select cr.emoji, count(*) n, bool_or(cr.account_id = me) mine,
                               string_agg(ra.username, ', ' order by lower(ra.username)) who
                        from lelons.chat_reactions cr join lelons.accounts ra on ra.id = cr.account_id
                        where cr.message_id = c.id group by cr.emoji) x),
    'thread', case when c.thread_of is null then
      (select jsonb_build_object('count', count(*), 'last_at', max(t.created_at), 'faces',
                (select jsonb_agg(jsonb_build_object('username', a.username, 'avatar', a.avatar) order by z.newest desc)
                 from (select t2.account_id, max(t2.id) newest from lelons.chat t2 where t2.thread_of = c.id
                       group by t2.account_id order by max(t2.id) desc limit 3) z
                 join lelons.accounts a on a.id = z.account_id))
       from lelons.chat t where t.thread_of = c.id having count(*) > 0) end,
    'poll', c.poll,
    'votes', case when c.poll is not null then
      (select jsonb_agg(jsonb_build_object('choice', v.choice, 'count', v.n, 'mine', v.mine, 'who', v.who))
       from (select pv.choice, count(*) n, bool_or(pv.account_id = me) mine,
                    string_agg(a.username, ', ' order by lower(a.username)) who
             from lelons.chat_poll_votes pv join lelons.accounts a on a.id = pv.account_id
             where pv.message_id = c.id group by pv.choice) v) end,
    'voters', case when c.poll is not null then
      (select count(distinct pv.account_id) from lelons.chat_poll_votes pv where pv.message_id = c.id) end)
$$;

-- (2.31.0) A whole message, as the app shows it.
create or replace function lelons.chat_json(c lelons.chat, me uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select lelons.chat_bits(c, me) || jsonb_build_object(
    'created_at', c.created_at, 'username', a.username, 'avatar', a.avatar, 'role', a.role, 'mine', c.account_id = me,
    'sound', case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name,
             'category', s.category, 'path', s.path, 'seconds', s.seconds) end,
    'shared_gone', c.sound_id is null and c.file is null and c.file_name is not null and c.file_name <> '',
    'file', c.file, 'file_name', c.file_name, 'file_seconds', c.file_seconds, 'call_seconds', c.call_seconds,
    'voice', c.voice, 'peaks', c.peaks, 'gif', c.gif, 'sticker', c.sticker, 'thread_of', c.thread_of,
    'reply', case when c.reply_to is null then null else coalesce(
      (select jsonb_build_object('id', r.id, 'username', ra.username, 'avatar', ra.avatar, 'message', left(r.message, 140),
                                 'thread_of', r.thread_of,
                                 'kind', case when r.voice then 'voice' when r.poll is not null then 'poll'
                                              when r.gif is not null then 'gif' when r.sticker is not null then 'sticker'
                                              when r.sound_id is not null then 'sound' when r.file is not null then 'clip'
                                              when r.call_seconds is not null then 'call' end)
       from lelons.chat r join lelons.accounts ra on ra.id = r.account_id where r.id = c.reply_to),
      jsonb_build_object('id', c.reply_to, 'gone', true)) end)
  from lelons.accounts a left join lelons.sounds s on s.id = c.sound_id
  where a.id = c.account_id
$$;

-- (2.31.0) A message in a few words, for the list of chats and the bell: its text, or what it is.
create or replace function lelons.chat_preview(c lelons.chat) returns text
  language sql immutable as
  $$ select case when coalesce(c.message, '') <> '' then c.message
                 when c.poll is not null then 'Poll: ' || (c.poll ->> 'q')
                 when c.voice then 'Voice message'
                 when c.gif is not null then 'GIF'
                 when c.sticker is not null then 'Sticker'
                 else c.message end $$;

-- (2.4.0) Your group chats, newest message first, and one group with the people in it.
create or replace function lelons.groups_json(me uuid) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', g.id, 'name', g.name, 'picture', g.picture,
                                             'last_id', g.last_id, 'last_message', g.last_message, 'last_mine', g.last_mine,
                                             'people', g.people) order by coalesce(g.last_id, 0) desc, g.created_at desc), '[]'::json)
  from (select x.*, (select c.id from lelons.chat c where c.group_id = x.id and c.thread_of is null order by c.id desc limit 1) last_id,
               (select lelons.chat_preview(c) from lelons.chat c where c.group_id = x.id and c.thread_of is null order by c.id desc limit 1) last_message,
               (select c.account_id = me from lelons.chat c where c.group_id = x.id and c.thread_of is null order by c.id desc limit 1) last_mine,
               (select count(*) from lelons.chat_group_members m2 where m2.group_id = x.id) people
        from lelons.chat_groups x
        where exists (select 1 from lelons.chat_group_members m where m.group_id = x.id and m.account_id = me)) g
$$;

create or replace function lelons.group_json(gid uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('id', g.id, 'name', g.name, 'picture', g.picture, 'owner', o.username,
    'members', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'role', a.role,
                                                           'mode', a.mode, 'status', a.status)
                                         order by m.added_at, lower(a.username))
                         from lelons.chat_group_members m join lelons.accounts a on a.id = m.account_id
                         where m.group_id = g.id), '[]'::json))
  from lelons.chat_groups g left join lelons.accounts o on o.id = g.owner_id where g.id = gid
$$;

-- The chat a with_user means: (group id, the other person), after checking it's one you can see.
create or replace function lelons.chat_target(with_user text, me uuid, out gid uuid, out peer uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  gid := lelons.group_of(with_user, me);
  if with_user is not null and gid is null then
    select a.id into peer from lelons.accounts a where lower(a.username) = lower(btrim(with_user));
    if peer is null then
      raise exception 'nobody' using hint = 'nobody';
    end if;
  end if;
end $$;

-- One conversation (the chat with everyone, or the private chat with with_user): messages newer than
-- "after" (0: the newest 100) oldest first, the reactions and ids of the newest 150 (so changes and
-- deletes show up), your private chats, and who's online.
-- (2.31.0) before: the 100 messages older than that one instead (scrolling up). Thread replies aren't in it.
drop function if exists public.lelons_chat_list(text, bigint, text);
create or replace function public.lelons_chat_list(token text, after bigint, with_user text default null,
                                                   before bigint default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid;
  gid uuid;
begin
  select t.gid, t.peer into gid, peer from lelons.chat_target(with_user, me.id) t;
  return json_build_object(
    'online', lelons.online_json(),
    'messages', coalesce((
      select jsonb_agg(lelons.chat_json(c, me.id) order by c.id) from lelons.chat c
      where c.id in (select x.id from lelons.chat x
                     where lelons.in_chat(x, gid, peer, me.id) and x.thread_of is null
                       and (case when before is not null then x.id < before else x.id > coalesce(after, 0) end)
                     order by case when coalesce(after, 0) > 0 and before is null then x.id else -x.id end limit 100)), '[]'::jsonb),
    'recent', case when before is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(lelons.chat_bits(c, me.id)) from lelons.chat c
      where c.id in (select x.id from lelons.chat x where lelons.in_chat(x, gid, peer, me.id) and x.thread_of is null
                     order by x.id desc limit 150)), '[]'::jsonb) end,
    'older', before is not null,
    'pin_count', (select count(*) from lelons.chat x where x.pinned_at is not null and lelons.in_chat(x, gid, peer, me.id)),
    'private', coalesce((
      select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'role', a.role,
                                        'mode', a.mode, 'status', a.status,
                                        'last_id', p.id, 'last_message', p.preview, 'last_mine', p.account_id = me.id,
                                        'created_at', p.created_at) order by p.id desc)
      from (select distinct on (case when c.account_id = me.id then c.to_id else c.account_id end)
                   c.*, case when c.account_id = me.id then c.to_id else c.account_id end as other, lelons.chat_preview(c) as preview
            from lelons.chat c where c.to_id is not null and (c.account_id = me.id or c.to_id = me.id) and c.thread_of is null
            order by case when c.account_id = me.id then c.to_id else c.account_id end, c.id desc) p
      join lelons.accounts a on a.id = p.other), '[]'::json),
    'everyone_last', (select max(c.id) from lelons.chat c where c.to_id is null and c.group_id is null and c.thread_of is null),
    'groups', lelons.groups_json(me.id),
    'group', case when gid is null then null else lelons.group_json(gid) end,
    'names', case when coalesce(after, 0) = 0 and before is null then
               coalesce((select json_agg(a.username order by lower(a.username)) from lelons.accounts a), '[]'::json) end);
end $$;

-- (2.31.0) A message's thread: the message itself and the replies under it (the newest 300).
create or replace function public.lelons_chat_thread(token text, message_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  p lelons.chat;
begin
  select c.* into p from lelons.chat c where c.id = message_id;
  if p.id is null or p.thread_of is not null or not lelons.chat_sees(p, me.id) then
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  return json_build_object('ok', true, 'parent', lelons.chat_json(p, me.id),
    'messages', coalesce((select jsonb_agg(lelons.chat_json(c, me.id) order by c.id) from lelons.chat c
                          where c.id in (select x.id from lelons.chat x where x.thread_of = p.id order by x.id desc limit 300)), '[]'::jsonb));
end $$;

-- (2.31.0) Look for old messages in a chat (and in its threads): the newest 50 that have the words.
create or replace function public.lelons_chat_search(token text, with_user text, q text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid;
  gid uuid;
  pat text := '%' || replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  select t.gid, t.peer into gid, peer from lelons.chat_target(with_user, me.id) t;
  if length(btrim(coalesce(q, ''))) < 2 then
    return json_build_object('ok', true, 'messages', '[]'::json);
  end if;
  return json_build_object('ok', true, 'messages', coalesce((
    select jsonb_agg(lelons.chat_json(c, me.id) order by c.id desc) from lelons.chat c
    where c.id in (select x.id from lelons.chat x join lelons.accounts a on a.id = x.account_id
                   where lelons.in_chat(x, gid, peer, me.id)
                     and (x.message ilike pat or x.file_name ilike pat or (x.poll ->> 'q') ilike pat
                          or ('@' || a.username) ilike pat)
                   order by x.id desc limit 50)), '[]'::jsonb));
end $$;

-- (2.31.0) The pinned messages in a chat, newest pin first.
create or replace function public.lelons_chat_pins(token text, with_user text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid;
  gid uuid;
begin
  select t.gid, t.peer into gid, peer from lelons.chat_target(with_user, me.id) t;
  return json_build_object('ok', true, 'messages', coalesce((
    select jsonb_agg(lelons.chat_json(c, me.id) || jsonb_build_object('pinned_at', c.pinned_at,
                     'pinned_by', (select a.username from lelons.accounts a where a.id = c.pinned_by)) order by c.pinned_at desc)
    from lelons.chat c where c.pinned_at is not null and lelons.in_chat(c, gid, peer, me.id)), '[]'::jsonb));
end $$;

-- (2.31.0) Pin a message (on_off = false takes it off). In the chat with everyone only the owner and
-- admins can; in a group or a private chat everyone in it can. Up to 50 pins in a chat.
create or replace function public.lelons_chat_pin(token text, message_id bigint, on_off boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  m lelons.chat;
begin
  select c.* into m from lelons.chat c where c.id = message_id;
  if m.id is null or m.thread_of is not null or not lelons.chat_sees(m, me.id) then
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  if m.to_id is null and m.group_id is null and me.role not in ('owner', 'admin') then
    return json_build_object('ok', false, 'error', 'denied');
  end if;
  if on_off and m.pinned_at is null and (select count(*) from lelons.chat c where c.pinned_at is not null
      and c.group_id is not distinct from m.group_id
      and (case when m.to_id is null then c.to_id is null
                else (c.account_id, c.to_id) in ((m.account_id, m.to_id), (m.to_id, m.account_id)) end)) >= 50 then
    return json_build_object('ok', false, 'error', 'many');
  end if;
  update lelons.chat c set pinned_at = case when on_off then coalesce(c.pinned_at, now()) end,
                           pinned_by = case when on_off then coalesce(c.pinned_by, me.id) end
  where c.id = m.id;
  return json_build_object('ok', true);
end $$;

-- (2.31.0) Change the words of your own message.
create or replace function public.lelons_chat_edit(token text, message_id bigint, message text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  m lelons.chat;
  text_in text := btrim(coalesce(message, ''));
begin
  select c.* into m from lelons.chat c where c.id = message_id and c.account_id = me.id;
  if m.id is null or m.call_seconds is not null then
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  if length(text_in) > 500 then
    return json_build_object('ok', false, 'error', 'long');
  end if;
  if length(text_in) < 1 and m.sound_id is null and m.file is null and m.gif is null and m.sticker is null and m.poll is null then
    return json_build_object('ok', false, 'error', 'short');
  end if;
  if text_in is distinct from m.message then
    update lelons.chat c set message = text_in, edited_at = now() where c.id = m.id;
  end if;
  return json_build_object('ok', true);
end $$;

-- (2.31.0) Vote in a poll (choices: the options you pick, [] takes your vote back), or end it
-- (what = 'end', only the person who made it).
create or replace function public.lelons_chat_poll(token text, message_id bigint, what text, choices int[] default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  m lelons.chat;
  picked int[];
begin
  select c.* into m from lelons.chat c where c.id = message_id;
  if m.id is null or m.poll is null or not lelons.chat_sees(m, me.id) then
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  if what = 'end' then
    if m.account_id <> me.id then
      return json_build_object('ok', false, 'error', 'denied');
    end if;
    update lelons.chat c set poll = c.poll || '{"closed": true}' where c.id = m.id;
    return json_build_object('ok', true);
  end if;
  if coalesce((m.poll ->> 'closed')::boolean, false) then
    return json_build_object('ok', false, 'error', 'closed');
  end if;
  select coalesce(array_agg(distinct x), '{}') into picked from unnest(coalesce(choices, '{}')) x
  where x >= 0 and x < jsonb_array_length(m.poll -> 'options');
  if not coalesce((m.poll ->> 'multi')::boolean, false) and cardinality(picked) > 1 then
    picked := picked[1:1];
  end if;
  delete from lelons.chat_poll_votes v where v.message_id = m.id and v.account_id = me.id;
  insert into lelons.chat_poll_votes (message_id, account_id, choice) select m.id, me.id, x from unnest(picked) x;
  return json_build_object('ok', true);
end $$;

-- (2.31.0) What you're up to: '' (just online), away, busy, recording, editing, gaming or streaming,
-- and (when given) the short line under your name.
create or replace function public.lelons_set_mode(token text, mode text, status text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if coalesce(mode, '') not in ('', 'away', 'busy', 'recording', 'editing', 'gaming', 'streaming') then
    return json_build_object('ok', false, 'error', 'mode');
  end if;
  update lelons.accounts a set mode = coalesce(lelons_set_mode.mode, ''),
                               status = case when lelons_set_mode.status is null then a.status
                                             else left(btrim(lelons_set_mode.status), 60) end
  where a.id = me.id;
  return json_build_object('ok', true);
end $$;

-- React to a message (on = false takes it back). (2.31.0: any emoji, up to 20 different ones on a message.)
create or replace function public.lelons_chat_react(token text, message_id bigint, emoji text, on_off boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if not exists (select 1 from lelons.chat c where c.id = message_id and lelons.chat_sees(c, me.id)) then
    return;
  end if;
  if on_off then
    if (select count(distinct r.emoji) from lelons.chat_reactions r where r.message_id = lelons_chat_react.message_id
        and r.emoji <> lelons_chat_react.emoji) >= 20 then
      return;
    end if;
    insert into lelons.chat_reactions (message_id, account_id, emoji) values (message_id, me.id, emoji)
    on conflict do nothing;
  else
    delete from lelons.chat_reactions r where r.message_id = lelons_chat_react.message_id
      and r.account_id = me.id and r.emoji = lelons_chat_react.emoji;
  end if;
end $$;

-- Delete a message: your own, or anyone's in the chat with everyone if you're the owner or an admin.
-- Returns its clip's file (for the app to delete), or null. (The 2.31.0 apps and older use this one.)
create or replace function public.lelons_chat_delete(token text, message_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  gone text[] := (select (public.lelons_chat_remove(token, message_id) ->> 'files')::text[]);
begin
  return gone[1];
end $$;

-- (2.31.0) The same, and the replies in its thread go too. Returns all the files to delete.
create or replace function public.lelons_chat_remove(token text, message_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  files text[];
begin
  with gone as (delete from lelons.chat c where c.id = message_id
                  and (c.account_id = me.id or (c.to_id is null and c.group_id is null and me.role in ('owner', 'admin')))
                returning c.id, c.file),
       replies as (delete from lelons.chat c where c.thread_of in (select g.id from gone g) returning c.file)
  select coalesce(array_agg(f) filter (where f is not null), '{}') into files
  from (select g.file f from gone g union all select r.file from replies r) x;
  perform lelons.delete_ticket(f) from unnest(files) f;
  return jsonb_build_object('files', files);
end $$;

-- Someone's profile: picture, role, when they joined and were last online, and their newest sounds.
create or replace function public.lelons_profile(token text, username text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  them lelons.accounts;
  hid text[];
  online boolean;
begin
  select a.* into them from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(lelons_profile.username, '')));
  if them.id is null then
    raise exception 'nobody' using hint = 'nobody';
  end if;
  -- (2.26.0) The parts they hid are left out, for everyone (you too: you see what your friends see).
  hid := coalesce(them.hide, '{}');
  online := not ('online' = any (hid)) and exists (select 1 from lelons.presence p where p.account_id = them.id and p.seen_at > now() - interval '150 seconds');
  return json_build_object(
    'username', them.username, 'avatar', them.avatar, 'role', them.role, 'created_at', them.created_at,
    'last_seen', case when 'online' = any (hid) then null else them.last_seen end, 'me', them.id = me.id,
    'online', online,
    'in_call', online and exists (select 1 from lelons.room_people rp join lelons.rooms r on r.id = rp.room_id
                                  where rp.account_id = them.id and rp.state = 'in' and r.ended_at is null
                                    and rp.seen_at > now() - interval '30 seconds'),
    'bio', them.bio, 'status', them.status, 'banner', them.banner, 'accent', them.accent,
    'look', coalesce(them.look, '{}'::jsonb),
    -- (2.33.0) The pinned things, filled in (gone ones come back as null and are left out by the app).
    'showcase', coalesce((
      select json_agg(case x.item->>'kind'
          when 'sound' then (select json_build_object('kind', 'sound', 'id', d.id, 'name', d.name, 'category', d.category,
                                                      'path', d.path, 'seconds', d.seconds)
                             from lelons.sounds d where d.id::text = x.item->>'id')
          when 'game' then (select json_build_object('kind', 'game', 'id', g.id, 'name', g.info->>'name',
                                                     'header', g.info->>'header', 'status', g.status)
                            from lelons.games g where g.id::text = x.item->>'id')
          when 'video' then json_build_object('kind', 'video', 'id', x.item->>'id', 'title', x.item->>'title')
        end order by x.n)
      from jsonb_array_elements(case when jsonb_typeof(them.look->'show') = 'array' then them.look->'show' else '[]'::jsonb end)
           with ordinality x(item, n)), '[]'::json),
    'youtube', case when 'videos' = any (hid) and them.id <> me.id then '' else them.youtube end,
    'twitch', case when 'videos' = any (hid) and them.id <> me.id then '' else them.twitch end,
    'hide', case when them.id = me.id then to_json(hid) else null end,
    'show_stats', not ('stats' = any (hid)),
    'sounds', (select count(*) from lelons.sounds s where s.uploader_id = them.id),
    'messages', (select count(*) from lelons.chat c where c.account_id = them.id and c.to_id is null and c.group_id is null),
    'votes', (select count(*) from lelons.game_votes v where v.account_id = them.id),
    'recent', case when 'sounds' = any (hid) then '[]'::json else coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name, 'category', s.category,
                                        'path', s.path, 'seconds', s.seconds, 'created_at', s.created_at)
                      order by s.created_at desc)
      from (select * from lelons.sounds s where s.uploader_id = them.id order by s.created_at desc limit 6) s), '[]'::json) end,
    'povs', case when 'povs' = any (hid) then '[]'::json else coalesce((
      select json_agg(json_build_object('id', f.id, 'session', x.id, 'title', x.title, 'game', x.game, 'name', f.name,
                                        'seconds', f.seconds, 'thumb', f.thumb, 'created', extract(epoch from f.created_at))
                      order by f.created_at desc)
      from (select * from lelons.pov_files y where y.owner_id = them.id and (y.expires_at is null or y.expires_at > now())
            order by y.created_at desc limit 4) f
      join lelons.pov_sessions x on x.id = f.session_id), '[]'::json) end,
    'games', case when 'games' = any (hid) then '[]'::json else coalesce((
      select json_agg(json_build_object('id', g.id, 'name', g.info->>'name', 'header', g.info->>'header', 'status', g.status,
                                        'posted', g.poster_id = them.id, 'voted', g.voted)
                      order by g.at desc)
      from (select y.*, exists (select 1 from lelons.game_votes v where v.game_id = y.id and v.account_id = them.id) voted,
                   greatest(case when y.poster_id = them.id then y.created_at end,
                            (select v.created_at from lelons.game_votes v where v.game_id = y.id and v.account_id = them.id)) at
            from lelons.games y
            where y.poster_id = them.id or exists (select 1 from lelons.game_votes v where v.game_id = y.id and v.account_id = them.id)
            order by at desc limit 6) g), '[]'::json) end);
end $$;

-- (2.26.0) Change your profile: bio, status, color, YouTube channel and what's hidden.
-- Only the keys that are there change.
create or replace function public.lelons_set_profile(token text, info jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  hid text[];
begin
  if jsonb_typeof(info) is distinct from 'object' or length(info::text) > 4000 then
    raise exception 'bad profile' using hint = 'bad_input';
  end if;
  if info ? 'hide' then
    if jsonb_typeof(info->'hide') <> 'array' then
      raise exception 'bad hide' using hint = 'bad_input';
    end if;
    select coalesce(array_agg(distinct h), '{}') into hid from jsonb_array_elements_text(info->'hide') h
    where h in ('online', 'videos', 'sounds', 'povs', 'games', 'stats');
  end if;
  if info ? 'accent' and info->>'accent' is not null and info->>'accent' !~ '^#[0-9a-f]{6}$' then
    raise exception 'bad color' using hint = 'bad_input';
  end if;
  if info ? 'youtube' and coalesce(info->>'youtube', '') <> '' and info->>'youtube' not like 'https://www.youtube.com/%' then
    raise exception 'bad channel' using hint = 'bad_input';
  end if;
  if info ? 'twitch' and coalesce(info->>'twitch', '') !~ '^[a-z0-9_]{0,25}$' then
    raise exception 'bad twitch' using hint = 'bad_input';
  end if;
  -- (2.33.0) How it looks: checked piece by piece.
  if info ? 'look' then
    if jsonb_typeof(info->'look') <> 'object' or length((info->'look')::text) > 1500
       or coalesce(info->'look'->>'banner', '') not in ('', 'galaxy', 'sunset', 'ocean', 'plain', 'grass')
       or coalesce(info->'look'->>'ring', '') not in ('', 'color', 'glow', 'rainbow')
       or (info->'look' ? 'show' and (jsonb_typeof(info->'look'->'show') <> 'array' or jsonb_array_length(info->'look'->'show') > 3))
       or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(info->'look'->'show') = 'array'
                                                        then info->'look'->'show' else '[]'::jsonb end) i
                  where jsonb_typeof(i) <> 'object' or coalesce(i->>'kind', '') not in ('video', 'sound', 'game')
                     or coalesce(i->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' or length(coalesce(i->>'title', '')) > 100) then
      raise exception 'bad look' using hint = 'bad_input';
    end if;
  end if;
  update lelons.accounts a set
    twitch = case when info ? 'twitch' then coalesce(info->>'twitch', '') else a.twitch end,
    bio = case when info ? 'bio' then left(btrim(coalesce(info->>'bio', '')), 300) else a.bio end,
    status = case when info ? 'status' then left(btrim(coalesce(info->>'status', '')), 60) else a.status end,
    accent = case when info ? 'accent' then info->>'accent' else a.accent end,
    youtube = case when info ? 'youtube' then left(coalesce(info->>'youtube', ''), 200) else a.youtube end,
    hide = case when info ? 'hide' then hid else a.hide end,
    look = case when info ? 'look' then info->'look' else a.look end
  where a.id = me.id;
end $$;

-- (2.26.0) A new banner picture (a file uploaded with a 'banner' ticket), or null to take it off.
-- Returns the old one, which the app then deletes.
create or replace function public.lelons_set_banner(token text, file text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if file is not null and (file not like 'banners/%' or not exists
      (select 1 from lelons.tickets t where t.path = file and t.kind = 'upload' and t.account_id = me.id)) then
    raise exception 'wrong file';
  end if;
  update lelons.accounts set banner = file where id = me.id;
  delete from lelons.tickets where path = file;
  if me.banner is not null then
    perform lelons.delete_ticket(me.banner);
  end if;
  return me.banner;
end $$;

-- Star or unstar a sound, just for you.
-- The song check's answer for a sound. Any app that checked it may fill it in once; the owner
-- and admins may also check again.
create or replace function public.lelons_set_copyright(token text, sound_id uuid, result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if jsonb_typeof(result) is distinct from 'object' or length(result::text) > 2000
     or not (result ? 'match') or exists (select 1 from jsonb_object_keys(result) k where k not in ('match', 'short', 'unreadable'))
     or jsonb_typeof(result -> 'match') not in ('null', 'object') then
    raise exception 'bad result' using hint = 'bad_input';
  end if;
  update lelons.sounds s set copyright = result
  where s.id = lelons_set_copyright.sound_id and (s.copyright is null or me.role in ('owner', 'admin'));
end $$;

-- (2.5.1) "I'll check this sound for a known song": true when nobody else is checking it (or has checked it).
create or replace function public.lelons_claim_check(token text, sound_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  n int;
begin
  update lelons.sounds s set checking_at = now()
  where s.id = lelons_claim_check.sound_id and s.copyright is null
    and (s.checking_at is null or s.checking_at < now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- A waveform: 20 to 400 numbers from 0 to 1.
create or replace function lelons.peaks_ok(peaks jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(peaks) = 'array' and jsonb_array_length(peaks) between 20 and 400
         and not exists (select 1 from jsonb_array_elements(peaks) e
                         where case when jsonb_typeof(e) <> 'number' then true
                                    else e::text::numeric < 0 or e::text::numeric > 1 end), false)
$$;

-- (2.5.1) Share a sound's waveform with everyone (only when it has none yet).
create or replace function public.lelons_set_peaks(token text, file text, peaks jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if lelons.peaks_ok(peaks) then
    update lelons.sounds s set peaks = lelons_set_peaks.peaks where s.path = file and s.peaks is null;
  end if;
end $$;

create or replace function public.lelons_favorite(token text, sound_id uuid, starred boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if starred then
    insert into lelons.favorites (account_id, sound_id)
    select me.id, s.id from lelons.sounds s where s.id = lelons_favorite.sound_id
    on conflict do nothing;
  else
    delete from lelons.favorites f where f.account_id = me.id and f.sound_id = lelons_favorite.sound_id;
  end if;
end $$;

-- A place to upload one file: kind 'sound' (admins and the owner) or 'avatar' (everyone).
create or replace function public.lelons_ticket(token text, kind text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  file text;
begin
  if kind = 'sound' and me.role not in ('owner', 'admin') then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if kind not in ('sound', 'avatar', 'chat', 'banner', 'gif') then
    raise exception 'bad kind';
  end if;
  delete from lelons.tickets where expires_at < now();
  if (select count(*) from lelons.tickets t where t.account_id = me.id) >= 20 then
    raise exception 'too many uploads at once' using hint = 'daily';
  end if;
  file := case when kind = 'sound' then 'sounds/' || gen_random_uuid() || '.mp3'
               when kind = 'chat' then 'chat/' || gen_random_uuid() || '.mp3'
               when kind = 'gif' then 'chat/' || gen_random_uuid() || '.gif'  -- (2.31.0) a GIF in the chat
               when kind = 'banner' then 'banners/' || gen_random_uuid() || '.jpg'
               else 'avatars/' || gen_random_uuid() || '.jpg' end;
  insert into lelons.tickets (path, kind, account_id) values (file, 'upload', me.id);
  return file;
end $$;

-- (1.31.0) Is there already a sound with this name (any capitals) or made from this same file?
create or replace function lelons.same_sound(sound_name text, sound_hash text, except_id uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when btrim(coalesce(sound_name, '')) <> '' and exists (select 1 from lelons.sounds s
                 where lower(btrim(s.name)) = lower(btrim(sound_name))
                 and s.id is distinct from except_id) then 'same_name'
    when sound_hash is not null and exists (select 1 from lelons.sounds s where s.source_hash = sound_hash
                 and s.id is distinct from except_id) then 'same_file'
  end
$$;

-- The app asks before it starts converting: null if it's fine, else which one it matches.
create or replace function public.lelons_sound_check(token text, sound_name text, sound_hash text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  why text := lelons.same_sound(sound_name, sound_hash);
  other lelons.sounds;
begin
  if why is null then
    return null;
  end if;
  select * into other from lelons.sounds s
  where (why = 'same_name' and lower(btrim(s.name)) = lower(btrim(sound_name))) or (why = 'same_file' and s.source_hash = sound_hash)
  order by s.created_at limit 1;
  return json_build_object('why', why, 'name', other.name, 'uploader', other.uploader);
end $$;

drop function if exists public.lelons_add(text, text, text, text, real, int);  -- (it gained sound_hash)
drop function if exists public.lelons_add(text, text, text, text, real, int, text);  -- (and sound_genre)
drop function if exists public.lelons_add(text, text, text, text, real, int, text, text);  -- (and sound_peaks)
create or replace function public.lelons_add(token text, sound_name text, sound_category text,
                                             file text, sound_seconds real, sound_bytes int, sound_hash text default null,
                                             sound_genre text default null, sound_peaks jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  new_id uuid;
  clash text;
  -- (older apps still send Memes and Other)
  cat text := case when sound_category in ('memes', 'other') then 'sfx' else sound_category end;
  g text := nullif(left(btrim(coalesce(sound_genre, case when sound_category = 'memes' then 'Memes' end, '')), 40), '');
begin
  if me.role not in ('owner', 'admin') then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if not exists (select 1 from lelons.tickets t where t.path = file and t.kind = 'upload' and t.account_id = me.id)
     or file not like 'sounds/%' then
    raise exception 'wrong file';
  end if;
  if (select count(*) from lelons.sounds s where s.uploader_id = me.id and s.created_at > now() - interval '1 day') >= 100 then
    raise exception 'too many uploads today' using hint = 'daily';
  end if;
  if (select coalesce(sum(s.bytes), 0) from lelons.sounds s) + sound_bytes > 950 * 1024 * 1024 then
    raise exception 'storage full' using hint = 'full';
  end if;
  if btrim(coalesce(sound_name, '')) = '' then
    raise exception 'no name' using hint = 'bad_input';
  end if;
  clash := lelons.same_sound(sound_name, sound_hash);
  if clash is not null then
    raise exception 'already in the library' using hint = clash;
  end if;
  insert into lelons.sounds (name, category, genre, path, seconds, bytes, uploader, uploader_id, source_hash, peaks)
  values (btrim(sound_name), cat, g, file, sound_seconds, sound_bytes, me.username, me.id, sound_hash,
          case when lelons.peaks_ok(sound_peaks) then sound_peaks end)
  returning sounds.id into new_id;
  delete from lelons.tickets where path = file;
  return new_id;
end $$;

-- Change a sound's name, category or genre (1.24.0, genre 2.5.0): the one who uploaded it, or an owner or admin.
-- No genre given keeps the old one (if the category stays); '' clears it.
drop function if exists public.lelons_edit_sound(text, uuid, text, text);
create or replace function public.lelons_edit_sound(token text, sound_id uuid, sound_name text, sound_category text,
                                                    sound_genre text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  found lelons.sounds;
  cat text := case when sound_category in ('memes', 'other') then 'sfx' else sound_category end;
begin
  select * into found from lelons.sounds s where s.id = sound_id;
  if found.id is null then
    raise exception 'already gone' using hint = 'gone';
  end if;
  if me.role not in ('owner', 'admin') and found.uploader_id is distinct from me.id then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if lelons.same_sound(sound_name, null, sound_id) is not null then
    raise exception 'name taken' using hint = 'same_name';
  end if;
  update lelons.sounds s set name = btrim(sound_name), category = cat,
    genre = case when sound_genre is not null then nullif(left(btrim(sound_genre), 40), '')
                 when cat = found.category then found.genre end
  where s.id = sound_id;
end $$;

-- Use an uploaded picture as yours. Returns the old picture's file (for the app to delete), or null.
create or replace function public.lelons_set_avatar(token text, file text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if file is not null and (file not like 'avatars/%' or not exists
      (select 1 from lelons.tickets t where t.path = file and t.kind = 'upload' and t.account_id = me.id)) then
    raise exception 'wrong file';
  end if;
  update lelons.accounts set avatar = file where id = me.id;
  delete from lelons.tickets where path = file;
  if me.avatar is not null then
    perform lelons.delete_ticket(me.avatar);
  end if;
  return me.avatar;
end $$;

-- Takes a sound off the list and returns its file, which the app then deletes.
create or replace function public.lelons_delete(token text, sound_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  file text;
begin
  if me.role not in ('owner', 'admin') then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  delete from lelons.sounds s where s.id = sound_id returning s.path into file;
  if file is null then
    raise exception 'already gone' using hint = 'gone';
  end if;
  perform lelons.delete_ticket(file);
  return file;
end $$;

-- ---- the owner's People menu

create or replace function public.lelons_accounts(token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if me.role <> 'owner' then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', a.id, 'username', a.username, 'role', a.role, 'avatar', a.avatar, 'created_at', a.created_at,
      'sounds', (select count(*) from lelons.sounds s where s.uploader_id = a.id),
      'last_seen', (select max(x.last_used) from lelons.sessions x where x.account_id = a.id),
      'me', a.id = me.id) order by (a.role = 'owner') desc, a.created_at)
    from lelons.accounts a), '[]'::json);
end $$;

create or replace function public.lelons_set_role(token text, account_id uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if me.role <> 'owner' then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if new_role not in ('admin', 'viewer') then
    raise exception 'bad role';
  end if;
  update lelons.accounts a set role = new_role where a.id = account_id and a.role <> 'owner';
end $$;

create or replace function public.lelons_rename(token text, new_username text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  name text := btrim(coalesce(new_username, ''));
begin
  if name !~ '^[A-Za-z0-9_.-]{3,20}$' then
    return json_build_object('ok', false, 'error', 'username');
  end if;
  if exists (select 1 from lelons.accounts a where lower(a.username) = lower(name) and a.id <> me.id) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;
  update lelons.accounts a set username = name where a.id = me.id returning * into me;
  if me.role = 'owner' then  -- the owner's new name stays the owner's (and nobody can take the old one to become owner)
    update lelons.config set owner_username = lower(name);
  end if;
  return json_build_object('ok', true, 'account', lelons.account_json(me));
end $$;

-- Deletes your own account (your sounds stay). The owner can't.
create or replace function public.lelons_delete_me(token text, password text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  files text[];
begin
  if me.role = 'owner' then
    return json_build_object('ok', false, 'error', 'owner');
  end if;
  if extensions.crypt(coalesce(password, ''), me.pass_hash) <> me.pass_hash then
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  files := lelons.account_leaving(me.id);
  delete from lelons.accounts a where a.id = me.id;
  if me.avatar is not null then
    perform lelons.delete_ticket(me.avatar);
  end if;
  return json_build_object('ok', true, 'avatar', me.avatar, 'files', files);
end $$;

-- Removes an account (its sounds stay). Returns its picture's file, if any, for the app to delete.
create or replace function public.lelons_remove_account(token text, account_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  picture text;
begin
  if me.role <> 'owner' then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if exists (select 1 from lelons.accounts a where a.id = account_id and a.role <> 'owner') then
    perform lelons.account_leaving(account_id);
  end if;
  delete from lelons.accounts a where a.id = account_id and a.role <> 'owner' returning a.avatar into picture;
  if picture is not null then
    perform lelons.delete_ticket(picture);
  end if;
  return picture;
end $$;

-- ---- the Home page (1.23.0)

-- The channels, plus (when logged in) the newest sounds and the newest chat messages to everyone.
create or replace function public.lelons_home(token text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts;
begin
  if coalesce(token, '') <> '' then
    begin
      me := lelons.who(token);
    exception when others then
      me := null;
    end;
  end if;
  return json_build_object(
    'channels', (select to_json(c.channels) from lelons.config c),
    'logged_in', me.id is not null,
    'is_owner', coalesce(me.role = 'owner', false),
    'sounds', case when me.id is null then '[]'::json else coalesce((
      select json_agg(json_build_object('id', x.id, 'name', x.name, 'category', x.category, 'path', x.path,
                                        'seconds', x.seconds, 'created_at', x.created_at,
                                        'uploader', x.by_name, 'uploader_avatar', x.avatar) order by x.created_at desc)
      from (select s.id, s.name, s.category, s.path, s.seconds, s.created_at,
                   coalesce(a.username, s.uploader) as by_name, a.avatar from lelons.sounds s
            left join lelons.accounts a on a.id = s.uploader_id order by s.created_at desc limit 4) x), '[]'::json) end,
    'chat', case when me.id is null then '[]'::json else coalesce((
      select json_agg(json_build_object('id', m.id, 'message', m.preview, 'created_at', m.created_at,
                                        'username', a.username, 'avatar', a.avatar,
                                        'sound_name', s.name, 'file_name', m.file_name) order by m.id)
      from (select c.*, lelons.chat_preview(c) as preview from lelons.chat c where c.to_id is null and c.group_id is null and c.thread_of is null order by c.id desc limit 3) m
      join lelons.accounts a on a.id = m.account_id
      left join lelons.sounds s on s.id = m.sound_id), '[]'::json) end,
    'activity', case when me.id is null then '[]'::json else lelons.activity() end);
end $$;

-- The owner picks the channels shown on everyone's Home page (an empty list goes back to the app's own list).
create or replace function public.lelons_set_channels(token text, urls text[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  link text;
begin
  if me.role <> 'owner' then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  if coalesce(array_length(urls, 1), 0) > 12 then
    return json_build_object('ok', false, 'error', 'many');
  end if;
  foreach link in array coalesce(urls, '{}') loop
    if link !~ '^https://www\.youtube\.com/(@[^/?#\s]{1,100}|channel/UC[A-Za-z0-9_-]{22}|c/[^/?#\s]{1,100}|user/[^/?#\s]{1,100})$' then
      return json_build_object('ok', false, 'error', 'channel');
    end if;
  end loop;
  update lelons.config set channels = case when coalesce(array_length(urls, 1), 0) = 0 then null else urls end;
  return json_build_object('ok', true);
end $$;

-- ---- channel stats (1.26.0): each channel's subscribers once a day, sent in by the crew's apps

create table if not exists lelons.channel_stats (
  channel text not null check (length(channel) <= 200),
  day date not null,
  subs bigint not null check (subs between 0 and 10000000000),
  videos int check (videos between 0 and 10000000),
  updated_at timestamptz not null default now(),
  primary key (channel, day)
);
alter table lelons.channel_stats enable row level security;

create or replace function public.lelons_channel_log(token text, channel text, subs bigint, videos int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  link text := btrim(coalesce(channel, ''));
begin
  if link !~ '^https://www\.youtube\.com/(@[^/?#\s]{1,100}|channel/UC[A-Za-z0-9_-]{22}|c/[^/?#\s]{1,100}|user/[^/?#\s]{1,100})$' then
    raise exception 'not a channel';
  end if;
  insert into lelons.channel_stats as c (channel, day, subs, videos)
  values (link, (now() at time zone 'utc')::date, greatest(0, subs), videos)
  on conflict (channel, day) do update set subs = excluded.subs, videos = coalesce(excluded.videos, c.videos), updated_at = now();
end $$;

create or replace function public.lelons_channel_history(token text, days int default 90)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return coalesce((select json_agg(json_build_object('channel', c.channel, 'day', c.day, 'subs', c.subs, 'videos', c.videos)
                                   order by c.channel, c.day)
                   from lelons.channel_stats c
                   where c.day > (now() at time zone 'utc')::date - least(greatest(coalesce(days, 90), 1), 3650)), '[]'::json);
end $$;

-- ---- 1.27.0: "typing..." and "seen" in the chat, and the activity feed on Home

-- Who's typing, and where (to_key: the person they write to, or the zero id for the chat with everyone).
create table if not exists lelons.chat_typing (
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  to_key uuid not null,
  at timestamptz not null default now(),
  primary key (account_id, to_key)
);
alter table lelons.chat_typing enable row level security;
-- How far each person has read (peer_key: the other person in a private chat, or the zero id).
create table if not exists lelons.chat_seen (
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  peer_key uuid not null,
  last_id bigint not null,
  seen_at timestamptz not null default now(),
  primary key (account_id, peer_key)
);
alter table lelons.chat_seen enable row level security;
create index if not exists chat_seen_peer on lelons.chat_seen (peer_key, seen_at);
create index if not exists chat_typing_to on lelons.chat_typing (to_key, at);

create or replace function lelons.peer_of(with_user text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  peer uuid;
begin
  if with_user is null or with_user like 'g:%' then  -- (a group: see group_of)
    return null;
  end if;
  select a.id into peer from lelons.accounts a where lower(a.username) = lower(btrim(with_user));
  if peer is null then
    raise exception 'nobody' using hint = 'nobody';
  end if;
  return peer;
end $$;

-- Typing in a chat (stop = true when the message was sent or the box emptied).
create or replace function public.lelons_chat_typing(token text, with_user text default null, stop boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  key uuid := coalesce(lelons.group_of(with_user, me.id), lelons.peer_of(with_user), '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if stop then
    delete from lelons.chat_typing t where t.account_id = me.id and t.to_key = key;
  else
    insert into lelons.chat_typing as t (account_id, to_key, at) values (me.id, key, now())
    on conflict (account_id, to_key) do update set at = now();
    delete from lelons.chat_typing t where t.at < now() - interval '1 hour';  -- (old ones nobody stopped)
  end if;
end $$;

-- While a chat is open: say how far you've read (seen_id), and get who's typing and who has seen what.
create or replace function public.lelons_chat_live(token text, with_user text default null, seen_id bigint default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid := lelons.peer_of(with_user);
  gid uuid := lelons.group_of(with_user, me.id);
  zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if seen_id is not null then
    insert into lelons.chat_seen as x (account_id, peer_key, last_id) values (me.id, coalesce(gid, peer, zero), seen_id)
    on conflict (account_id, peer_key) do update set last_id = greatest(x.last_id, excluded.last_id), seen_at = now();
  end if;
  return json_build_object(
    'typing', coalesce((select json_agg(a.username order by lower(a.username))
                        from lelons.chat_typing t join lelons.accounts a on a.id = t.account_id
                        where t.at > now() - interval '6 seconds' and t.account_id <> me.id
                          and (case when gid is not null then t.to_key = gid
                                    when peer is null then t.to_key = zero else t.account_id = peer and t.to_key = me.id end)),
                       '[]'::json),
    'seen', coalesce((select json_agg(json_build_object('username', y.username, 'avatar', y.avatar, 'last_id', y.last_id)
                                      order by y.seen_at desc)
                      from (select a.username, a.avatar, x.last_id, x.seen_at
                            from lelons.chat_seen x join lelons.accounts a on a.id = x.account_id
                            where x.account_id <> me.id and x.seen_at > now() - interval '30 days'
                              and (case when gid is not null then x.peer_key = gid
                                          and exists (select 1 from lelons.chat_group_members m
                                                      where m.group_id = gid and m.account_id = x.account_id)
                                        when peer is null then x.peer_key = zero else x.account_id = peer and x.peer_key = me.id end)
                            order by x.seen_at desc limit 20) y),
                     '[]'::json));
end $$;

-- The round numbers worth a party: every 100 below 1,000, every 1,000 below 10K, and so on.
create or replace function lelons.step(n bigint) returns bigint language sql immutable set search_path = '' as $$
  select case when n < 1000 then 100 when n < 10000 then 1000 when n < 100000 then 10000
              when n < 1000000 then 100000 else 1000000 end::bigint
$$;

-- What the crew did lately, for Home: new sounds, new people, and channels passing a round number.
create or replace function lelons.activity() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x.item order by x.at desc), '[]'::json) from (
    (select s.created_at as at, json_build_object('kind', 'upload', 'at', s.created_at, 'id', s.id, 'name', s.name,
              'category', s.category, 'path', s.path, 'seconds', s.seconds,
              'username', coalesce(a.username, s.uploader), 'avatar', a.avatar) as item
     from lelons.sounds s left join lelons.accounts a on a.id = s.uploader_id
     where s.created_at > now() - interval '30 days' order by s.created_at desc limit 15)
    union all
    (select a.created_at, json_build_object('kind', 'joined', 'at', a.created_at, 'username', a.username, 'avatar', a.avatar)
     from lelons.accounts a where a.created_at > now() - interval '60 days' order by a.created_at desc limit 5)
    union all
    (select m.day::timestamptz + interval '12 hours', json_build_object('kind', 'milestone', 'at', m.day::timestamptz + interval '12 hours',
              'channel', m.channel, 'subs', m.mark)
     from (select c.channel, c.day,
                  (c.subs / lelons.step(c.subs)) * lelons.step(c.subs) as mark,
                  lag(c.subs) over (partition by c.channel order by c.day) as before
           from lelons.channel_stats c where c.day > (now() at time zone 'utc')::date - 61) m
     where m.before is not null and m.before < m.mark and m.day > (now() at time zone 'utc')::date - 31
     order by m.day desc limit 8)
  ) x
$$;

-- ---- Docs (1.36.0): documents and movie scripts you write together with people you invite.
-- (Local docs never come here: they stay on your own computer.)

create table if not exists lelons.docs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references lelons.accounts (id) on delete cascade,
  title text not null default 'Untitled document' check (length(title) <= 150),
  kind text not null default 'doc' check (kind in ('doc', 'script')),
  rev bigint not null default 0,          -- goes up by one with every change
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references lelons.accounts (id) on delete set null
);
alter table lelons.docs add column if not exists settings jsonb not null default '{}'::jsonb;  -- page size, font... (1.36.0)
-- A document is a list of blocks (paragraphs, headings, lists...), each saved on its own,
-- so people can write in different parts at the same time.
create table if not exists lelons.doc_blocks (
  doc_id uuid not null references lelons.docs (id) on delete cascade,
  id text not null check (length(id) between 1 and 40),
  pos text collate "C" not null check (length(pos) between 1 and 1000),  -- sorts the blocks (text order, like the app)
  html text not null default '' check (length(html) <= 600000),
  rev bigint not null,
  deleted boolean not null default false,
  primary key (doc_id, id)
);
create index if not exists doc_blocks_rev on lelons.doc_blocks (doc_id, rev);
-- Who's in a document: invited (joined = false) until they say yes.
create table if not exists lelons.doc_members (
  doc_id uuid not null references lelons.docs (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  joined boolean not null default false,
  invited_by uuid references lelons.accounts (id) on delete set null,
  invited_at timestamptz not null default now(),
  primary key (doc_id, account_id)
);
create index if not exists doc_members_account on lelons.doc_members (account_id);
-- Who has the document open right now, and where they're writing.
create table if not exists lelons.doc_here (
  doc_id uuid not null references lelons.docs (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  block text,
  typed_at timestamptz,
  at timestamptz not null default now(),
  primary key (doc_id, account_id)
);
alter table lelons.docs enable row level security;
alter table lelons.doc_blocks enable row level security;
alter table lelons.doc_members enable row level security;
alter table lelons.doc_here enable row level security;
revoke all on lelons.docs, lelons.doc_blocks, lelons.doc_members, lelons.doc_here from anon, authenticated;

-- The document, if this account may open it (made it, or was invited and joined). Nobody else,
-- not even the owner of the app.
create or replace function lelons.doc_for(me uuid, doc uuid) returns lelons.docs
language plpgsql stable security definer set search_path = '' as $$
declare
  found lelons.docs;
begin
  select d.* into found from lelons.docs d where d.id = doc
    and (d.owner_id = me or exists (select 1 from lelons.doc_members m where m.doc_id = d.id and m.account_id = me and m.joined));
  if found.id is null then
    raise exception 'no such document' using hint = 'doc_gone';
  end if;
  return found;
end $$;

create or replace function lelons.doc_people(doc lelons.docs) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('username', a.username, 'avatar', a.avatar,
                                             'owner', a.id = doc.owner_id, 'joined', a.id = doc.owner_id or m.joined)
                           order by a.id <> doc.owner_id, lower(a.username)), '[]'::json)
  from lelons.accounts a left join lelons.doc_members m on m.doc_id = doc.id and m.account_id = a.id
  where a.id = doc.owner_id or m.account_id is not null
$$;

-- The first few blocks, for the little page picture in the list.
create or replace function lelons.doc_preview(doc uuid) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(left(b.html, 2000) order by b.pos collate "C", b.id), '[]'::json)
  from (select x.html, x.pos, x.id from lelons.doc_blocks x where x.doc_id = doc and not x.deleted
          and x.id not like '%~%' -- (only the first page; the others and their names have a ~ in the id)
        order by x.pos collate "C", x.id limit 14) b
$$;

-- Your shared documents, and the invitations waiting for an answer.
create or replace function public.lelons_docs(token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return json_build_object(
    'docs', coalesce((select json_agg(json_build_object('id', d.id, 'title', d.title, 'kind', d.kind,
                                        'mine', d.owner_id = me.id, 'updated_at', d.updated_at,
                                        'updated_by', (select a.username from lelons.accounts a where a.id = d.updated_by),
                                        'people', lelons.doc_people(d), 'preview', lelons.doc_preview(d.id), 'settings', d.settings)
                                      order by d.updated_at desc)
                      from lelons.docs d
                      where d.owner_id = me.id
                         or exists (select 1 from lelons.doc_members m where m.doc_id = d.id and m.account_id = me.id and m.joined)),
                     '[]'::json),
    'invites', coalesce((select json_agg(json_build_object('id', d.id, 'title', d.title, 'kind', d.kind, 'at', m.invited_at,
                                           'from', coalesce(a.username, '?'), 'avatar', a.avatar)
                                         order by m.invited_at desc)
                         from lelons.doc_members m join lelons.docs d on d.id = m.doc_id
                         left join lelons.accounts a on a.id = m.invited_by
                         where m.account_id = me.id and not m.joined),
                        '[]'::json));
end $$;

-- Everyone you could invite.
create or replace function public.lelons_doc_people(token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar) order by lower(a.username))
                   from lelons.accounts a where a.id <> me.id), '[]'::json);
end $$;

-- Writes blocks (each {id, pos, html, deleted}) into a document. Only for the functions below.
create or replace function lelons.doc_write(doc uuid, me uuid, changes jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_rev bigint;
  change jsonb;
begin
  if jsonb_typeof(coalesce(changes, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(changes, '[]'::jsonb)) > 3000 then
    raise exception 'bad changes' using hint = 'bad_input';
  end if;
  update lelons.docs set rev = rev + 1, updated_at = now(), updated_by = me where id = doc returning rev into new_rev;
  for change in select * from jsonb_array_elements(coalesce(changes, '[]'::jsonb)) loop
    if coalesce(length(change->>'id'), 0) not between 1 and 40 or coalesce(length(change->>'pos'), 0) not between 1 and 1000
       or length(coalesce(change->>'html', '')) > 600000 then
      raise exception 'bad block' using hint = 'bad_input';
    end if;
    insert into lelons.doc_blocks as b (doc_id, id, pos, html, rev, deleted)
    values (doc, change->>'id', change->>'pos', coalesce(change->>'html', ''), new_rev, coalesce((change->>'deleted')::boolean, false))
    on conflict (doc_id, id) do update set pos = excluded.pos, html = excluded.html, rev = excluded.rev, deleted = excluded.deleted;
  end loop;
  if (select count(*) from lelons.doc_blocks b where b.doc_id = doc and not b.deleted) > 5000 then
    raise exception 'too long' using hint = 'doc_long';
  end if;
  if (select coalesce(sum(length(b.html)), 0) from lelons.doc_blocks b where b.doc_id = doc and not b.deleted) > 20000000 then
    raise exception 'too big' using hint = 'doc_big';
  end if;
  return new_rev;
end $$;

-- A new shared document (blocks: what's in it to start with, like a template or a local doc).
drop function if exists public.lelons_doc_create(text, text, text, jsonb);
create or replace function public.lelons_doc_create(token text, title text, kind text, blocks jsonb default '[]'::jsonb,
                                                    doc_settings jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc uuid;
begin
  if (select count(*) from lelons.docs d where d.owner_id = me.id) >= 300 then
    raise exception 'too many docs' using hint = 'doc_many';
  end if;
  if kind not in ('doc', 'script') then
    raise exception 'bad kind' using hint = 'bad_input';
  end if;
  if jsonb_typeof(coalesce(doc_settings, '{}'::jsonb)) <> 'object' or length(coalesce(doc_settings, '{}'::jsonb)::text) > 4000 then
    raise exception 'bad settings' using hint = 'bad_input';
  end if;
  insert into lelons.docs (owner_id, title, kind, updated_by, settings)
  values (me.id, left(coalesce(nullif(btrim(title), ''), 'Untitled document'), 150), kind, me.id, coalesce(doc_settings, '{}'::jsonb))
  returning id into doc;
  perform lelons.doc_write(doc, me.id, blocks);
  return doc;
end $$;

-- Opening a document: everything in it.
create or replace function public.lelons_doc_open(token text, doc_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc lelons.docs := lelons.doc_for(me.id, doc_id);
begin
  return json_build_object('id', doc.id, 'title', doc.title, 'kind', doc.kind, 'rev', doc.rev, 'settings', doc.settings,
    'mine', doc.owner_id = me.id, 'people', lelons.doc_people(doc),
    'blocks', coalesce((select json_agg(json_build_object('id', b.id, 'pos', b.pos, 'html', b.html) order by b.pos collate "C", b.id)
                        from lelons.doc_blocks b where b.doc_id = doc.id and not b.deleted), '[]'::json));
end $$;

-- While a document is open (about every second): send your changes, get everyone else's
-- (all blocks changed after since_rev), and say where you're writing.
drop function if exists public.lelons_doc_sync(text, uuid, bigint, jsonb, text, text, boolean);
create or replace function public.lelons_doc_sync(token text, doc_id uuid, since_rev bigint, changes jsonb default '[]'::jsonb,
                                                  new_title text default null, at_block text default null, typing boolean default false,
                                                  new_settings jsonb default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc lelons.docs := lelons.doc_for(me.id, doc_id);
  now_rev bigint;
begin
  if jsonb_array_length(coalesce(changes, '[]'::jsonb)) > 0 then
    perform lelons.doc_write(doc.id, me.id, changes);
  end if;
  if new_title is not null and left(coalesce(nullif(btrim(new_title), ''), 'Untitled document'), 150) <> doc.title then
    update lelons.docs d set title = left(coalesce(nullif(btrim(new_title), ''), 'Untitled document'), 150),
      rev = d.rev + 1, updated_at = now(), updated_by = me.id where d.id = doc.id;
  end if;
  if new_settings is not null and jsonb_typeof(new_settings) = 'object' and length(new_settings::text) <= 4000
     and new_settings <> doc.settings then
    update lelons.docs d set settings = new_settings, rev = d.rev + 1, updated_at = now(), updated_by = me.id where d.id = doc.id;
  end if;
  insert into lelons.doc_here as h (doc_id, account_id, block, typed_at, at)
  values (doc.id, me.id, left(at_block, 40), case when typing then now() end, now())
  on conflict on constraint doc_here_pkey do update set block = excluded.block, at = now(),
    typed_at = case when typing then now() else h.typed_at end;
  -- The revision first, then the blocks: a change saved in between comes again next time, never not at all.
  select d.rev, d.title, d.settings into now_rev, doc.title, doc.settings from lelons.docs d where d.id = doc.id;
  return json_build_object('rev', now_rev, 'title', doc.title, 'settings', doc.settings,
    'blocks', coalesce((select json_agg(json_build_object('id', b.id, 'pos', b.pos, 'html', b.html, 'deleted', b.deleted, 'rev', b.rev))
                        from lelons.doc_blocks b where b.doc_id = doc.id and b.rev > coalesce(since_rev, 0)), '[]'::json),
    'here', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'block', h.block,
                                                        'typing', h.typed_at > now() - interval '4 seconds')
                                      order by lower(a.username))
                      from lelons.doc_here h join lelons.accounts a on a.id = h.account_id
                      where h.doc_id = doc.id and h.account_id <> me.id and h.at > now() - interval '10 seconds'), '[]'::json),
    'people', lelons.doc_people(doc));
end $$;

-- Closing a document.
create or replace function public.lelons_doc_close(token text, doc_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  delete from lelons.doc_here h where h.doc_id = lelons_doc_close.doc_id and h.account_id = me.id;
end $$;

-- The one who made a document invites people (by username).
create or replace function public.lelons_doc_invite(token text, doc_id uuid, usernames text[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc lelons.docs := lelons.doc_for(me.id, doc_id);
begin
  if doc.owner_id <> me.id then
    raise exception 'not yours' using hint = 'denied';
  end if;
  insert into lelons.doc_members (doc_id, account_id, invited_by)
  select doc.id, a.id, me.id from lelons.accounts a
  where lower(a.username) = any (select lower(btrim(u)) from unnest(coalesce(usernames, '{}')) u) and a.id <> me.id
  on conflict on constraint doc_members_pkey do nothing;
  if (select count(*) from lelons.doc_members m where m.doc_id = doc.id) > 50 then
    raise exception 'too many people' using hint = 'doc_people';
  end if;
  return lelons.doc_people(doc);
end $$;

-- Saying yes (join) or no to an invitation.
create or replace function public.lelons_doc_answer(token text, doc_id uuid, join_it boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if join_it then
    update lelons.doc_members m set joined = true where m.doc_id = lelons_doc_answer.doc_id and m.account_id = me.id;
  else
    delete from lelons.doc_members m where m.doc_id = lelons_doc_answer.doc_id and m.account_id = me.id and not m.joined;
  end if;
  if not found then
    raise exception 'no invite' using hint = 'doc_gone';
  end if;
end $$;

-- The one who made it takes someone out; anyone else can only take themselves out (leave).
create or replace function public.lelons_doc_remove(token text, doc_id uuid, username text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc lelons.docs;
  them uuid;
begin
  select a.id into them from lelons.accounts a where lower(a.username) = lower(btrim(lelons_doc_remove.username));
  select d.* into doc from lelons.docs d where d.id = lelons_doc_remove.doc_id;
  if doc.id is null or them is null or them = doc.owner_id or (doc.owner_id <> me.id and them <> me.id) then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  delete from lelons.doc_members m where m.doc_id = doc.id and m.account_id = them;
  delete from lelons.doc_here h where h.doc_id = doc.id and h.account_id = them;
  return lelons.doc_people(doc);
end $$;

-- Only the one who made a document can delete it (for everyone).
create or replace function public.lelons_doc_delete(token text, doc_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  delete from lelons.docs d where d.id = lelons_doc_delete.doc_id and d.owner_id = me.id;
  if not found then
    raise exception 'not yours' using hint = 'denied';
  end if;
end $$;

-- ---- Doc comments (2.2.0): notes on a piece of text in a shared document, with replies.
-- Everyone in the document sees them; they don't change the text.
create table if not exists lelons.doc_comments (
  id bigserial primary key,
  doc_id uuid not null references lelons.docs (id) on delete cascade,
  parent_id bigint references lelons.doc_comments (id) on delete cascade,  -- set on a reply
  block text check (length(block) <= 40),          -- the paragraph it's on
  quote text check (length(quote) <= 300),         -- the words it's on
  body text not null check (length(body) between 1 and 2000),
  author_id uuid references lelons.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  resolved boolean not null default false,
  resolved_by uuid references lelons.accounts (id) on delete set null
);
create index if not exists doc_comments_doc on lelons.doc_comments (doc_id, id);
alter table lelons.doc_comments enable row level security;
revoke all on lelons.doc_comments from anon, authenticated;
revoke all on sequence lelons.doc_comments_id_seq from anon, authenticated;

-- All comments of a document (and a count, so the app only redraws when something changed).
create or replace function public.lelons_doc_comments(token text, doc_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc lelons.docs := lelons.doc_for(me.id, doc_id);
begin
  return coalesce((select json_agg(json_build_object('id', c.id, 'parent', c.parent_id, 'block', c.block, 'quote', c.quote,
      'body', c.body, 'username', coalesce(a.username, 'Someone'), 'avatar', a.avatar, 'at', c.created_at,
      'edited', c.edited_at is not null, 'resolved', c.resolved, 'resolvedBy', r.username,
      'mine', c.author_id = me.id, 'canDelete', c.author_id = me.id or doc.owner_id = me.id) order by c.id)
    from (select * from lelons.doc_comments x where x.doc_id = doc.id order by x.id desc limit 1000) c
    left join lelons.accounts a on a.id = c.author_id
    left join lelons.accounts r on r.id = c.resolved_by), '[]'::json);
end $$;

-- Add a comment or a reply, change your own, resolve or reopen one, or delete it
-- (your own, or any if the document is yours).
create or replace function public.lelons_doc_comment(token text, doc_id uuid, what text, comment_id bigint default null,
                                                     block text default null, quote text default null, body text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  doc lelons.docs := lelons.doc_for(me.id, doc_id);
  c lelons.doc_comments;
  clean text := left(btrim(coalesce(body, '')), 2000);
begin
  if comment_id is not null then
    select x.* into c from lelons.doc_comments x where x.id = comment_id and x.doc_id = doc.id;
    if c.id is null then
      raise exception 'no such comment' using hint = 'comment_gone';
    end if;
  end if;
  if what in ('add', 'reply', 'edit') and clean = '' then
    raise exception 'empty' using hint = 'bad_input';
  end if;
  if what = 'add' then
    if (select count(*) from lelons.doc_comments x where x.doc_id = doc.id) >= 1000 then
      raise exception 'too many' using hint = 'comment_many';
    end if;
    insert into lelons.doc_comments (doc_id, block, quote, body, author_id)
    values (doc.id, left(lelons_doc_comment.block, 40), left(lelons_doc_comment.quote, 300), clean, me.id) returning * into c;
  elsif what = 'reply' and c.id is not null then
    if (select count(*) from lelons.doc_comments x where x.doc_id = doc.id) >= 1000 then
      raise exception 'too many' using hint = 'comment_many';
    end if;
    insert into lelons.doc_comments (doc_id, parent_id, body, author_id)
    values (doc.id, coalesce(c.parent_id, c.id), clean, me.id) returning * into c;
    update lelons.doc_comments x set resolved = false, resolved_by = null where x.id = c.parent_id;  -- a reply opens it again
  elsif what = 'edit' and c.author_id = me.id then
    update lelons.doc_comments x set body = clean, edited_at = now() where x.id = c.id;
  elsif what in ('resolve', 'reopen') and c.id is not null and c.parent_id is null then
    update lelons.doc_comments x set resolved = what = 'resolve', resolved_by = case when what = 'resolve' then me.id end
    where x.id = c.id;
  elsif what = 'delete' and (c.author_id = me.id or doc.owner_id = me.id) then
    delete from lelons.doc_comments x where x.id = c.id;
  else
    raise exception 'not allowed' using hint = 'denied';
  end if;
  return public.lelons_doc_comments(token, doc.id);
end $$;

-- ---- Group chats (2.4.0)

-- Deletes a group (nobody is left in it). Returns its files (picture and clips) for the app to delete.
create or replace function lelons.drop_group(gid uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  files text[];
begin
  select coalesce(array_agg(f), '{}') into files from (
    select x.picture f from lelons.chat_groups x where x.id = gid and x.picture is not null
    union all select c.file from lelons.chat c where c.group_id = gid and c.file is not null) y;
  perform lelons.delete_ticket(f) from unnest(files) f;
  delete from lelons.chat_seen x where x.peer_key = gid;
  delete from lelons.chat_typing x where x.to_key = gid;
  delete from lelons.chat_groups x where x.id = gid;
  return files;
end $$;

-- An account is about to be deleted: it leaves its groups (empty ones are deleted, owned ones get a
-- new owner). Returns the files that go with it (its clips, emptied groups' files) for the app to delete.
create or replace function lelons.account_leaving(acc uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  files text[];
  g record;
begin
  select coalesce(array_agg(c.file), '{}') into files from lelons.chat c where c.account_id = acc and c.file is not null;
  files := files || coalesce((select array[a.banner] from lelons.accounts a where a.id = acc and a.banner is not null), '{}');
  perform lelons.delete_ticket(f) from unnest(files) f;
  for g in select m.group_id from lelons.chat_group_members m where m.account_id = acc loop
    delete from lelons.chat_group_members m where m.group_id = g.group_id and m.account_id = acc;
    if not exists (select 1 from lelons.chat_group_members m where m.group_id = g.group_id) then
      files := files || lelons.drop_group(g.group_id);
    else
      update lelons.chat_groups x set owner_id = (select m.account_id from lelons.chat_group_members m
                                                  where m.group_id = x.id order by m.added_at limit 1)
      where x.id = g.group_id and (x.owner_id = acc or x.owner_id is null);
    end if;
  end loop;
  return files;
end $$;

-- what: create (name, usernames), rename (name), picture (a file uploaded with an 'avatar' ticket, or
-- null to take it off), add (usernames), remove (one username; the owner only), leave.
-- Everyone in a group can rename it, change its picture and add people. Returns the group, or for
-- create its id too. A group nobody is left in is deleted.
drop function if exists public.lelons_chat_group(text, text, uuid, text, text[], text);
create or replace function public.lelons_chat_group(token text, what text, group_id uuid default null,
                                                    group_name text default null, usernames text[] default null,
                                                    picture text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  g lelons.chat_groups;
  clean text := left(btrim(coalesce(group_name, '')), 50);
  old_picture text;
  them uuid;
  n int;
begin
  if what = 'create' then
    if clean = '' then
      return json_build_object('ok', false, 'error', 'name');
    end if;
    if (select count(*) from lelons.chat_groups x where x.owner_id = me.id and x.created_at > now() - interval '1 day') >= 20 then
      return json_build_object('ok', false, 'error', 'daily');
    end if;
    insert into lelons.chat_groups (name, owner_id) values (clean, me.id) returning * into g;
    insert into lelons.chat_group_members (group_id, account_id) values (g.id, me.id);
  else
    select x.* into g from lelons.chat_groups x where x.id = lelons_chat_group.group_id for update;
    if g.id is null or not exists (select 1 from lelons.chat_group_members m where m.group_id = g.id and m.account_id = me.id) then
      return json_build_object('ok', false, 'error', 'nogroup');
    end if;
  end if;
  if what in ('create', 'add') then
    insert into lelons.chat_group_members (group_id, account_id)
    select g.id, a.id from lelons.accounts a
    where lower(a.username) in (select lower(btrim(u)) from unnest(coalesce(usernames, '{}'::text[])) u)
    on conflict do nothing;
    if (select count(*) from lelons.chat_group_members m where m.group_id = g.id) > 50 then
      raise exception 'too many people' using hint = 'many';
    end if;
  elsif what = 'rename' then
    if clean = '' then
      return json_build_object('ok', false, 'error', 'name');
    end if;
    update lelons.chat_groups x set name = clean where x.id = g.id;
  elsif what = 'picture' then
    if picture is not null and (picture not like 'avatars/%' or not exists
        (select 1 from lelons.tickets t where t.path = picture and t.kind = 'upload' and t.account_id = me.id)) then
      raise exception 'wrong file';
    end if;
    old_picture := g.picture;
    update lelons.chat_groups x set picture = lelons_chat_group.picture where x.id = g.id;
    delete from lelons.tickets t where t.path = lelons_chat_group.picture;
    if old_picture is not null then
      perform lelons.delete_ticket(old_picture);
    end if;
  elsif what = 'remove' then
    select a.id into them from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(usernames[1], '')));
    if g.owner_id is distinct from me.id or them is null or them = me.id then
      return json_build_object('ok', false, 'error', 'denied');
    end if;
    delete from lelons.chat_group_members m where m.group_id = g.id and m.account_id = them;
    delete from lelons.chat_seen x where x.account_id = them and x.peer_key = g.id;
    delete from lelons.chat_typing x where x.account_id = them and x.to_key = g.id;
  elsif what = 'leave' then
    delete from lelons.chat_group_members m where m.group_id = g.id and m.account_id = me.id;
    delete from lelons.chat_seen x where x.account_id = me.id and x.peer_key = g.id;
    delete from lelons.chat_typing x where x.account_id = me.id and x.to_key = g.id;
    select count(*) into n from lelons.chat_group_members m where m.group_id = g.id;
    if n = 0 then
      return json_build_object('ok', true, 'gone', true, 'files', lelons.drop_group(g.id));
    end if;
    if g.owner_id is null or g.owner_id = me.id then  -- the person who's been in it longest takes over
      update lelons.chat_groups x set owner_id = (select m.account_id from lelons.chat_group_members m
                                                  where m.group_id = g.id order by m.added_at limit 1) where x.id = g.id;
    end if;
    return json_build_object('ok', true, 'gone', true);
  elsif what <> 'create' then
    raise exception 'bad what';
  end if;
  return json_build_object('ok', true, 'id', g.id, 'group', lelons.group_json(g.id), 'old_picture', old_picture);
end $$;

-- ---- (2.9.0) Playlists: your own lists of Library sounds (the ones you use most, say).
-- Only you see a playlist, plus the people you invite to it. Everyone in it can add and take out
-- sounds; only the one who made it can rename it, invite or remove people, or delete it.

create table if not exists lelons.playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 50),
  owner_id uuid not null references lelons.accounts (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists playlists_by_owner on lelons.playlists (owner_id);
create table if not exists lelons.playlist_members (
  playlist_id uuid not null references lelons.playlists (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, account_id)
);
create index if not exists playlist_members_by_account on lelons.playlist_members (account_id);
create table if not exists lelons.playlist_sounds (
  playlist_id uuid not null references lelons.playlists (id) on delete cascade,
  sound_id uuid not null references lelons.sounds (id) on delete cascade,
  added_by uuid references lelons.accounts (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (playlist_id, sound_id)
);
alter table lelons.playlists enable row level security;
alter table lelons.playlist_members enable row level security;
alter table lelons.playlist_sounds enable row level security;
revoke all on lelons.playlists, lelons.playlist_members, lelons.playlist_sounds from anon, authenticated;

-- Your playlists (yours first, then the ones you were invited to), each with its sounds (newest
-- added first) and its people, plus everyone's name (to pick who to invite).
create or replace function lelons.playlists_json(me uuid) returns json
  language sql stable set search_path = '' as $$
  select json_build_object(
    'playlists', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'mine', p.owner_id = me, 'owner', o.username, 'owner_avatar', o.avatar,
        'created_at', p.created_at,
        'sounds', coalesce((select json_agg(ps.sound_id order by ps.added_at desc)
                            from lelons.playlist_sounds ps where ps.playlist_id = p.id), '[]'::json),
        'members', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar) order by m.added_at)
                             from lelons.playlist_members m join lelons.accounts a on a.id = m.account_id
                             where m.playlist_id = p.id), '[]'::json))
        order by (p.owner_id = me) desc, p.created_at)
      from lelons.playlists p join lelons.accounts o on o.id = p.owner_id
      where p.owner_id = me or exists (select 1 from lelons.playlist_members m where m.playlist_id = p.id and m.account_id = me)
    ), '[]'::json),
    'people', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar)
                                        order by lower(a.username))
                        from lelons.accounts a where a.id <> me), '[]'::json)) $$;

create or replace function public.lelons_playlists(token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return lelons.playlists_json(me.id);
end $$;

-- Change your playlists. what: create (playlist_name), rename (playlist_name), delete, add or take
-- out a sound (sound_id), invite or remove people (usernames), or leave one you were invited to.
-- Returns {ok, id (of a new playlist), playlists, people}, or {ok: false, error}.
create or replace function public.lelons_playlist(token text, what text, playlist_id uuid default null,
                                                  playlist_name text default null, sound_id uuid default null,
                                                  usernames text[] default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  p lelons.playlists;
  new_name text := btrim(regexp_replace(coalesce(playlist_name, ''), '\s+', ' ', 'g'));
begin
  if what = 'create' then
    if new_name = '' then
      return json_build_object('ok', false, 'error', 'name');
    end if;
    if (select count(*) from lelons.playlists x where x.owner_id = me.id) >= 100 then
      return json_build_object('ok', false, 'error', 'many_lists');
    end if;
    insert into lelons.playlists (name, owner_id) values (left(new_name, 50), me.id) returning * into p;
    return json_build_object('ok', true, 'id', p.id) :: jsonb || lelons.playlists_json(me.id) :: jsonb;
  end if;
  select x.* into p from lelons.playlists x where x.id = lelons_playlist.playlist_id;
  if p.id is null or not (p.owner_id = me.id or exists (
      select 1 from lelons.playlist_members m where m.playlist_id = p.id and m.account_id = me.id)) then
    return json_build_object('ok', false, 'error', 'noplaylist');
  end if;
  if what in ('rename', 'delete', 'invite', 'remove') and p.owner_id <> me.id then
    return json_build_object('ok', false, 'error', 'denied');
  end if;
  if what = 'rename' then
    if new_name = '' then
      return json_build_object('ok', false, 'error', 'name');
    end if;
    update lelons.playlists x set name = left(new_name, 50) where x.id = p.id;
  elsif what = 'delete' then
    delete from lelons.playlists x where x.id = p.id;
  elsif what = 'add' then
    if (select count(*) from lelons.playlist_sounds s where s.playlist_id = p.id) >= 2000 then
      return json_build_object('ok', false, 'error', 'many_sounds');
    end if;
    insert into lelons.playlist_sounds (playlist_id, sound_id, added_by)
    select p.id, s.id, me.id from lelons.sounds s where s.id = lelons_playlist.sound_id
    on conflict do nothing;
    if not found and not exists (select 1 from lelons.sounds s where s.id = lelons_playlist.sound_id) then
      return json_build_object('ok', false, 'error', 'gone');
    end if;
  elsif what = 'take_out' then
    delete from lelons.playlist_sounds s where s.playlist_id = p.id and s.sound_id = lelons_playlist.sound_id;
  elsif what = 'invite' then
    insert into lelons.playlist_members (playlist_id, account_id)
    select p.id, a.id from lelons.accounts a
    where lower(a.username) = any (select lower(u) from unnest(coalesce(usernames, '{}')) u) and a.id <> me.id
    on conflict do nothing;
    if (select count(*) from lelons.playlist_members m where m.playlist_id = p.id) > 50 then
      raise exception 'too many people' using hint = 'many_people';
    end if;
  elsif what = 'remove' then
    delete from lelons.playlist_members m using lelons.accounts a
    where m.playlist_id = p.id and a.id = m.account_id
      and lower(a.username) = any (select lower(u) from unnest(coalesce(usernames, '{}')) u);
  elsif what = 'leave' then
    if p.owner_id = me.id then
      return json_build_object('ok', false, 'error', 'denied');
    end if;
    delete from lelons.playlist_members m where m.playlist_id = p.id and m.account_id = me.id;
  else
    raise exception 'bad what';
  end if;
  return json_build_object('ok', true) :: jsonb || lelons.playlists_json(me.id) :: jsonb;
end $$;

-- (2.11.0) Calls: in private chats and in group chats. A call is a "room"; everyone in it connects to
-- everyone else (each pair swaps an offer and an answer through lelons_room), then the sound and
-- shared screens go straight between the apps. (2.10.0's one-to-one calls, lelons_call, are replaced.)
drop function if exists public.lelons_call(text, text, uuid, text, text);
drop function if exists lelons.calls_json(uuid);
drop function if exists lelons.call_tidy(uuid);
drop function if exists lelons.call_end(uuid, text);
drop table if exists lelons.calls;

create table if not exists lelons.rooms (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references lelons.chat_groups (id) on delete cascade,  -- a group call, or null
  started_by uuid references lelons.accounts (id) on delete set null,
  peer_id uuid references lelons.accounts (id) on delete set null,     -- a private call: who was called
  created_at timestamptz not null default now(),
  talked_at timestamptz,  -- when a second person joined
  ended_at timestamptz,
  why text                -- private calls: declined, missed, cancelled
);
create table if not exists lelons.room_people (
  room_id uuid not null references lelons.rooms (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  state text not null check (state in ('ringing', 'in', 'left', 'declined', 'missed')),
  rang_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (room_id, account_id)
);
create table if not exists lelons.room_signals (
  id bigint generated always as identity primary key,
  room_id uuid not null references lelons.rooms (id) on delete cascade,
  from_id uuid not null references lelons.accounts (id) on delete cascade,
  to_id uuid not null references lelons.accounts (id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer')),
  sdp text not null check (length(sdp) <= 30000),
  created_at timestamptz not null default now()
);
alter table lelons.rooms enable row level security;
alter table lelons.room_people enable row level security;
alter table lelons.room_signals enable row level security;
create index if not exists rooms_live on lelons.rooms (group_id) where ended_at is null;
create index if not exists room_people_by_account on lelons.room_people (account_id, state);
create index if not exists room_signals_to on lelons.room_signals (to_id, id);
-- A call leaves a line in its chat: how long it was (seconds), 0 if nobody answered, -1 if declined.
alter table lelons.chat add column if not exists call_seconds int;

-- End a call and leave its line in the chat.
create or replace function lelons.room_end(rid uuid, reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r lelons.rooms;
begin
  update lelons.rooms x set ended_at = now(), why = coalesce(x.why, reason)
  where x.id = rid and x.ended_at is null returning * into r;
  if r.id is null then
    return;
  end if;
  update lelons.room_people p set state = case when p.state = 'ringing' then 'missed' else 'left' end
  where p.room_id = rid and p.state in ('ringing', 'in');
  delete from lelons.room_signals s where s.room_id = rid;
  if r.started_by is not null and (r.group_id is not null or r.peer_id is not null) then
    insert into lelons.chat (account_id, to_id, group_id, message, call_seconds)
    values (r.started_by, case when r.group_id is null then r.peer_id end, r.group_id, '',
            case when r.talked_at is not null then greatest(1, extract(epoch from now() - r.talked_at)::int)
                 when r.why = 'declined' then -1 else 0 end);
  end if;
end $$;

-- Who went quiet (app closed, internet gone) leaves; nobody answering stops ringing; empty calls end.
create or replace function lelons.room_tidy(rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r lelons.rooms;
  inside int;
  ringing int;
begin
  select * into r from lelons.rooms x where x.id = rid and x.ended_at is null;
  if r.id is null then
    return;
  end if;
  update lelons.room_people p set state = 'left' where p.room_id = rid and p.state = 'in' and p.seen_at < now() - interval '25 seconds';
  update lelons.room_people p set state = 'missed' where p.room_id = rid and p.state = 'ringing' and p.rang_at < now() - interval '45 seconds';
  select count(*) filter (where p.state = 'in'), count(*) filter (where p.state = 'ringing') into inside, ringing
  from lelons.room_people p where p.room_id = rid;
  if inside = 0 then
    perform lelons.room_end(rid, 'missed');
  elsif r.group_id is null and inside = 1 and ringing = 0 then  -- a private call: the other one hung up or never came
    perform lelons.room_end(rid, case when r.talked_at is null and exists (select 1 from lelons.room_people p
                                        where p.room_id = rid and p.state = 'declined') then 'declined'
                                      when r.talked_at is null then 'missed' end);
  end if;
end $$;

-- Your calls going on (ringing you, or you're in them) and the ones you were in that ended in the
-- last minute, with who's in each; plus offers and answers sent to you after signal id "after".
create or replace function lelons.rooms_json(me uuid, after bigint) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('ok', true,
    'rooms', coalesce((
      select json_agg(json_build_object(
        'id', r.id, 'live', r.ended_at is null, 'why', r.why, 'my_state', mine.state,
        'group', case when r.group_id is null then null
                      else (select json_build_object('id', g.id, 'name', g.name, 'picture', g.picture)
                            from lelons.chat_groups g where g.id = r.group_id) end,
        'started_by', (select a.username from lelons.accounts a where a.id = r.started_by),
        'created_at', r.created_at, 'talked_at', r.talked_at,
        'people', (select coalesce(json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'state', p.state)
                                            order by p.rang_at, lower(a.username)), '[]'::json)
                   from lelons.room_people p join lelons.accounts a on a.id = p.account_id
                   where p.room_id = r.id)) order by r.created_at)
      from lelons.rooms r join lelons.room_people mine on mine.room_id = r.id and mine.account_id = me
      where (r.ended_at is null and mine.state in ('ringing', 'in'))
         or (r.ended_at > now() - interval '1 minute')
         or (r.ended_at is null and mine.state in ('left', 'declined', 'missed') and r.group_id is not null)), '[]'::json),
    'signals', coalesce((
      select json_agg(json_build_object('id', s.id, 'room', s.room_id, 'from', a.username, 'kind', s.kind, 'sdp', s.sdp) order by s.id)
      from lelons.room_signals s join lelons.accounts a on a.id = s.from_id
      where s.to_id = me and s.id > coalesce(after, 0)), '[]'::json),
    'live_groups', coalesce((
      select json_agg(json_build_object('group', r.group_id, 'room', r.id,
                                        'people', (select count(*) from lelons.room_people p where p.room_id = r.id and p.state = 'in')))
      from lelons.rooms r where r.ended_at is null and r.group_id in
        (select m.group_id from lelons.chat_group_members m where m.account_id = me)), '[]'::json))
$$;

-- what:
--   'check'  (every few seconds) say you're still here; get your calls and the offers/answers for you (after: the last signal id you have)
--   'start'  with_user = a username or 'g:<group id>'; rings them (a group call that's already going is joined instead)
--   'join'   room_id: answer, or join a group call
--   'signal' room_id, to_user, kind ('offer' or 'answer'), sdp: how to reach you, for one person in the call
--   'leave'  room_id: hang up, or decline
create or replace function public.lelons_room(token text, what text, room_id uuid default null, with_user text default null,
                                               to_user text default null, kind text default null, sdp text default null,
                                               after bigint default 0)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid;
  gid uuid;
  rid uuid := room_id;
  r lelons.rooms;
  target uuid;
  x record;
begin
  update lelons.room_people p set seen_at = now() where p.account_id = me.id and p.state = 'in';
  for x in select p.room_id from lelons.room_people p join lelons.rooms rr on rr.id = p.room_id
           where p.account_id = me.id and rr.ended_at is null
           union select rr.id from lelons.rooms rr join lelons.chat_group_members m on m.group_id = rr.group_id
           where m.account_id = me.id and rr.ended_at is null loop
    perform lelons.room_tidy(x.room_id);
  end loop;

  if what = 'start' then
    if exists (select 1 from lelons.room_people p join lelons.rooms rr on rr.id = p.room_id
               where p.account_id = me.id and p.state = 'in' and rr.ended_at is null) then
      return json_build_object('ok', false, 'error', 'in_call');
    end if;
    if (select count(*) from lelons.rooms rr where rr.started_by = me.id and rr.created_at > now() - interval '1 minute') >= 6 then
      return json_build_object('ok', false, 'error', 'slow');
    end if;
    if (select count(*) from lelons.rooms rr where rr.started_by = me.id and rr.created_at > now() - interval '1 day') >= 300 then
      return json_build_object('ok', false, 'error', 'daily');
    end if;
    gid := lelons.group_of(with_user, me.id);
    if gid is not null then
      select rr.id into rid from lelons.rooms rr where rr.group_id = gid and rr.ended_at is null;
      if rid is null then
        insert into lelons.rooms (group_id, started_by) values (gid, me.id) returning id into rid;
        insert into lelons.room_people (room_id, account_id, state)
        select rid, m.account_id, case when m.account_id = me.id then 'in' else 'ringing' end
        from lelons.chat_group_members m where m.group_id = gid
          and (m.account_id = me.id or exists (select 1 from lelons.presence pr where pr.account_id = m.account_id
                                                and pr.seen_at > now() - interval '150 seconds'));
        return lelons.rooms_json(me.id, after)::jsonb || jsonb_build_object('room', rid);
      end if;
      what := 'join';  -- someone already started one: join it
    else
      peer := lelons.peer_of(with_user);
      if peer is null or peer = me.id then
        return json_build_object('ok', false, 'error', 'yourself');
      end if;
      if not exists (select 1 from lelons.presence pr where pr.account_id = peer and pr.seen_at > now() - interval '150 seconds') then
        return json_build_object('ok', false, 'error', 'offline');
      end if;
      for x in select distinct p.room_id from lelons.room_people p join lelons.rooms rr on rr.id = p.room_id
               where p.account_id = peer and rr.ended_at is null loop
        perform lelons.room_tidy(x.room_id);
      end loop;
      if exists (select 1 from lelons.room_people p join lelons.rooms rr on rr.id = p.room_id
                 where p.account_id = peer and p.state in ('in', 'ringing') and rr.ended_at is null) then
        return json_build_object('ok', false, 'error', 'busy');
      end if;
      insert into lelons.rooms (started_by, peer_id) values (me.id, peer) returning id into rid;
      insert into lelons.room_people (room_id, account_id, state) values (rid, me.id, 'in'), (rid, peer, 'ringing');
      delete from lelons.rooms rr where rr.ended_at < now() - interval '2 days';
      return lelons.rooms_json(me.id, after)::jsonb || jsonb_build_object('room', rid);
    end if;
  end if;

  if what = 'join' then
    select * into r from lelons.rooms rr where rr.id = rid and rr.ended_at is null;
    if r.id is null then
      return json_build_object('ok', false, 'error', 'gone');
    end if;
    if exists (select 1 from lelons.room_people p join lelons.rooms rr on rr.id = p.room_id
               where p.account_id = me.id and p.state = 'in' and rr.ended_at is null and rr.id <> rid) then
      return json_build_object('ok', false, 'error', 'in_call');
    end if;
    if r.group_id is not null then
      if not exists (select 1 from lelons.chat_group_members m where m.group_id = r.group_id and m.account_id = me.id) then
        return json_build_object('ok', false, 'error', 'gone');
      end if;
      if (select count(*) from lelons.room_people p where p.room_id = rid and p.state = 'in' and p.account_id <> me.id) >= 8 then
        return json_build_object('ok', false, 'error', 'full');
      end if;
      insert into lelons.room_people as p (room_id, account_id, state) values (rid, me.id, 'in')
      on conflict on constraint room_people_pkey do update set state = 'in', seen_at = now();
    else
      update lelons.room_people p set state = 'in', seen_at = now()
      where p.room_id = rid and p.account_id = me.id and p.state = 'ringing';
      if not found then
        return json_build_object('ok', false, 'error', 'gone');
      end if;
    end if;
    delete from lelons.room_signals s where s.room_id = rid and (s.from_id = me.id or s.to_id = me.id);
    update lelons.rooms rr set talked_at = coalesce(rr.talked_at, now()) where rr.id = rid;
  elsif what = 'signal' then
    if kind not in ('offer', 'answer') or coalesce(length(sdp), 0) < 10 or length(sdp) > 30000 then
      return json_build_object('ok', false, 'error', 'bad');
    end if;
    select a.id into target from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(to_user, '')));
    if target is null
       or not exists (select 1 from lelons.room_people p join lelons.rooms rr on rr.id = p.room_id
                      where p.room_id = rid and p.account_id = me.id and p.state = 'in' and rr.ended_at is null)
       or not exists (select 1 from lelons.room_people p where p.room_id = rid and p.account_id = target and p.state = 'in') then
      return json_build_object('ok', false, 'error', 'gone');
    end if;
    if (select count(*) from lelons.room_signals s where s.from_id = me.id and s.created_at > now() - interval '1 minute') >= 60 then
      return json_build_object('ok', false, 'error', 'slow');
    end if;
    insert into lelons.room_signals (room_id, from_id, to_id, kind, sdp)
    values (rid, me.id, target, lelons_room.kind, lelons_room.sdp);
    delete from lelons.room_signals s where s.created_at < now() - interval '3 minutes';
  elsif what = 'leave' then
    update lelons.room_people p set state = case when p.state = 'ringing' then 'declined' else 'left' end
    where p.room_id = rid and p.account_id = me.id and p.state in ('ringing', 'in');
    delete from lelons.room_signals s where s.room_id = rid and (s.from_id = me.id or s.to_id = me.id);
    select * into r from lelons.rooms rr where rr.id = rid and rr.ended_at is null;
    if r.id is not null and r.group_id is null and r.talked_at is null and r.started_by = me.id then
      perform lelons.room_end(rid, 'cancelled');  -- (hung up while it was ringing)
    elsif r.id is not null then
      perform lelons.room_tidy(rid);
    end if;
  elsif what <> 'check' then
    raise exception 'bad what';
  end if;
  return lelons.rooms_json(me.id, after);
end $$;

revoke execute on all functions in schema lelons from public;
-- ---- Team boards (2.12.0): Trello-like boards you share with people you invite.
-- (Boards that are "just me" never come here: they stay on your own computer.)
-- A board is kept as one piece (its lists and cards) with a number (rev) that goes up with every save.
-- When two people change it at the same time, the app puts both changes together and saves again.

create table if not exists lelons.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references lelons.accounts (id) on delete cascade,
  title text not null default 'Untitled board' check (length(title) <= 120),
  data jsonb not null default '{}'::jsonb,
  rev bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references lelons.accounts (id) on delete set null
);
create index if not exists boards_owner on lelons.boards (owner_id);
-- Who's on a board (the one who made it too): invited (joined = false) until they say yes.
create table if not exists lelons.board_members (
  board_id uuid not null references lelons.boards (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  joined boolean not null default false,
  starred boolean not null default false,
  invited_by uuid references lelons.accounts (id) on delete set null,
  invited_at timestamptz not null default now(),
  seen_at timestamptz,                     -- had the board open (the faces at the top)
  primary key (board_id, account_id)
);
create index if not exists board_members_account on lelons.board_members (account_id);
alter table lelons.boards enable row level security;
alter table lelons.board_members enable row level security;
revoke all on lelons.boards, lelons.board_members from anon, authenticated;

create or replace function lelons.board_people(b uuid, owner uuid) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'owner', a.id = owner,
                                             'joined', m.joined, 'here', coalesce(m.seen_at > now() - interval '12 seconds', false))
                           order by a.id <> owner, not m.joined, lower(a.username)), '[]'::json)
  from lelons.board_members m join lelons.accounts a on a.id = m.account_id
  where m.board_id = b
$$;

create or replace function lelons.board_cards(data jsonb) returns int
language sql immutable set search_path = '' as $$
  select count(*)::int from jsonb_array_elements(case when jsonb_typeof(data->'lists') = 'array' then data->'lists' else '[]'::jsonb end) l,
    jsonb_array_elements(case when jsonb_typeof(l->'cards') = 'array' then l->'cards' else '[]'::jsonb end) c
  where not coalesce((l->>'archived')::boolean, false) and not coalesce((c->>'archived')::boolean, false)
$$;

-- Everything about team boards in one place. what:
--   list               your team boards and the invitations waiting for an answer
--   people             everyone you could invite
--   create (data)      a new board, made from data
--   open / check       the board (check: only when it changed since base_rev), who's on it and who has it open
--   save (data, base_rev)  saves it, unless someone saved in between: then you get theirs back (conflict)
--   star (data: true/false)    your own star
--   invite (usernames) / remove (usernames: one) / leave / answer (data: true = join, false = no) / delete
create or replace function public.lelons_board(token text, what text, board_id uuid default null, data jsonb default null,
                                               base_rev bigint default null, usernames text[] default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  b lelons.boards;
  member lelons.board_members;
  them uuid;
  new_id uuid;
begin
  if what = 'list' then
    return json_build_object(
      'boards', coalesce((select json_agg(json_build_object('id', x.id, 'title', x.title, 'bg', coalesce(x.data->>'bg', 'blue'),
                                            'mine', x.owner_id = me.id, 'starred', m.starred, 'updated', extract(epoch from x.updated_at),
                                            'opened', extract(epoch from m.seen_at), 'created', extract(epoch from x.created_at),
                                            'cards', lelons.board_cards(x.data), 'people', lelons.board_people(x.id, x.owner_id))
                                          order by x.created_at)
                          from lelons.boards x join lelons.board_members m on m.board_id = x.id and m.account_id = me.id and m.joined),
                         '[]'::json),
      'invites', coalesce((select json_agg(json_build_object('id', x.id, 'title', x.title, 'bg', coalesce(x.data->>'bg', 'blue'),
                                             'from', coalesce(a.username, '?'), 'avatar', a.avatar, 'at', m.invited_at)
                                           order by m.invited_at desc)
                           from lelons.board_members m join lelons.boards x on x.id = m.board_id
                           left join lelons.accounts a on a.id = m.invited_by
                           where m.account_id = me.id and not m.joined),
                          '[]'::json));
  elsif what = 'people' then
    return coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar) order by lower(a.username))
                     from lelons.accounts a where a.id <> me.id), '[]'::json);
  elsif what = 'create' then
    if jsonb_typeof(data) <> 'object' or length(data::text) > 2000000 then
      raise exception 'bad board' using hint = 'board_big';
    end if;
    if (select count(*) from lelons.boards x where x.owner_id = me.id) >= 100 then
      raise exception 'too many boards' using hint = 'board_many';
    end if;
    insert into lelons.boards (owner_id, title, data, updated_by)
    values (me.id, left(coalesce(nullif(btrim(data->>'title'), ''), 'Untitled board'), 120), data, me.id) returning id into new_id;
    insert into lelons.board_members (board_id, account_id, joined, invited_by, seen_at) values (new_id, me.id, true, me.id, now());
    return json_build_object('id', new_id, 'rev', 1);
  elsif what = 'answer' then
    if coalesce((data #>> '{}')::boolean, false) then
      update lelons.board_members m set joined = true where m.board_id = lelons_board.board_id and m.account_id = me.id;
    else
      delete from lelons.board_members m where m.board_id = lelons_board.board_id and m.account_id = me.id and not m.joined;
    end if;
    if not found then
      raise exception 'no invite' using hint = 'board_gone';
    end if;
    return '{}'::json;
  end if;

  -- Everything else needs a board you're on.
  select x.* into b from lelons.boards x where x.id = lelons_board.board_id;
  select m.* into member from lelons.board_members m where m.board_id = b.id and m.account_id = me.id and m.joined;
  if b.id is null or member.account_id is null then
    raise exception 'no such board' using hint = 'board_gone';
  end if;

  if what in ('open', 'check') then
    update lelons.board_members m set seen_at = now() where m.board_id = b.id and m.account_id = me.id;
    return json_build_object('rev', b.rev, 'mine', b.owner_id = me.id, 'starred', member.starred,
                             'board', case when what = 'open' or base_rev is null or b.rev <> base_rev then b.data end,
                             'people', lelons.board_people(b.id, b.owner_id));
  elsif what = 'save' then
    if jsonb_typeof(data) <> 'object' or length(data::text) > 2000000 then
      raise exception 'bad board' using hint = 'board_big';
    end if;
    if base_rev is distinct from b.rev then  -- someone saved in between: the app puts the two together and tries again
      return json_build_object('conflict', true, 'rev', b.rev, 'board', b.data);
    end if;
    update lelons.boards x set data = lelons_board.data, rev = x.rev + 1, updated_at = now(), updated_by = me.id,
      title = left(coalesce(nullif(btrim(lelons_board.data->>'title'), ''), 'Untitled board'), 120)
    where x.id = b.id returning x.rev into b.rev;
    return json_build_object('rev', b.rev);
  elsif what = 'star' then
    update lelons.board_members m set starred = coalesce((data #>> '{}')::boolean, false) where m.board_id = b.id and m.account_id = me.id;
    return '{}'::json;
  elsif what = 'invite' then
    if b.owner_id <> me.id then
      raise exception 'not yours' using hint = 'denied';
    end if;
    insert into lelons.board_members (board_id, account_id, invited_by)
    select b.id, a.id, me.id from lelons.accounts a
    where lower(a.username) = any (select lower(btrim(u)) from unnest(coalesce(usernames, '{}')) u) and a.id <> me.id
    on conflict on constraint board_members_pkey do nothing;
    if (select count(*) from lelons.board_members m where m.board_id = b.id) > 50 then
      raise exception 'too many people' using hint = 'board_people';
    end if;
    return lelons.board_people(b.id, b.owner_id);
  elsif what in ('remove', 'leave') then
    them := case when what = 'leave' then me.id else
      (select a.id from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(usernames[1], '')))) end;
    if them is null or them = b.owner_id or (b.owner_id <> me.id and them <> me.id) then
      raise exception 'not allowed' using hint = 'denied';
    end if;
    delete from lelons.board_members m where m.board_id = b.id and m.account_id = them;
    return lelons.board_people(b.id, b.owner_id);
  elsif what = 'delete' then
    if b.owner_id <> me.id then
      raise exception 'not yours' using hint = 'denied';
    end if;
    delete from lelons.boards x where x.id = b.id;
    return '{}'::json;
  end if;
  raise exception 'what?' using hint = 'bad_input';
end $$;

-- ---- Film assets (2.15.0): packs of VFX clips (explosions, fire, smoke...) like ActionVFX.
-- The clips themselves are big, so they live in the owner's free Backblaze B2 storage, not here.
-- Here: the list of packs and clips, and the Backblaze keys (only the app can read them, through
-- lelons_fx: everyone logged in gets the key that can only download, owner and admins the one that can upload).
alter table lelons.config add column if not exists fx_storage jsonb;
create table if not exists lelons.fx_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  category text not null check (category in ('explosion', 'fire', 'smoke', 'muzzle', 'sparks', 'debris', 'dust', 'blood',
                                             'lightning', 'water', 'magic', 'lightleak', 'other')),
  about text not null default '' check (length(about) <= 600),
  uploader_id uuid references lelons.accounts (id) on delete set null,
  downloads int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists lelons.fx_clips (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references lelons.fx_packs (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  path text not null check (length(path) <= 300),
  file_id text not null check (length(file_id) <= 300),
  size bigint not null default 0,
  seconds real not null default 0,
  width int not null default 0,
  height int not null default 0,
  preview text check (length(preview) <= 300),
  preview_id text check (length(preview_id) <= 300),
  thumb text check (length(thumb) <= 300),
  thumb_id text check (length(thumb_id) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists fx_clips_pack on lelons.fx_clips (pack_id, created_at);
alter table lelons.fx_packs enable row level security;
alter table lelons.fx_clips enable row level security;
revoke all on lelons.fx_packs, lelons.fx_clips from anon, authenticated;

create or replace function lelons.fx_pack_json(p lelons.fx_packs) returns json
  language sql stable security definer set search_path = '' as
  $$ select json_build_object('id', p.id, 'name', p.name, 'category', p.category, 'about', p.about,
                             'by', (select a.username from lelons.accounts a where a.id = p.uploader_id),
                             'downloads', p.downloads, 'created', extract(epoch from p.created_at),
                             'clips', (select count(*) from lelons.fx_clips c where c.pack_id = p.id),
                             'size', (select coalesce(sum(c.size), 0) from lelons.fx_clips c where c.pack_id = p.id),
                             'width', (select max(c.width) from lelons.fx_clips c where c.pack_id = p.id),
                             'cover', (select json_build_object('thumb', c.thumb, 'preview', c.preview) from lelons.fx_clips c
                                       where c.pack_id = p.id and c.thumb is not null order by c.created_at limit 1)) $$;

-- what: list / pack / setup (owner) / upload_key, add_pack, edit_pack, add_clip, delete_clip, delete_pack (owner, admins) / downloaded
create or replace function public.lelons_fx(token text, what text, pack_id uuid default null, data jsonb default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  can_add boolean := me.role in ('owner', 'admin');
  store jsonb := (select c.fx_storage from lelons.config c where c.id = 1);
  p lelons.fx_packs;
  gone json;
begin
  if what = 'list' then
    return json_build_object(
      'packs', coalesce((select json_agg(lelons.fx_pack_json(x) order by x.created_at desc) from lelons.fx_packs x), '[]'::json),
      'storage', case when store is null then null
                      else json_build_object('bucket', store->>'bucket', 'key_id', store->>'read_id', 'key', store->>'read_key') end,
      'used', case when can_add then (select coalesce(sum(c.size), 0) from lelons.fx_clips c) end,
      'can_add', can_add, 'can_setup', me.role = 'owner');
  elsif what = 'pack' then
    select x.* into p from lelons.fx_packs x where x.id = lelons_fx.pack_id;
    if p.id is null then
      raise exception 'no pack' using hint = 'nopack';
    end if;
    return json_build_object('pack', lelons.fx_pack_json(p), 'mine', can_add,
      'clips', coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'path', c.path, 'size', c.size,
                                                            'seconds', c.seconds, 'width', c.width, 'height', c.height,
                                                            'preview', c.preview, 'thumb', c.thumb) order by c.created_at, c.name)
                         from lelons.fx_clips c where c.pack_id = p.id), '[]'::json));
  elsif what = 'downloaded' then
    update lelons.fx_packs x set downloads = x.downloads + 1 where x.id = lelons_fx.pack_id;
    return '{}'::json;
  end if;

  if what = 'setup' then
    if me.role <> 'owner' then
      raise exception 'owner only' using hint = 'denied';
    end if;
    if jsonb_typeof(data) <> 'object' or coalesce(data->>'bucket', '') = '' or coalesce(data->>'read_key', '') = ''
       or coalesce(data->>'write_key', '') = '' or length(data::text) > 4000 then
      raise exception 'bad storage' using hint = 'bad_input';
    end if;
    update lelons.config set fx_storage = data where id = 1;
    return '{}'::json;
  end if;
  if not can_add then
    raise exception 'admins only' using hint = 'denied';
  end if;
  if what = 'upload_key' then
    if store is null then
      raise exception 'no storage' using hint = 'nostorage';
    end if;
    return json_build_object('bucket', store->>'bucket', 'bucket_id', store->>'bucket_id',
                             'key_id', store->>'write_id', 'key', store->>'write_key');
  elsif what = 'add_pack' then
    insert into lelons.fx_packs (name, category, about, uploader_id)
    values (left(btrim(data->>'name'), 80), data->>'category', left(coalesce(data->>'about', ''), 600), me.id) returning * into p;
    return lelons.fx_pack_json(p);
  elsif what = 'edit_pack' then
    update lelons.fx_packs x set name = left(btrim(data->>'name'), 80), category = data->>'category',
      about = left(coalesce(data->>'about', ''), 600) where x.id = lelons_fx.pack_id returning * into p;
    if p.id is null then
      raise exception 'no pack' using hint = 'nopack';
    end if;
    return lelons.fx_pack_json(p);
  elsif what = 'add_clip' then
    if not exists (select 1 from lelons.fx_packs x where x.id = lelons_fx.pack_id) then
      raise exception 'no pack' using hint = 'nopack';
    end if;
    insert into lelons.fx_clips (pack_id, name, path, file_id, size, seconds, width, height, preview, preview_id, thumb, thumb_id)
    values (lelons_fx.pack_id, left(btrim(data->>'name'), 120), data->>'path', data->>'file_id',
            greatest(0, coalesce((data->>'size')::bigint, 0)), greatest(0, coalesce((data->>'seconds')::real, 0)),
            greatest(0, coalesce((data->>'width')::int, 0)), greatest(0, coalesce((data->>'height')::int, 0)),
            nullif(data->>'preview', ''), nullif(data->>'preview_id', ''), nullif(data->>'thumb', ''), nullif(data->>'thumb_id', ''));
    return '{}'::json;
  elsif what = 'delete_clip' then
    -- The files to delete from Backblaze go back to the app.
    with d as (delete from lelons.fx_clips c where c.id = (data->>'id')::uuid and c.pack_id = lelons_fx.pack_id returning c.*)
    select json_agg(json_build_object('path', f.path, 'id', f.id)) into gone
    from d, lateral (values (d.path, d.file_id), (d.preview, d.preview_id), (d.thumb, d.thumb_id)) f(path, id) where f.id is not null;
    return json_build_object('files', coalesce(gone, '[]'::json));
  elsif what = 'delete_pack' then
    with d as (delete from lelons.fx_clips c where c.pack_id = lelons_fx.pack_id returning c.*)
    select json_agg(json_build_object('path', f.path, 'id', f.id)) into gone
    from d, lateral (values (d.path, d.file_id), (d.preview, d.preview_id), (d.thumb, d.thumb_id)) f(path, id) where f.id is not null;
    delete from lelons.fx_packs x where x.id = lelons_fx.pack_id;
    return json_build_object('files', coalesce(gone, '[]'::json));
  end if;
  raise exception 'what?' using hint = 'bad_input';
end $$;

-- ---- Games (2.16.0): Steam games friends post to maybe record for YouTube (like a Discord channel of links).
-- The app reads the game's picture, price and description from Steam and keeps a copy here.
create table if not exists lelons.games (
  id uuid primary key default gen_random_uuid(),
  app_id int not null unique check (app_id > 0),
  info jsonb not null check (jsonb_typeof(info) = 'object' and length(info::text) <= 20000),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'idea' check (status in ('idea', 'recording', 'done')),
  video text not null default '' check (length(video) <= 300),
  poster_id uuid references lelons.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now()
);
create table if not exists lelons.game_votes (
  game_id uuid not null references lelons.games (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, account_id)
);
create table if not exists lelons.game_comments (
  id bigserial primary key,
  game_id uuid not null references lelons.games (id) on delete cascade,
  account_id uuid references lelons.accounts (id) on delete set null,
  text text not null check (length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists game_comments_game on lelons.game_comments (game_id, id);
-- 2.17.0: when a game went on sale (for the badge on the Games tab), and how big it is on YouTube.
alter table lelons.games add column if not exists sale_at timestamptz;
alter table lelons.games add column if not exists youtube jsonb check (youtube is null or length(youtube::text) <= 8000);
alter table lelons.games add column if not exists youtube_at timestamptz;
-- 2.29.0: who moved a game to Recording or Done, and when (for the Friends page).
alter table lelons.games add column if not exists status_by uuid references lelons.accounts (id) on delete set null;
alter table lelons.games add column if not exists status_at timestamptz;
alter table lelons.games enable row level security;
alter table lelons.game_votes enable row level security;
alter table lelons.game_comments enable row level security;
revoke all on lelons.games, lelons.game_votes, lelons.game_comments from anon, authenticated;

create or replace function lelons.game_json(g lelons.games, me lelons.accounts) returns json
  language sql stable security definer set search_path = '' as
  $$ select json_build_object('id', g.id, 'app_id', g.app_id, 'info', g.info, 'note', g.note, 'status', g.status,
                             'video', g.video, 'created', extract(epoch from g.created_at),
                             'refreshed', extract(epoch from g.refreshed_at),
                             'by', a.username, 'by_avatar', a.avatar,
                             'can_edit', g.poster_id is not distinct from me.id or me.role in ('owner', 'admin'),
                             'voted', exists (select 1 from lelons.game_votes v where v.game_id = g.id and v.account_id = me.id),
                             'voters', coalesce((select json_agg(json_build_object('username', va.username, 'avatar', va.avatar) order by v.created_at)
                                                 from lelons.game_votes v join lelons.accounts va on va.id = v.account_id
                                                 where v.game_id = g.id), '[]'::json),
                             'comments', (select count(*) from lelons.game_comments c where c.game_id = g.id),
                             'sale_at', extract(epoch from g.sale_at), 'youtube', g.youtube,
                             'youtube_at', extract(epoch from g.youtube_at))
     from (select 1) one left join lelons.accounts a on a.id = g.poster_id $$;

-- what: list / add / refresh / youtube / vote / status / note / delete / comments / comment / delete_comment
create or replace function public.lelons_games(token text, what text, game_id uuid default null, data jsonb default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  g lelons.games;
  app int;
  st text;
begin
  if what = 'list' then
    return json_build_object('games', coalesce((select json_agg(lelons.game_json(x, me) order by x.created_at desc)
                                                from lelons.games x), '[]'::json));
  elsif what = 'add' then
    app := (data->>'app_id')::int;
    if app is null or app <= 0 or jsonb_typeof(data->'info') <> 'object' or coalesce(data->'info'->>'name', '') = '' then
      raise exception 'bad game' using hint = 'bad_input';
    end if;
    select x.* into g from lelons.games x where x.app_id = app;
    if g.id is not null then
      return json_build_object('game', lelons.game_json(g, me), 'existed', true);
    end if;
    if (select count(*) from lelons.games) >= 3000 then
      raise exception 'too many games' using hint = 'games_full';
    end if;
    if (select count(*) from lelons.games x where x.poster_id = me.id and x.created_at > now() - interval '1 hour') >= 60 then
      raise exception 'slow down' using hint = 'games_slow';
    end if;
    insert into lelons.games (app_id, info, note, poster_id)
    values (app, data->'info', left(btrim(coalesce(data->>'note', '')), 300), me.id) returning * into g;
    return json_build_object('game', lelons.game_json(g, me), 'existed', false);
  end if;

  select x.* into g from lelons.games x where x.id = lelons_games.game_id;
  if g.id is null then
    raise exception 'no game' using hint = 'nogame';
  end if;
  if what = 'refresh' then  -- a newer price and description from Steam (anyone's app does this when it's old)
    if jsonb_typeof(data->'info') <> 'object' or coalesce(data->'info'->>'name', '') = '' then
      raise exception 'bad game' using hint = 'bad_input';
    end if;
    -- A sale that just started (or a game that just became free) lights up everyone's Games tab.
    update lelons.games x set info = data->'info', refreshed_at = now(),
      sale_at = case
        when coalesce((data->'info'->>'free')::boolean, false) and not coalesce((g.info->>'free')::boolean, false) then now()
        when coalesce((data->'info'->'price'->>'discount')::int, 0) = 0 and not coalesce((data->'info'->>'free')::boolean, false) then null
        when coalesce((data->'info'->'price'->>'discount')::int, 0) > coalesce((g.info->'price'->>'discount')::int, 0) then now()
        else x.sale_at end
    where x.id = g.id returning * into g;
    return lelons.game_json(g, me);
  elsif what = 'youtube' then  -- how videos about the game do on YouTube (looked up by whoever opens it)
    if jsonb_typeof(data->'youtube') <> 'object' then
      raise exception 'bad youtube' using hint = 'bad_input';
    end if;
    update lelons.games x set youtube = data->'youtube', youtube_at = now() where x.id = g.id returning * into g;
    return lelons.game_json(g, me);
  elsif what = 'vote' then
    if coalesce((data->>'on')::boolean, false) then
      insert into lelons.game_votes (game_id, account_id) values (g.id, me.id) on conflict do nothing;
    else
      delete from lelons.game_votes v where v.game_id = g.id and v.account_id = me.id;
    end if;
    return lelons.game_json(g, me);
  elsif what = 'status' then  -- anyone can move a game along (it's a list for friends)
    st := data->>'status';
    if st not in ('idea', 'recording', 'done') then
      raise exception 'bad status' using hint = 'bad_input';
    end if;
    update lelons.games x set status = st, video = left(btrim(coalesce(data->>'video', x.video)), 300),
      status_by = case when st <> x.status then me.id else x.status_by end,
      status_at = case when st <> x.status then now() else x.status_at end
    where x.id = g.id returning * into g;
    return lelons.game_json(g, me);
  elsif what = 'comments' then
    return json_build_object('comments', coalesce((select json_agg(json_build_object('id', c.id, 'text', c.text,
        'by', a.username, 'avatar', a.avatar, 'created', extract(epoch from c.created_at),
        'mine', c.account_id is not distinct from me.id or me.role in ('owner', 'admin')) order by c.id)
      from lelons.game_comments c left join lelons.accounts a on a.id = c.account_id where c.game_id = g.id), '[]'::json));
  elsif what = 'comment' then
    if length(btrim(coalesce(data->>'text', ''))) = 0 then
      raise exception 'empty' using hint = 'bad_input';
    end if;
    insert into lelons.game_comments (game_id, account_id, text) values (g.id, me.id, left(btrim(data->>'text'), 500));
    return '{}'::json;
  elsif what = 'delete_comment' then
    delete from lelons.game_comments c where c.id = (data->>'id')::bigint and c.game_id = g.id
      and (c.account_id = me.id or me.role in ('owner', 'admin'));
    return '{}'::json;
  end if;

  if g.poster_id is distinct from me.id and me.role not in ('owner', 'admin') then
    raise exception 'not yours' using hint = 'denied';
  end if;
  if what = 'note' then
    update lelons.games x set note = left(btrim(coalesce(data->>'note', '')), 300) where x.id = g.id returning * into g;
    return lelons.game_json(g, me);
  elsif what = 'delete' then
    delete from lelons.games x where x.id = g.id;
    return '{}'::json;
  end if;
  raise exception 'what?' using hint = 'bad_input';
end $$;

-- ---- POVs (2.21.0): everyone's own recording of the same game, shared PC to PC.
-- Only the list lives here (names, sizes, a small picture). The videos stay on the PC of whoever
-- recorded them and go straight from their app to a friend's app (WebRTC, like the calls), so any
-- size works for free. The two apps find each other through offers and answers left here.
-- Whoever shares a POV picks how long it stays in the list (or until they remove it).
create table if not exists lelons.pov_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  game text not null default '' check (length(game) <= 80),
  created_by uuid references lelons.accounts (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists lelons.pov_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references lelons.pov_sessions (id) on delete cascade,
  owner_id uuid not null references lelons.accounts (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  size bigint not null check (size > 0),
  seconds real not null default 0,
  width int not null default 0,
  height int not null default 0,
  thumb text not null default '' check (length(thumb) <= 120000),  -- a small jpeg (data: address)
  created_at timestamptz not null default now(),
  expires_at timestamptz  -- gone from the list after this (null: until the owner removes it)
);
create table if not exists lelons.pov_gets (  -- who downloaded a POV all the way
  file_id uuid not null references lelons.pov_files (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (file_id, account_id)
);
create table if not exists lelons.pov_grants (  -- (2.22.1) who the owner (or a friend who has it) agreed to send a POV to
  file_id uuid not null references lelons.pov_files (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  primary key (file_id, account_id)
);
create table if not exists lelons.pov_signals (
  id bigint generated always as identity primary key,
  file_id uuid not null references lelons.pov_files (id) on delete cascade,
  transfer uuid not null,
  from_id uuid not null references lelons.accounts (id) on delete cascade,
  to_id uuid not null references lelons.accounts (id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'no')),
  sdp text not null default '' check (length(sdp) <= 30000),
  created_at timestamptz not null default now()
);
create table if not exists lelons.pov_seen (  -- when each app last looked for friends asking for its POVs
  account_id uuid primary key references lelons.accounts (id) on delete cascade,
  seen_at timestamptz not null default now()
);
create index if not exists pov_files_session on lelons.pov_files (session_id);
create index if not exists pov_signals_to on lelons.pov_signals (to_id, id);
alter table lelons.pov_sessions enable row level security;
alter table lelons.pov_files enable row level security;
alter table lelons.pov_gets enable row level security;
alter table lelons.pov_signals enable row level security;
alter table lelons.pov_grants enable row level security;
alter table lelons.pov_seen enable row level security;
revoke all on lelons.pov_sessions, lelons.pov_files, lelons.pov_gets, lelons.pov_signals, lelons.pov_seen, lelons.pov_grants from anon, authenticated;

create or replace function lelons.pov_file_json(f lelons.pov_files, me lelons.accounts) returns json
  language sql stable security definer set search_path = '' as
  $$ select json_build_object('id', f.id, 'session', f.session_id, 'name', f.name, 'size', f.size, 'seconds', f.seconds,
                             'width', f.width, 'height', f.height, 'thumb', f.thumb,
                             'created', extract(epoch from f.created_at), 'expires', extract(epoch from f.expires_at),
                             'by', a.username, 'by_avatar', a.avatar, 'mine', f.owner_id = me.id,
                             'can_edit', f.owner_id = me.id or me.role in ('owner', 'admin'),
                             'ready', exists (select 1 from lelons.pov_seen s where s.account_id = f.owner_id
                                              and s.seen_at > now() - interval '25 seconds'),
                             'got', coalesce((select json_agg(ga.username order by g.created_at)
                                              from lelons.pov_gets g join lelons.accounts ga on ga.id = g.account_id
                                              where g.file_id = f.id), '[]'::json),
                             -- (2.22.0) friends who downloaded it and can send it on, with their app open now
                             'holders', coalesce((select json_agg(ga.username order by g.created_at)
                                              from lelons.pov_gets g join lelons.accounts ga on ga.id = g.account_id
                                              join lelons.pov_seen s on s.account_id = g.account_id
                                              where g.file_id = f.id and s.seen_at > now() - interval '25 seconds'), '[]'::json))
     from lelons.accounts a where a.id = f.owner_id $$;

-- How long a POV stays: 'hours' 1 to 720 (30 days), or null/0 for until it's removed.
create or replace function lelons.pov_until(data jsonb) returns timestamptz
  language sql stable set search_path = '' as
  $$ select case when coalesce((data->>'hours')::numeric, 0) <= 0 then null
                 else now() + make_interval(mins => (least(720, (data->>'hours')::numeric) * 60)::int) end $$;

-- what:
--   'list'                         the sessions and their POVs
--   'new_session'  data {title, game}
--   'edit_session' id, data {title, game}      (who made it, or admins)
--   'delete_session' id                        (who made it, or admins)
--   'add'          id = session, data {name, size, seconds, width, height, thumb, hours}
--   'timer'        id = POV, data {hours}      (its owner, or admins)
--   'remove'       id = POV                    (its owner, or admins)
--   'got'          id = POV: you downloaded it all
--   'check'        after: say your app is there to send; get the offers and answers for you
--   'signal'       id = POV, data {to, transfer, kind, sdp}
create or replace function public.lelons_pov(token text, what text, id uuid default null, data jsonb default null, after bigint default 0)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  s lelons.pov_sessions;
  f lelons.pov_files;
  target uuid;
begin
  if what = 'check' then
    insert into lelons.pov_seen as x (account_id, seen_at) values (me.id, now())
    on conflict on constraint pov_seen_pkey do update set seen_at = now() where x.seen_at < now() - interval '5 seconds';
    return json_build_object('signals', coalesce((
      select json_agg(json_build_object('id', g.id, 'file', g.file_id, 'transfer', g.transfer, 'from', a.username,
                                        'kind', g.kind, 'sdp', g.sdp, 'age', extract(epoch from now() - g.created_at)) order by g.id)
      from lelons.pov_signals g join lelons.accounts a on a.id = g.from_id
      where g.to_id = me.id and g.id > coalesce(after, 0)), '[]'::json),
      'last', (select max(g.id) from lelons.pov_signals g));
  elsif what = 'list' then
    delete from lelons.pov_files x where x.expires_at < now();
    delete from lelons.pov_sessions x where x.created_at < now() - interval '1 day'
      and not exists (select 1 from lelons.pov_files y where y.session_id = x.id);
    return json_build_object('sessions', coalesce((
      select json_agg(json_build_object('id', x.id, 'title', x.title, 'game', x.game, 'created', extract(epoch from x.created_at),
               'by', (select a.username from lelons.accounts a where a.id = x.created_by),
               'can_edit', x.created_by is not distinct from me.id or me.role in ('owner', 'admin'),
               'files', coalesce((select json_agg(lelons.pov_file_json(y, me) order by y.created_at)
                                  from lelons.pov_files y where y.session_id = x.id), '[]'::json))
             order by greatest(x.created_at, (select max(y.created_at) from lelons.pov_files y where y.session_id = x.id)) desc)
      from lelons.pov_sessions x), '[]'::json));
  elsif what = 'new_session' then
    if length(btrim(coalesce(data->>'title', ''))) = 0 then
      raise exception 'no title' using hint = 'bad_input';
    end if;
    if (select count(*) from lelons.pov_sessions x where x.created_by = me.id and x.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'slow down' using hint = 'pov_slow';
    end if;
    insert into lelons.pov_sessions (title, game, created_by)
    values (left(btrim(data->>'title'), 120), left(btrim(coalesce(data->>'game', '')), 80), me.id) returning * into s;
    return json_build_object('session', s.id);
  elsif what in ('edit_session', 'delete_session', 'add') then
    select x.* into s from lelons.pov_sessions x where x.id = lelons_pov.id;
    if s.id is null then
      raise exception 'no session' using hint = 'pov_gone';
    end if;
    if what = 'add' then
      if coalesce((data->>'size')::bigint, 0) <= 0 or length(btrim(coalesce(data->>'name', ''))) = 0 then
        raise exception 'bad pov' using hint = 'bad_input';
      end if;
      if (select count(*) from lelons.pov_files y where y.session_id = s.id) >= 24 then
        raise exception 'session full' using hint = 'pov_full';
      end if;
      insert into lelons.pov_files (session_id, owner_id, name, size, seconds, width, height, thumb, expires_at)
      values (s.id, me.id, left(btrim(data->>'name'), 200), (data->>'size')::bigint, coalesce((data->>'seconds')::real, 0),
              coalesce((data->>'width')::int, 0), coalesce((data->>'height')::int, 0),
              case when left(coalesce(data->>'thumb', ''), 23) = 'data:image/jpeg;base64,' then left(data->>'thumb', 120000) else '' end,
              lelons.pov_until(data))
      returning * into f;
      return json_build_object('file', lelons.pov_file_json(f, me));
    end if;
    if s.created_by is distinct from me.id and me.role not in ('owner', 'admin') then
      raise exception 'not yours' using hint = 'denied';
    end if;
    -- (2.22.1) Deleting a session doesn't take a friend's POV in it along.
    if what = 'delete_session' and me.role not in ('owner', 'admin')
       and exists (select 1 from lelons.pov_files y where y.session_id = s.id and y.owner_id <> me.id) then
      raise exception 'not empty' using hint = 'denied';
    end if;
    if what = 'edit_session' then
      update lelons.pov_sessions x set title = coalesce(nullif(left(btrim(coalesce(data->>'title', '')), 120), ''), x.title),
        game = left(btrim(coalesce(data->>'game', x.game)), 80) where x.id = s.id;
    else
      delete from lelons.pov_sessions x where x.id = s.id;
    end if;
    return '{}'::json;
  end if;

  select x.* into f from lelons.pov_files x where x.id = lelons_pov.id and (x.expires_at is null or x.expires_at > now());
  if f.id is null then
    raise exception 'no pov' using hint = 'pov_gone';
  end if;
  if what = 'got' then
    -- (2.22.1) Only someone who was really sent it (the owner or a friend who has it said yes) counts as having it.
    if not exists (select 1 from lelons.pov_grants g where g.file_id = f.id and g.account_id = me.id) then
      raise exception 'not sent' using hint = 'denied';
    end if;
    insert into lelons.pov_gets (file_id, account_id) values (f.id, me.id) on conflict do nothing;
    return '{}'::json;
  elsif what = 'signal' then
    if data->>'kind' not in ('offer', 'answer', 'no') or length(coalesce(data->>'sdp', '')) > 30000
       or (data->>'kind' <> 'no' and length(coalesce(data->>'sdp', '')) < 10) then
      raise exception 'bad signal' using hint = 'bad_input';
    end if;
    select a.id into target from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(data->>'to', '')));
    -- Offers go to the POV's owner or a friend who downloaded it (2.22.0: they send it on);
    -- answers (or "no") come from them.
    if target is null or target = me.id
       or (data->>'kind' = 'offer' and target <> f.owner_id
           and not exists (select 1 from lelons.pov_gets g where g.file_id = f.id and g.account_id = target))
       or (data->>'kind' <> 'offer' and me.id <> f.owner_id
           and not exists (select 1 from lelons.pov_gets g where g.file_id = f.id and g.account_id = me.id)) then
      raise exception 'bad signal' using hint = 'bad_input';
    end if;
    if (select count(*) from lelons.pov_signals g where g.from_id = me.id and g.created_at > now() - interval '1 minute') >= 40 then
      raise exception 'slow down' using hint = 'pov_slow';
    end if;
    insert into lelons.pov_signals (file_id, transfer, from_id, to_id, kind, sdp)
    values (f.id, (data->>'transfer')::uuid, me.id, target, data->>'kind', coalesce(data->>'sdp', ''));
    if data->>'kind' = 'answer' then
      insert into lelons.pov_grants (file_id, account_id) values (f.id, target) on conflict do nothing;
    end if;
    delete from lelons.pov_signals g where g.created_at < now() - interval '3 minutes';
    return '{}'::json;
  end if;

  if f.owner_id <> me.id and me.role not in ('owner', 'admin') then
    raise exception 'not yours' using hint = 'denied';
  end if;
  if what = 'timer' then
    update lelons.pov_files x set expires_at = lelons.pov_until(data) where x.id = f.id returning * into f;
    return json_build_object('file', lelons.pov_file_json(f, me));
  elsif what = 'remove' then
    delete from lelons.pov_files x where x.id = f.id;
    return '{}'::json;
  end if;
  raise exception 'what?' using hint = 'bad_input';
end $$;

-- ---- The Friends page (2.29.0): what everyone made, shared and did lately, newest first.
-- Sounds, POVs, games (posted, voted, started recording, done, talked about), team board changes
-- (only boards you're on) and new people. The parts someone hid on their profile stay out.
-- Also everyone's YouTube channel, so the app can add their newest uploads.
create or replace function public.lelons_feed(token text, days int default 7)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(lelons_feed.days, 7), 14)));
begin
  return json_build_object(
    'me', me.username,
    'items', coalesce((select json_agg(x.item order by x.at desc) from (
      (select s.created_at as at, json_build_object('kind', 'sound', 'at', extract(epoch from s.created_at), 'id', s.id,
                'name', s.name, 'category', s.category, 'genre', s.genre, 'path', s.path, 'seconds', s.seconds,
                'username', coalesce(a.username, s.uploader), 'avatar', a.avatar, 'me', s.uploader_id is not distinct from me.id) as item
       from lelons.sounds s left join lelons.accounts a on a.id = s.uploader_id
       where s.created_at > since and not ('sounds' = any (coalesce(a.hide, '{}')))
       order by s.created_at desc limit 80)
      union all
      (select f.created_at, json_build_object('kind', 'pov', 'at', extract(epoch from f.created_at), 'id', f.id,
                'session', x.id, 'title', x.title, 'game', x.game, 'name', f.name, 'seconds', f.seconds, 'thumb', f.thumb,
                'username', a.username, 'avatar', a.avatar, 'me', f.owner_id = me.id)
       from lelons.pov_files f join lelons.pov_sessions x on x.id = f.session_id join lelons.accounts a on a.id = f.owner_id
       where f.created_at > since and (f.expires_at is null or f.expires_at > now()) and not ('povs' = any (coalesce(a.hide, '{}')))
       order by f.created_at desc limit 30)
      union all
      (select g.created_at, json_build_object('kind', 'game', 'what', 'posted', 'at', extract(epoch from g.created_at), 'id', g.id,
                'name', g.info->>'name', 'header', g.info->>'header', 'status', g.status,
                'username', a.username, 'avatar', a.avatar, 'me', g.poster_id = me.id)
       from lelons.games g join lelons.accounts a on a.id = g.poster_id
       where g.created_at > since and not ('games' = any (coalesce(a.hide, '{}')))
       order by g.created_at desc limit 40)
      union all
      (select g.status_at, json_build_object('kind', 'game', 'what', g.status, 'at', extract(epoch from g.status_at), 'id', g.id,
                'name', g.info->>'name', 'header', g.info->>'header', 'status', g.status, 'video', g.video,
                'username', a.username, 'avatar', a.avatar, 'me', g.status_by = me.id)
       from lelons.games g join lelons.accounts a on a.id = g.status_by
       where g.status_at > since and g.status in ('recording', 'done') and not ('games' = any (coalesce(a.hide, '{}')))
       order by g.status_at desc limit 40)
      union all
      (select v.created_at, json_build_object('kind', 'game', 'what', 'voted', 'at', extract(epoch from v.created_at), 'id', g.id,
                'name', g.info->>'name', 'header', g.info->>'header', 'status', g.status,
                'username', a.username, 'avatar', a.avatar, 'me', v.account_id = me.id)
       from lelons.game_votes v join lelons.games g on g.id = v.game_id join lelons.accounts a on a.id = v.account_id
       where v.created_at > since and v.account_id is distinct from g.poster_id and not ('games' = any (coalesce(a.hide, '{}')))
       order by v.created_at desc limit 40)
      union all
      (select c.created_at, json_build_object('kind', 'game', 'what', 'comment', 'at', extract(epoch from c.created_at), 'id', g.id,
                'name', g.info->>'name', 'header', g.info->>'header', 'status', g.status, 'text', left(c.text, 140),
                'username', a.username, 'avatar', a.avatar, 'me', c.account_id = me.id)
       from lelons.game_comments c join lelons.games g on g.id = c.game_id join lelons.accounts a on a.id = c.account_id
       where c.created_at > since
       order by c.created_at desc limit 40)
      union all
      (select to_timestamp(l.at / 1000), json_build_object('kind', 'board', 'at', l.at / 1000, 'id', l.board_id, 'title', l.title,
                'bg', l.bg, 'text', left(l.text, 200), 'username', coalesce(a.username, l.who), 'avatar', a.avatar,
                'me', lower(coalesce(l.who, '')) = lower(me.username))
       from (select b.id as board_id, b.title, coalesce(b.data->>'bg', 'blue') as bg, e->>'who' as who, e->>'text' as text,
                    (e->>'at')::numeric as at
             from lelons.boards b
             join lelons.board_members m on m.board_id = b.id and m.account_id = me.id and m.joined
             cross join lateral jsonb_array_elements(case when jsonb_typeof(b.data->'log') = 'array' then b.data->'log' else '[]'::jsonb end) e
             where b.updated_at > since and jsonb_typeof(e->'at') = 'number' and jsonb_typeof(e->'text') = 'string') l
       left join lelons.accounts a on lower(a.username) = lower(l.who)
       where l.at > extract(epoch from since) * 1000 and l.at < extract(epoch from now() + interval '1 day') * 1000
       order by l.at desc limit 80)
      union all
      (select a.created_at, json_build_object('kind', 'joined', 'at', extract(epoch from a.created_at),
                'username', a.username, 'avatar', a.avatar, 'me', a.id = me.id)
       from lelons.accounts a where a.created_at > since order by a.created_at desc limit 10)
    ) x), '[]'::json),
    'channels', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'youtube', a.youtube,
                                                            'me', a.id = me.id))
                          from lelons.accounts a
                          where coalesce(a.youtube, '') <> '' and not ('videos' = any (coalesce(a.hide, '{}')))), '[]'::json));
end $$;

grant execute on function lelons.ticket_ok(text, text), lelons.listed(text), lelons.hash(text) to anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['lelons_signup(text, text, text, text, text)', 'lelons_invites(text, text, text, int, int)', 'lelons_devices(text, text, uuid)', 'lelons_login(text, text, text, text)', 'lelons_logout(text)',
    'lelons_me(text)', 'lelons_password(text, text, text)', 'lelons_list(text)', 'lelons_ticket(text, text)',
    'lelons_add(text, text, text, text, real, int, text, text, jsonb)', 'lelons_claim_check(text, uuid)', 'lelons_set_peaks(text, text, jsonb)', 'lelons_sound_check(text, text, text)', 'lelons_set_copyright(text, uuid, jsonb)', 'lelons_set_avatar(text, text)', 'lelons_delete(text, uuid)',
    'lelons_accounts(text)', 'lelons_set_role(text, uuid, text)', 'lelons_remove_account(text, uuid)',
    'lelons_rename(text, text)', 'lelons_delete_me(text, text)', 'lelons_favorite(text, uuid, boolean)',
    'lelons_feedback_send(text, text, text, text)', 'lelons_feedback_list(text)',
    'lelons_feedback_set(text, uuid, boolean, boolean)', 'lelons_ping(text, text)', 'lelons_bye(text)',
    'lelons_chat_send(text, text, text, uuid, text, text, real, bigint, bigint, boolean, jsonb, text, text, jsonb)',
    'lelons_chat_list(text, bigint, text, bigint)', 'lelons_chat_thread(text, bigint)', 'lelons_chat_search(text, text, text)',
    'lelons_chat_pins(text, text)', 'lelons_chat_pin(text, bigint, boolean)', 'lelons_chat_edit(text, bigint, text)',
    'lelons_chat_poll(text, bigint, text, int[])', 'lelons_set_mode(text, text, text)', 'lelons_chat_remove(text, bigint)',
    'lelons_chat_delete(text, bigint)', 'lelons_chat_react(text, bigint, text, boolean)', 'lelons_profile(text, text)',
    'lelons_set_profile(text, jsonb)', 'lelons_set_banner(text, text)',
    'lelons_home(text)', 'lelons_set_channels(text, text[])',
    'lelons_edit_sound(text, uuid, text, text, text)', 'lelons_channel_log(text, text, bigint, int)',
    'lelons_channel_history(text, int)', 'lelons_chat_typing(text, text, boolean)',
    'lelons_chat_live(text, text, bigint)', 'lelons_docs(text)', 'lelons_doc_people(text)',
    'lelons_doc_create(text, text, text, jsonb, jsonb)', 'lelons_doc_open(text, uuid)',
    'lelons_doc_sync(text, uuid, bigint, jsonb, text, text, boolean, jsonb)', 'lelons_doc_close(text, uuid)',
    'lelons_doc_invite(text, uuid, text[])', 'lelons_doc_answer(text, uuid, boolean)',
    'lelons_doc_remove(text, uuid, text)', 'lelons_doc_delete(text, uuid)', 'lelons_doc_comments(text, uuid)',
    'lelons_doc_comment(text, uuid, text, bigint, text, text, text)',
    'lelons_chat_group(text, text, uuid, text, text[], text)', 'lelons_playlists(text)',
    'lelons_playlist(text, text, uuid, text, uuid, text[])', 'lelons_room(text, text, uuid, text, text, text, text, bigint)',
    'lelons_board(text, text, uuid, jsonb, bigint, text[])', 'lelons_fx(text, text, uuid, jsonb)',
    'lelons_games(text, text, uuid, jsonb)', 'lelons_pov(text, text, uuid, jsonb, bigint)', 'lelons_feed(text, int)', 'lelons_live_channels(text)'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- The files: anyone with a link can play them (the links can't be guessed);
-- only the app, with a ticket, can add or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lelons-sounds', 'lelons-sounds', true, 10485760, array['audio/mpeg', 'image/jpeg', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lelons add file" on storage.objects;
drop policy if exists "lelons see file" on storage.objects;
drop policy if exists "lelons delete file" on storage.objects;
create policy "lelons add file" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'lelons-sounds' and lelons.ticket_ok(name, 'upload'));
create policy "lelons see file" on storage.objects for select to anon, authenticated
  using (bucket_id = 'lelons-sounds' and (lelons.ticket_ok(name, 'upload') or lelons.ticket_ok(name, 'delete')));
create policy "lelons delete file" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'lelons-sounds' and not lelons.listed(name)
         and (lelons.ticket_ok(name, 'delete') or lelons.ticket_ok(name, 'upload')));  -- (an upload that didn't finish)

select 'All set! Open the Library tab in the app and log in.' as done;
