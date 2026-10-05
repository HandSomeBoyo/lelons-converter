-- Lelons Converter: the shared SFX tab.
--
-- Run this once in your Supabase project: SQL Editor > New query > paste all
-- of this > change the two codes just below > Run.
-- Running it again later is fine (to change a code, for example).

-- 1. Your codes. Give the friend code to your friends. Keep the owner code to
--    yourself: typed into the app, it lets you delete any sound.
--    (Upper/lower case and spaces around them don't matter.)
create schema if not exists lelons;
create or replace function lelons.hash(code text) returns text
  language sql immutable set search_path = '' as
  $$ select encode(sha256(convert_to('lelons:' || lower(btrim(code)), 'UTF8')), 'hex') $$;

create table if not exists lelons.config (
  id int primary key default 1 check (id = 1),
  friend_hash text not null,
  owner_hash text not null
);
insert into lelons.config (friend_hash, owner_hash)
values (lelons.hash('CHANGE-ME-friend-code'), lelons.hash('CHANGE-ME-owner-code'))
on conflict (id) do update set friend_hash = excluded.friend_hash, owner_hash = excluded.owner_hash;

-- 2. Everything below sets up the list of sounds and where the files go.
create table if not exists lelons.sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  category text not null check (category in ('sfx', 'music', 'memes', 'ambience', 'other')),
  path text not null unique,
  seconds real not null default 0,
  bytes int not null default 0,
  uploader text not null default '' check (length(uploader) <= 40),
  owner_hash text not null,
  created_at timestamptz not null default now()
);
alter table lelons.sounds enable row level security;
alter table lelons.config enable row level security;
revoke all on all tables in schema lelons from anon, authenticated;

-- The folder the files go in. Only the app (knowing the friend code) can work it out.
create or replace function lelons.folder() returns text
  language sql stable security definer set search_path = '' as
  $$ select left(encode(sha256(convert_to('folder:' || friend_hash, 'UTF8')), 'hex'), 32) from lelons.config $$;

-- True while a file is in the list (then it can only be deleted through lelons_delete).
create or replace function lelons.listed(file text) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from lelons.sounds where path = file) $$;

create or replace function lelons.check_code(code text) returns void
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from lelons.config where friend_hash = lelons.hash(code)) then
    raise exception 'wrong friend code' using errcode = 'P0001', hint = 'code';
  end if;
end $$;

grant usage on schema lelons to anon, authenticated;
grant execute on function lelons.folder(), lelons.listed(text), lelons.hash(text) to anon, authenticated;

-- What the app calls.
create or replace function public.lelons_check(code text, owner_code text default '')
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  perform lelons.check_code(code);
  return json_build_object('ok', true,
    'owner', exists (select 1 from lelons.config where owner_hash = lelons.hash(coalesce(owner_code, ''))));
end $$;

create or replace function public.lelons_list(code text, me text)
returns table (id uuid, name text, category text, path text, seconds real, bytes int,
               uploader text, created_at timestamptz, mine boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform lelons.check_code(code);
  return query select s.id, s.name, s.category, s.path, s.seconds, s.bytes, s.uploader, s.created_at,
                      s.owner_hash = lelons.hash(me)
               from lelons.sounds s order by s.created_at desc limit 5000;
end $$;

create or replace function public.lelons_add(code text, me text, sound_name text, sound_category text,
                                             file text, sound_seconds real, sound_bytes int, uploader_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  perform lelons.check_code(code);
  if length(coalesce(me, '')) < 16 then
    raise exception 'missing app id';
  end if;
  if file not like lelons.folder() || '/%' then
    raise exception 'wrong folder';
  end if;
  if (select count(*) from lelons.sounds where owner_hash = lelons.hash(me) and created_at > now() - interval '1 day') >= 100 then
    raise exception 'too many uploads today' using hint = 'daily';
  end if;
  if (select coalesce(sum(bytes), 0) from lelons.sounds) + sound_bytes > 950 * 1024 * 1024 then
    raise exception 'storage full' using hint = 'full';
  end if;
  insert into lelons.sounds (name, category, path, seconds, bytes, uploader, owner_hash)
  values (btrim(sound_name), sound_category, file, sound_seconds, sound_bytes, btrim(coalesce(uploader_name, '')), lelons.hash(me))
  returning sounds.id into new_id;
  return new_id;
end $$;

-- Takes a sound off the list and returns its file, which the app then deletes.
create or replace function public.lelons_delete(code text, me text, owner_code text, sound_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  file text;
begin
  perform lelons.check_code(code);
  delete from lelons.sounds s
  where s.id = sound_id
    and (s.owner_hash = lelons.hash(me)
         or exists (select 1 from lelons.config c where c.owner_hash = lelons.hash(coalesce(owner_code, ''))))
  returning s.path into file;
  if file is null then
    raise exception 'not allowed' using hint = 'denied';
  end if;
  return file;
end $$;

revoke execute on function public.lelons_check(text, text), public.lelons_list(text, text),
  public.lelons_add(text, text, text, text, text, real, int, text), public.lelons_delete(text, text, text, uuid) from public;
grant execute on function public.lelons_check(text, text), public.lelons_list(text, text),
  public.lelons_add(text, text, text, text, text, real, int, text), public.lelons_delete(text, text, text, uuid)
  to anon, authenticated;

-- The sound files: anyone can play them (the links are secret),
-- only the app can add them, MP3s up to 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lelons-sounds', 'lelons-sounds', true, 10485760, array['audio/mpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lelons upload" on storage.objects;
drop policy if exists "lelons see" on storage.objects;
drop policy if exists "lelons remove" on storage.objects;
create policy "lelons upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'lelons-sounds' and (storage.foldername(name))[1] = lelons.folder());
create policy "lelons see" on storage.objects for select to anon, authenticated
  using (bucket_id = 'lelons-sounds' and (storage.foldername(name))[1] = lelons.folder());
create policy "lelons remove" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'lelons-sounds' and (storage.foldername(name))[1] = lelons.folder() and not lelons.listed(name));

select 'All set! Now copy your Project URL and publishable key into the chat.' as done;
