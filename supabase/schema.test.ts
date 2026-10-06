// Runs the real migration in PGlite (Postgres compiled to WASM) with small
// stand-ins for Supabase's auth and storage schemas, then checks that Row
// Level Security actually isolates users.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(join(__dirname, 'migrations', '20261006000000_init.sql'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema auth, storage, public to authenticated;
  grant execute on function auth.uid() to authenticated;
`;

let db: PGlite;

async function as(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // must be re-runnable
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant execute on all functions in schema public to authenticated;
  `);
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@x.in', '{"full_name":"Asha"}'), ($2, 'b@x.in', '{}')`, [A, B]);
}, 60000);

describe('schema', () => {
  it('creates a profile for every new auth user', async () => {
    const r = await db.query<{ id: string; full_name: string | null; role: string }>('select id, full_name, role from public.profiles order by id');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ id: A, full_name: 'Asha', role: 'uploader' });
  });

  it('creates the private documents bucket', async () => {
    const r = await db.query<{ public: boolean; file_size_limit: number }>(`select public, file_size_limit from storage.buckets where id = 'documents'`);
    expect(r.rows[0]).toMatchObject({ public: false });
    expect(Number(r.rows[0].file_size_limit)).toBe(20971520);
  });

  it('rejects invalid enum values', async () => {
    await expect(db.query(`insert into public.documents (user_id, file_name, file_url, sha256_hash, doc_type) values ($1, 'x', 'x', 'h', 'spreadsheet')`, [A])).rejects.toThrow();
  });
});

describe('row level security', () => {
  let docA: string;

  beforeAll(async () => {
    const r = await as(A, `insert into public.documents (user_id, file_name, file_url, sha256_hash, status) values ($1, 'invoice.pdf', $2, 'abc', 'ready') returning id`, [A, `${A}/d/invoice.pdf`]);
    docA = (r.rows[0] as { id: string }).id;
    await as(A, `insert into public.extractions (document_id, category, label, value, raw_text, page, line, confidence) values ($1, 'amount', 'Total', '₹100', 'Total ₹100', 1, 2, 0.9)`, [docA]);
  });

  it('lets an owner read their document and its fields', async () => {
    expect((await as(A, 'select id from public.documents')).rows).toHaveLength(1);
    expect((await as(A, 'select id from public.extractions')).rows).toHaveLength(1);
  });

  it('hides another user’s documents and fields completely', async () => {
    expect((await as(B, 'select id from public.documents')).rows).toHaveLength(0);
    expect((await as(B, 'select id from public.extractions')).rows).toHaveLength(0);
  });

  it('stops a user inserting rows into someone else’s document', async () => {
    await expect(as(B, `insert into public.extractions (document_id, category, label, value, raw_text, page, line) values ($1, 'amount', 'Fake', '1', 'x', 1, 1)`, [docA])).rejects.toThrow(/row-level security/);
    await expect(as(B, `insert into public.documents (user_id, file_name, file_url, sha256_hash) values ($1, 'x', 'x', 'x')`, [A])).rejects.toThrow(/row-level security/);
  });

  it('only lets reviewers change a field’s review status', async () => {
    const before = await as(A, `update public.extractions set reviewer_status = 'approved' returning id`);
    expect(before.rows).toHaveLength(0); // A is an uploader: update silently matches nothing
    await as(A, `update public.profiles set role = 'reviewer' where id = $1`, [A]);
    const after = await as(A, `update public.extractions set reviewer_status = 'approved' returning id`);
    expect(after.rows).toHaveLength(1);
  });

  it('scopes storage objects to the user’s own folder', async () => {
    await as(A, `insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${A}/d/invoice.pdf`]);
    await expect(as(B, `insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${A}/d/evil.pdf`])).rejects.toThrow(/row-level security/);
    expect((await as(B, `select name from storage.objects`)).rows).toHaveLength(0);
  });

  it('cascades deletes from a document to its fields', async () => {
    await as(A, 'delete from public.documents where id = $1', [docA]);
    expect((await db.query('select id from public.extractions')).rows).toHaveLength(0);
  });
});
