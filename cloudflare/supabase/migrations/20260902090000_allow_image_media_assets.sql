alter table public.media_assets
  drop constraint if exists media_assets_type_check;

alter table public.media_assets
  add constraint media_assets_type_check
  check (type in ('video', 'audio', 'image'));
