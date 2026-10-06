-- Ultimate Recording (was Lelons Converter): the shared Library (accounts, roles and sounds).
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

create table if not exists lelons.chat_reactions (
  message_id bigint not null references lelons.chat (id) on delete cascade,
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '😂', '🔥', '❤️', '😮', '😢')),
  primary key (message_id, account_id, emoji)
);

alter table lelons.accounts add column if not exists last_seen timestamptz;

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

create or replace function lelons.new_session(account uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from lelons.sessions where last_used < now() - interval '90 days';
  insert into lelons.sessions (token_hash, account_id) values (lelons.hash(token), account);
  return token;
end $$;

create or replace function lelons.ticket_ok(file text, wanted text) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from lelons.tickets where path = file and kind = wanted and expires_at > now()) $$;

-- True while a file is used (a sound, or someone's picture): then it can't be deleted.
create or replace function lelons.listed(file text) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from lelons.sounds where path = file)
         or exists (select 1 from lelons.accounts where avatar = file)
         or exists (select 1 from lelons.chat c where c.file = listed.file) $$;

create or replace function lelons.delete_ticket(file text) returns void
  language sql security definer set search_path = '' as
  $$ insert into lelons.tickets (path, kind) values (file, 'delete')
     on conflict (path) do update set kind = 'delete', expires_at = now() + interval '15 minutes' $$;

grant usage on schema lelons to anon, authenticated;
grant execute on function lelons.ticket_ok(text, text), lelons.listed(text), lelons.hash(text) to anon, authenticated;

-- ---- what the app calls

create or replace function public.lelons_signup(username text, password text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  name text := btrim(coalesce(username, ''));
  made lelons.accounts;
begin
  if name !~ '^[A-Za-z0-9_.-]{3,20}$' then
    return json_build_object('ok', false, 'error', 'username');
  end if;
  if length(coalesce(password, '')) < 6 then
    return json_build_object('ok', false, 'error', 'password');
  end if;
  if exists (select 1 from lelons.accounts a where lower(a.username) = lower(name)) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;
  if (select count(*) from lelons.accounts) >= 500 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into lelons.accounts (username, pass_hash, role)
  values (name, extensions.crypt(password, extensions.gen_salt('bf', 10)),
          case when lower(name) = (select owner_username from lelons.config) then 'owner' else 'viewer' end)
  returning * into made;
  return json_build_object('ok', true, 'token', lelons.new_session(made.id), 'account', lelons.account_json(made));
end $$;

create or replace function public.lelons_login(username text, password text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  found lelons.accounts;
begin
  select * into found from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(lelons_login.username, '')));
  if found.id is null then
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  if found.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked');
  end if;
  if extensions.crypt(coalesce(password, ''), found.pass_hash) <> found.pass_hash then
    -- Five wrong passwords in a row: wait two minutes.
    update lelons.accounts set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '2 minutes' else locked_until end
    where id = found.id;
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  update lelons.accounts set failed = 0, locked_until = null,
    role = case when lower(accounts.username) = (select c.owner_username from lelons.config c) then 'owner' else accounts.role end
  where id = found.id returning * into found;
  return json_build_object('ok', true, 'token', lelons.new_session(found.id), 'account', lelons.account_json(found));
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
  if length(coalesce(new_password, '')) < 6 then
    return json_build_object('ok', false, 'error', 'password');
  end if;
  update lelons.accounts set pass_hash = extensions.crypt(new_password, extensions.gen_salt('bf', 10)) where id = me.id;
  -- Logged out everywhere else.
  delete from lelons.sessions where account_id = me.id and token_hash <> lelons.hash(token);
  return json_build_object('ok', true);
end $$;

