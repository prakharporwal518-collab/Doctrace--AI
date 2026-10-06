-- DocTrace AI schema.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Security model: every table has Row Level Security. A user can only see and
-- change rows they own: directly (user_id = auth.uid()) or through a document
-- they own. Only users whose profile role is 'reviewer' may change the review
-- status of an extracted field.

-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ------------------------------------------------------------------ --
-- Tables                                                             --
-- ------------------------------------------------------------------ --

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  organisation text,
  role         text not null default 'uploader' check (role in ('uploader', 'reviewer')),
  language     text not null default 'en' check (language in ('en', 'hi')),
  avatar_url   text,
  privacy_mode boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.vendors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  gstin           text,
  total_documents integer not null default 0,
  total_anomalies integer not null default 0,
  risk_score      integer not null default 0 check (risk_score between 0 and 100)
);
create index if not exists vendors_user_idx on public.vendors (user_id);

create table if not exists public.documents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  file_name        text not null,
  file_url         text not null,                 -- path inside the "documents" storage bucket
  mime_type        text not null default 'application/pdf',
  file_size        bigint not null default 0,
  doc_type         text not null default 'other'
                   check (doc_type in ('invoice', 'contract', 'purchase_order', 'delivery_note', 'other')),
  sha256_hash      text not null,
  page_count       integer not null default 0,
  status           text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  trust_score      integer check (trust_score between 0 and 100),
  completeness     integer check (completeness between 0 and 100),
  fields_extracted integer not null default 0,
  fields_discarded integer not null default 0,     -- Evidence Lock rejections
  engine           text not null default 'rules' check (engine in ('rules', 'gemini', 'openai')),
  vendor_id        uuid references public.vendors (id) on delete set null,
  tamper_warning   text,
  error_message    text,
  pages            jsonb,                          -- parsed lines with page/line/bbox, for viewer + chat
  uploaded_at      timestamptz not null default now()
);
create index if not exists documents_user_idx on public.documents (user_id, uploaded_at desc);
create index if not exists documents_name_idx on public.documents (user_id, lower(file_name));

create table if not exists public.extractions (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents (id) on delete cascade,
  category         text not null check (category in ('deadline', 'amount', 'obligation', 'party', 'date', 'identifier', 'line_item')),
  label            text not null,
  value            text not null,
  raw_text         text not null,                  -- the exact source sentence
  normalized_value text,
  page             integer not null check (page > 0),
  line             integer not null check (line > 0),
  bbox             jsonb,                          -- {x, y, w, h} as fractions of the page
  confidence       double precision not null default 0 check (confidence between 0 and 1),
  verified         boolean not null default false, -- passed the Evidence Lock
  reviewer_status  text not null default 'pending' check (reviewer_status in ('pending', 'approved', 'rejected', 'corrected')),
  source           text not null default 'rules' check (source in ('rules', 'gemini', 'openai')),
  created_at       timestamptz not null default now()
);
create index if not exists extractions_doc_idx on public.extractions (document_id);

create table if not exists public.anomalies (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents (id) on delete cascade,
  rule_code      text not null,
  severity       text not null check (severity in ('low', 'medium', 'high')),
  title          text not null,
  explanation    text not null,
  expected_value text,
  found_value    text,
  page           integer,
  line           integer,
  bbox           jsonb,
  source_text    text,
  related        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists anomalies_doc_idx on public.anomalies (document_id);

create table if not exists public.missing_fields (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  field_name   text not null,
  why_required text not null,
  severity     text not null check (severity in ('low', 'medium', 'high'))
);
create index if not exists missing_doc_idx on public.missing_fields (document_id);

create table if not exists public.obligations (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents (id) on delete cascade,
  party          text not null,
  action         text not null,
  due_date       date,
  recurrence     text check (recurrence in ('monthly', 'quarterly', 'yearly')),
  penalty_text   text,
  penalty_amount double precision,
  amount         double precision,
  status         text not null default 'upcoming' check (status in ('upcoming', 'done', 'overdue')),
  extraction_id  uuid references public.extractions (id) on delete set null,
  page           integer,
  line           integer,
  bbox           jsonb,
  source_text    text
);
create index if not exists obligations_doc_idx on public.obligations (document_id);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  citations   jsonb not null default '[]'::jsonb,  -- [{page, line, bbox, source_text}]
  created_at  timestamptz not null default now()
);
create index if not exists chat_doc_idx on public.chat_messages (document_id, created_at);

