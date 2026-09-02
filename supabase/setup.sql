create extension if not exists pgcrypto;

create table if not exists public.assembly_documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  group_name text not null check (group_name in ('GRÚA', 'CARROCERÍA')),
  storage_path text not null unique,
  uploaded_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.assembly_documents enable row level security;
alter table public.assembly_documents alter column uploaded_by drop not null;

insert into storage.buckets (id, name, public)
values ('assembly-excel', 'assembly-excel', false)
on conflict (id) do update set public = false;

drop policy if exists "Equipos MC lee documentos" on public.assembly_documents;
create policy "Equipos MC lee documentos"
on public.assembly_documents for select
to anon, authenticated
using (true);

drop policy if exists "Equipos MC agrega documentos" on public.assembly_documents;
create policy "Equipos MC agrega documentos"
on public.assembly_documents for insert
to anon, authenticated
with check (true);

drop policy if exists "Equipos MC elimina documentos" on public.assembly_documents;
create policy "Equipos MC elimina documentos"
on public.assembly_documents for delete
to anon, authenticated
using (true);

drop policy if exists "Equipos MC lee archivos Excel" on storage.objects;
create policy "Equipos MC lee archivos Excel"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'assembly-excel'
);

drop policy if exists "Equipos MC carga archivos Excel" on storage.objects;
create policy "Equipos MC carga archivos Excel"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'assembly-excel'
);

drop policy if exists "Equipos MC elimina archivos Excel" on storage.objects;
create policy "Equipos MC elimina archivos Excel"
on storage.objects for delete
to anon, authenticated
using (
  bucket_id = 'assembly-excel'
);
