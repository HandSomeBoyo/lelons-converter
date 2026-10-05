-- Lelons Converter: the shared Library (accounts, roles and sounds).
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

-- Everyone's starred sounds.
create table if not exists lelons.favorites (
  account_id uuid not null references lelons.accounts (id) on delete cascade,
  sound_id uuid not null references lelons.sounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, sound_id)
);

alter table lelons.config enable row level security;
alter table lelons.accounts enable row level security;
alter table lelons.sessions enable row level security;
alter table lelons.tickets enable row level security;
alter table lelons.sounds enable row level security;
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
                             'sounds', (select count(*) from lelons.sounds s where s.uploader_id = a.id)) $$;

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
         or exists (select 1 from lelons.accounts where avatar = file) $$;

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

drop function if exists public.lelons_list(text);  -- (it gained a column: favorite)
create or replace function public.lelons_list(token text)
returns table (id uuid, name text, category text, path text, seconds real, bytes int,
               uploader text, uploader_avatar text, created_at timestamptz, mine boolean, favorite boolean)
language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
begin
  return query select s.id, s.name, s.category, s.path, s.seconds, s.bytes,
                      coalesce(a.username, s.uploader), a.avatar, s.created_at, s.uploader_id is not distinct from me.id,
                      exists (select 1 from lelons.favorites f where f.account_id = me.id and f.sound_id = s.id)
               from lelons.sounds s left join lelons.accounts a on a.id = s.uploader_id
               order by s.created_at desc limit 5000;
end $$;

-- Star or unstar a sound, just for you.
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
  if kind not in ('sound', 'avatar') then
    raise exception 'bad kind';
  end if;
  delete from lelons.tickets where expires_at < now();
  if (select count(*) from lelons.tickets t where t.account_id = me.id) >= 20 then
    raise exception 'too many uploads at once' using hint = 'daily';
  end if;
  file := case when kind = 'sound' then 'sounds/' || gen_random_uuid() || '.mp3'
               else 'avatars/' || gen_random_uuid() || '.jpg' end;
  insert into lelons.tickets (path, kind, account_id) values (file, 'upload', me.id);
  return file;
end $$;

create or replace function public.lelons_add(token text, sound_name text, sound_category text,
                                             file text, sound_seconds real, sound_bytes int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me lelons.accounts := lelons.who(token);
  new_id uuid;
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
  insert into lelons.sounds (name, category, path, seconds, bytes, uploader, uploader_id)
  values (btrim(sound_name), sound_category, file, sound_seconds, sound_bytes, me.username, me.id)
  returning sounds.id into new_id;
  delete from lelons.tickets where path = file;
  return new_id;
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

revoke execute on all functions in schema lelons from public;
grant execute on function lelons.ticket_ok(text, text), lelons.listed(text), lelons.hash(text) to anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['lelons_signup(text, text)', 'lelons_login(text, text)', 'lelons_logout(text)',
    'lelons_me(text)', 'lelons_password(text, text, text)', 'lelons_list(text)', 'lelons_ticket(text, text)',
    'lelons_add(text, text, text, text, real, int)', 'lelons_set_avatar(text, text)', 'lelons_delete(text, uuid)',
    'lelons_accounts(text)', 'lelons_set_role(text, uuid, text)', 'lelons_remove_account(text, uuid)',
    'lelons_rename(text, text)', 'lelons_delete_me(text, text)', 'lelons_favorite(text, uuid, boolean)'] loop
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
  using (bucket_id = 'lelons-sounds' and lelons.ticket_ok(name, 'delete') and not lelons.listed(name));

select 'All set! Open the Library tab in the app and log in.' as done;