create table if not exists public.corrections (
  id            uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  old_value     text not null,
  new_value     text not null,
  created_at    timestamptz not null default now()
);
create index if not exists corrections_ext_idx on public.corrections (extraction_id);

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_user_idx on public.audit_logs (user_id, created_at desc);

-- Links a purchase order, invoice and delivery note for the Three-Way Match.
create table if not exists public.match_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  po_id       uuid references public.documents (id) on delete set null,
  invoice_id  uuid references public.documents (id) on delete set null,
  delivery_id uuid references public.documents (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists match_user_idx on public.match_groups (user_id);

-- ------------------------------------------------------------------ --
-- Helpers                                                            --
-- ------------------------------------------------------------------ --

-- Does the signed-in user own this document? SECURITY DEFINER so child-table
-- policies don't re-evaluate the documents policy row by row.
create or replace function public.owns_document(doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documents d where d.id = doc and d.user_id = auth.uid());
$$;

create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer');
$$;

-- Create a profile row for every new auth user (email or Google sign-up).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ --
-- Row Level Security                                                 --
-- ------------------------------------------------------------------ --

alter table public.profiles       enable row level security;
alter table public.vendors        enable row level security;
alter table public.documents      enable row level security;
alter table public.extractions    enable row level security;
alter table public.anomalies      enable row level security;
alter table public.missing_fields enable row level security;
alter table public.obligations    enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.corrections    enable row level security;
alter table public.audit_logs     enable row level security;
alter table public.match_groups   enable row level security;

-- Drop-and-create keeps this file re-runnable.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname like 'dt_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy dt_profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy dt_profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy dt_profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy dt_vendors_all      on public.vendors      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dt_documents_all    on public.documents    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dt_match_groups_all on public.match_groups for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The audit log is append-only for normal use. Delete is allowed only for your
-- own rows so "Reset demo data" can start over; there is no update policy.
create policy dt_audit_select on public.audit_logs for select to authenticated using (user_id = auth.uid());
create policy dt_audit_insert on public.audit_logs for insert to authenticated with check (user_id = auth.uid());
create policy dt_audit_delete on public.audit_logs for delete to authenticated using (user_id = auth.uid());

create policy dt_extractions_select on public.extractions for select to authenticated using (public.owns_document(document_id));
create policy dt_extractions_insert on public.extractions for insert to authenticated with check (public.owns_document(document_id));
-- Only reviewers approve, reject or correct fields.
create policy dt_extractions_update on public.extractions for update to authenticated
  using (public.owns_document(document_id) and public.is_reviewer())
  with check (public.owns_document(document_id) and public.is_reviewer());
create policy dt_extractions_delete on public.extractions for delete to authenticated using (public.owns_document(document_id));

create policy dt_anomalies_all   on public.anomalies      for all to authenticated using (public.owns_document(document_id)) with check (public.owns_document(document_id));
create policy dt_missing_all     on public.missing_fields for all to authenticated using (public.owns_document(document_id)) with check (public.owns_document(document_id));
create policy dt_obligations_all on public.obligations    for all to authenticated using (public.owns_document(document_id)) with check (public.owns_document(document_id));

create policy dt_chat_select on public.chat_messages for select to authenticated using (user_id = auth.uid() and public.owns_document(document_id));
create policy dt_chat_insert on public.chat_messages for insert to authenticated with check (user_id = auth.uid() and public.owns_document(document_id));
create policy dt_chat_delete on public.chat_messages for delete to authenticated using (user_id = auth.uid() and public.owns_document(document_id));

create policy dt_corrections_select on public.corrections for select to authenticated using (user_id = auth.uid());
create policy dt_corrections_insert on public.corrections for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_reviewer()
  and exists (select 1 from public.extractions e where e.id = extraction_id and public.owns_document(e.document_id))
);

-- ------------------------------------------------------------------ --
-- Storage: private bucket, one folder per user (<user_id>/<doc_id>/<file>) --
-- ------------------------------------------------------------------ --

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dt_storage_select on storage.objects;
drop policy if exists dt_storage_insert on storage.objects;
drop policy if exists dt_storage_update on storage.objects;
drop policy if exists dt_storage_delete on storage.objects;

create policy dt_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dt_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dt_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dt_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