drop function if exists public.lelons_list(text);  -- (it gained columns: favorite, copyright)
create or replace function public.lelons_list(token text)
returns table (id uuid, name text, category text, path text, seconds real, bytes int,
               uploader text, uploader_avatar text, created_at timestamptz, mine boolean, favorite boolean,
               copyright jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return query select s.id, s.name, s.category, s.path, s.seconds, s.bytes,
                      coalesce(a.username, s.uploader), a.avatar, s.created_at, s.uploader_id is not distinct from me.id,
                      exists (select 1 from lelons.favorites f where f.account_id = me.id and f.sound_id = s.id),
                      s.copyright
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
    'people', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'role', a.role)
                                        order by lower(a.username))
                        from lelons.accounts a where a.id in (select p.account_id from lelons.presence p
                                                              where p.seen_at > now() - interval '150 seconds')), '[]'::json))
$$;

-- (1.20.0's versions, before private messages, sounds and reactions)
drop function if exists public.lelons_chat_send(text, text);
drop function if exists public.lelons_chat_list(text, bigint);
drop function if exists public.lelons_chat_delete(text, bigint);

-- Who a chat message can be seen by: everyone (to_id empty), or the two people in a private chat.
create or replace function lelons.chat_sees(c lelons.chat, me uuid) returns boolean
  language sql stable set search_path = '' as
  $$ select c.to_id is null or c.to_id = me or c.account_id = me $$;

-- Send a chat message (everyone with an account can chat). to_user: a private message to them.
-- sound: a Library sound to share; file: a clip uploaded with a 'chat' ticket.
create or replace function public.lelons_chat_send(token text, message text, to_user text default null,
                                                   sound uuid default null, file text default null,
                                                   file_name text default null, file_seconds real default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  text_in text := btrim(coalesce(message, ''));
  target uuid;
begin
  if length(text_in) < 1 and sound is null and file is null then
    return json_build_object('ok', false, 'error', 'short');
  end if;
  if length(text_in) > 500 then
    return json_build_object('ok', false, 'error', 'long');
  end if;
  if to_user is not null then
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
  if (select count(*) from lelons.chat c where c.account_id = me.id and c.created_at > now() - interval '10 seconds') >= 5 then
    return json_build_object('ok', false, 'error', 'slow');
  end if;
  if (select count(*) from lelons.chat c where c.account_id = me.id and c.created_at > now() - interval '1 day') >= 1000 then
    return json_build_object('ok', false, 'error', 'daily');
  end if;
  if file is not null and (select count(*) from lelons.chat c where c.account_id = me.id and c.file is not null
                           and c.created_at > now() - interval '1 day') >= 50 then
    return json_build_object('ok', false, 'error', 'daily');
  end if;
  insert into lelons.chat (account_id, message, to_id, sound_id, file, file_name, file_seconds)
  values (me.id, text_in, target, sound, file,
          left(btrim(coalesce((select s.name from lelons.sounds s where s.id = sound), file_name, '')), 120), file_seconds);
  delete from lelons.tickets t where t.path = file;
  -- Only the newest 5000 messages are kept.
  delete from lelons.chat c where c.id < (select min(x.id) from (select id from lelons.chat order by id desc limit 5000) x);
  return json_build_object('ok', true);
end $$;

-- One conversation (the chat with everyone, or the private chat with with_user): messages newer than
-- "after" (0: the newest 100) oldest first, the reactions and ids of the newest 150 (so changes and
-- deletes show up), your private chats, and who's online.
create or replace function public.lelons_chat_list(token text, after bigint, with_user text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid;
begin
  if with_user is not null then
    select a.id into peer from lelons.accounts a where lower(a.username) = lower(btrim(with_user));
    if peer is null then
      raise exception 'nobody' using hint = 'nobody';
    end if;
  end if;
  return json_build_object(
    'online', lelons.online_json(),
    'messages', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'message', m.message, 'created_at', m.created_at, 'username', a.username,
        'avatar', a.avatar, 'role', a.role, 'mine', m.account_id = me.id,
        'sound', case when s.id is null then null else json_build_object('id', s.id, 'name', s.name,
                 'category', s.category, 'path', s.path, 'seconds', s.seconds) end,
        'shared_gone', m.sound_id is null and m.file is null and m.file_name is not null and m.file_name <> '',
        'file', m.file, 'file_name', m.file_name, 'file_seconds', m.file_seconds) order by m.id)
      from (select * from lelons.chat c
            where c.id > coalesce(after, 0)
              and (case when peer is null then c.to_id is null
                        else (c.account_id = me.id and c.to_id = peer) or (c.account_id = peer and c.to_id = me.id) end)
            order by c.id desc limit 100) m
      join lelons.accounts a on a.id = m.account_id
      left join lelons.sounds s on s.id = m.sound_id), '[]'::json),
    'recent', coalesce((
      select json_agg(json_build_object('id', r.id, 'reactions', (
        select json_agg(json_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine, 'who', x.who))
        from (select cr.emoji, count(*) n, bool_or(cr.account_id = me.id) mine,
                     string_agg(ra.username, ', ' order by lower(ra.username)) who
              from lelons.chat_reactions cr join lelons.accounts ra on ra.id = cr.account_id
              where cr.message_id = r.id group by cr.emoji order by min(cr.emoji)) x)))
      from (select c.id from lelons.chat c
            where (case when peer is null then c.to_id is null
                        else (c.account_id = me.id and c.to_id = peer) or (c.account_id = peer and c.to_id = me.id) end)
            order by c.id desc limit 150) r), '[]'::json),
    'private', coalesce((
      select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'role', a.role,
                                        'last_id', p.id, 'last_message', p.message, 'last_mine', p.account_id = me.id,
                                        'created_at', p.created_at) order by p.id desc)
      from (select distinct on (case when c.account_id = me.id then c.to_id else c.account_id end)
                   c.*, case when c.account_id = me.id then c.to_id else c.account_id end as other
            from lelons.chat c where c.to_id is not null and (c.account_id = me.id or c.to_id = me.id)
            order by case when c.account_id = me.id then c.to_id else c.account_id end, c.id desc) p
      join lelons.accounts a on a.id = p.other), '[]'::json),
    'everyone_last', (select max(c.id) from lelons.chat c where c.to_id is null),
    'names', coalesce((select json_agg(a.username order by lower(a.username)) from lelons.accounts a), '[]'::json));
