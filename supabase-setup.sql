-- Party photo album: run this once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again (also if you ran an older version of this file).

-- 1. The table that remembers each photo
create table if not exists public.photos (
  id            bigint generated always as identity primary key,
  path          text not null unique,
  uploader_name text not null check (char_length(uploader_name) between 1 and 40),
  device_id     text not null,
  is_favourite  boolean not null default false,
  created_at    timestamptz not null default now()
);

-- (adds the favourites column if the table was created by an older version)
alter table public.photos add column if not exists is_favourite boolean not null default false;

create index if not exists photos_device_id_idx on public.photos (device_id);
create index if not exists photos_favourites_idx on public.photos (id desc) where is_favourite;

-- 2. Lock the table down.
--    Row Level Security ON with NO policies means the public ("anon"/publishable) key
--    can't read or write anything. Only the server, using the secret key, can.
--    That's what keeps un-starred photos visible only to the person who took them and the host.
alter table public.photos enable row level security;
revoke all on table public.photos from anon, authenticated;
grant select, insert, update, delete on table public.photos to service_role;

-- 3. A PRIVATE storage bucket for the image files (JPEG only, max 5 MB each).
--    No storage policies are added, so files can only be reached through the server
--    or through short-lived signed links the server hands out.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = false;