end $$;

-- React to a message (on = false takes it back).
create or replace function public.lelons_chat_react(token text, message_id bigint, emoji text, on_off boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if not exists (select 1 from lelons.chat c where c.id = message_id and lelons.chat_sees(c, me.id)) then
    return;
  end if;
  if on_off then
    insert into lelons.chat_reactions (message_id, account_id, emoji) values (message_id, me.id, emoji)
    on conflict do nothing;
  else
    delete from lelons.chat_reactions r where r.message_id = lelons_chat_react.message_id
      and r.account_id = me.id and r.emoji = lelons_chat_react.emoji;
  end if;
end $$;

-- Delete a message: your own, or anyone's in the chat with everyone if you're the owner or an admin.
-- Returns its clip's file (for the app to delete), or null.
create or replace function public.lelons_chat_delete(token text, message_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  gone text;
begin
  delete from lelons.chat c where c.id = message_id
    and (c.account_id = me.id or (c.to_id is null and me.role in ('owner', 'admin')))
  returning c.file into gone;
  if gone is not null then
    perform lelons.delete_ticket(gone);
  end if;
  return gone;
end $$;

-- Someone's profile: picture, role, when they joined and were last online, and their newest sounds.
create or replace function public.lelons_profile(token text, username text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  them lelons.accounts;
begin
  select a.* into them from lelons.accounts a where lower(a.username) = lower(btrim(coalesce(lelons_profile.username, '')));
  if them.id is null then
    raise exception 'nobody' using hint = 'nobody';
  end if;
  return json_build_object(
    'username', them.username, 'avatar', them.avatar, 'role', them.role, 'created_at', them.created_at,
    'last_seen', them.last_seen, 'me', them.id = me.id,
    'online', exists (select 1 from lelons.presence p where p.account_id = them.id and p.seen_at > now() - interval '150 seconds'),
    'sounds', (select count(*) from lelons.sounds s where s.uploader_id = them.id),
    'messages', (select count(*) from lelons.chat c where c.account_id = them.id and c.to_id is null),
    'recent', coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'category', s.category,
                                                          'path', s.path, 'seconds', s.seconds, 'created_at', s.created_at)
                                        order by s.created_at desc)
                        from (select * from lelons.sounds s where s.uploader_id = them.id order by s.created_at desc limit 6) s),
                       '[]'::json));
end $$;

-- Star or unstar a sound, just for you.
-- The song check's answer for a sound. Any app that checked it may fill it in once; the owner
-- and admins may also check again.
create or replace function public.lelons_set_copyright(token text, sound_id uuid, result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  if jsonb_typeof(result) is distinct from 'object' or length(result::text) > 2000 then
    raise exception 'bad result' using hint = 'bad_input';
  end if;
  update lelons.sounds s set copyright = result
  where s.id = lelons_set_copyright.sound_id and (s.copyright is null or me.role in ('owner', 'admin'));
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
  if kind not in ('sound', 'avatar', 'chat') then
    raise exception 'bad kind';
  end if;
  delete from lelons.tickets where expires_at < now();
  if (select count(*) from lelons.tickets t where t.account_id = me.id) >= 20 then
    raise exception 'too many uploads at once' using hint = 'daily';
  end if;
  file := case when kind = 'sound' then 'sounds/' || gen_random_uuid() || '.mp3'
               when kind = 'chat' then 'chat/' || gen_random_uuid() || '.mp3'
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
create or replace function public.lelons_add(token text, sound_name text, sound_category text,
                                             file text, sound_seconds real, sound_bytes int, sound_hash text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  new_id uuid;
  clash text;
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
  insert into lelons.sounds (name, category, path, seconds, bytes, uploader, uploader_id, source_hash)
  values (btrim(sound_name), sound_category, file, sound_seconds, sound_bytes, me.username, me.id, sound_hash)
  returning sounds.id into new_id;
  delete from lelons.tickets where path = file;
  return new_id;
end $$;

-- Change a sound's name or category (1.24.0): the one who uploaded it, or an owner or admin.
create or replace function public.lelons_edit_sound(token text, sound_id uuid, sound_name text, sound_category text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  found lelons.sounds;
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
  update lelons.sounds s set name = btrim(sound_name), category = sound_category where s.id = sound_id;
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
begin
  if me.role = 'owner' then
    return json_build_object('ok', false, 'error', 'owner');
  end if;
  if extensions.crypt(coalesce(password, ''), me.pass_hash) <> me.pass_hash then
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  delete from lelons.accounts a where a.id = me.id;
  if me.avatar is not null then
    perform lelons.delete_ticket(me.avatar);
  end if;
  return json_build_object('ok', true, 'avatar', me.avatar);
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
      select json_agg(json_build_object('id', m.id, 'message', m.message, 'created_at', m.created_at,
                                        'username', a.username, 'avatar', a.avatar,
                                        'sound_name', s.name, 'file_name', m.file_name) order by m.id)
      from (select * from lelons.chat c where c.to_id is null order by c.id desc limit 3) m
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

create or replace function lelons.peer_of(with_user text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  peer uuid;
begin
  if with_user is null then
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
  key uuid := coalesce(lelons.peer_of(with_user), '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if stop then
    delete from lelons.chat_typing t where t.account_id = me.id and t.to_key = key;
  else
    insert into lelons.chat_typing as t (account_id, to_key, at) values (me.id, key, now())
    on conflict (account_id, to_key) do update set at = now();
  end if;
end $$;

-- While a chat is open: say how far you've read (seen_id), and get who's typing and who has seen what.
create or replace function public.lelons_chat_live(token text, with_user text default null, seen_id bigint default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  peer uuid := lelons.peer_of(with_user);
  zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if seen_id is not null then
    insert into lelons.chat_seen as x (account_id, peer_key, last_id) values (me.id, coalesce(peer, zero), seen_id)
    on conflict (account_id, peer_key) do update set last_id = greatest(x.last_id, excluded.last_id), seen_at = now();
  end if;
  return json_build_object(
    'typing', coalesce((select json_agg(a.username order by lower(a.username))
                        from lelons.chat_typing t join lelons.accounts a on a.id = t.account_id
                        where t.at > now() - interval '6 seconds' and t.account_id <> me.id
                          and (case when peer is null then t.to_key = zero else t.account_id = peer and t.to_key = me.id end)),
                       '[]'::json),
    'seen', coalesce((select json_agg(json_build_object('username', a.username, 'avatar', a.avatar, 'last_id', x.last_id)
                                      order by x.seen_at desc)
                      from lelons.chat_seen x join lelons.accounts a on a.id = x.account_id
                      where x.account_id <> me.id and x.seen_at > now() - interval '30 days'
                        and (case when peer is null then x.peer_key = zero else x.account_id = peer and x.peer_key = me.id end)),
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

revoke execute on all functions in schema lelons from public;
grant execute on function lelons.ticket_ok(text, text), lelons.listed(text), lelons.hash(text) to anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['lelons_signup(text, text)', 'lelons_login(text, text)', 'lelons_logout(text)',
    'lelons_me(text)', 'lelons_password(text, text, text)', 'lelons_list(text)', 'lelons_ticket(text, text)',
    'lelons_add(text, text, text, text, real, int, text)', 'lelons_sound_check(text, text, text)', 'lelons_set_copyright(text, uuid, jsonb)', 'lelons_set_avatar(text, text)', 'lelons_delete(text, uuid)',
    'lelons_accounts(text)', 'lelons_set_role(text, uuid, text)', 'lelons_remove_account(text, uuid)',
    'lelons_rename(text, text)', 'lelons_delete_me(text, text)', 'lelons_favorite(text, uuid, boolean)',
    'lelons_feedback_send(text, text, text, text)', 'lelons_feedback_list(text)',
    'lelons_feedback_set(text, uuid, boolean, boolean)', 'lelons_ping(text, text)', 'lelons_bye(text)',
    'lelons_chat_send(text, text, text, uuid, text, text, real)', 'lelons_chat_list(text, bigint, text)',
    'lelons_chat_delete(text, bigint)', 'lelons_chat_react(text, bigint, text, boolean)', 'lelons_profile(text, text)',
    'lelons_home(text)', 'lelons_set_channels(text, text[])',
    'lelons_edit_sound(text, uuid, text, text)', 'lelons_channel_log(text, text, bigint, int)',
    'lelons_channel_history(text, int)', 'lelons_chat_typing(text, text, boolean)',
    'lelons_chat_live(text, text, bigint)', 'lelons_docs(text)', 'lelons_doc_people(text)',
    'lelons_doc_create(text, text, text, jsonb, jsonb)', 'lelons_doc_open(text, uuid)',
    'lelons_doc_sync(text, uuid, bigint, jsonb, text, text, boolean, jsonb)', 'lelons_doc_close(text, uuid)',
    'lelons_doc_invite(text, uuid, text[])', 'lelons_doc_answer(text, uuid, boolean)',
    'lelons_doc_remove(text, uuid, text)', 'lelons_doc_delete(text, uuid)', 'lelons_doc_comments(text, uuid)',
    'lelons_doc_comment(text, uuid, text, bigint, text, text, text)'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- The files: anyone with a link can play them (the links can't be guessed);
-- only the app, with a ticket, can add or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lelons-sounds', 'lelons-sounds', true, 10485760, array['audio/mpeg', 'image/jpeg'])
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
