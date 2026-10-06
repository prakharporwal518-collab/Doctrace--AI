// npm run seed
//
// Creates (or resets) the demo user demo@doctrace.ai / Demo@1234 in your
// Supabase project and loads the sample documents for it.
//
// Needs, in .env or the environment:
//   SUPABASE_URL (or VITE_SUPABASE_URL)
//   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)
//   SUPABASE_SERVICE_ROLE_KEY   <- only used here, never ship it to the browser or Netlify
//
// The service-role key is used only to create/confirm the demo user. The data
// itself is written while signed in AS the demo user, so it goes through the
// same Row Level Security policies as the app.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../src/lib/config';
import { SupabaseRepo } from '../src/lib/data/supabase';
import { DEMO_PROFILE, seedDemoData } from '../src/lib/services/seed';

function need(name: string, ...alts: string[]): string {
  for (const k of [name, ...alts]) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  console.error(`\n✗ Missing ${name}${alts.length ? ` (or ${alts.join(' / ')})` : ''}. Add it to .env, see .env.example.\n`);
  process.exit(1);
}

async function main() {
  const url = need('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const anon = need('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  const service = need('SUPABASE_SERVICE_ROLE_KEY');
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };

  console.log(`→ Supabase: ${url}`);
  const admin = createClient(url, service, opts);

  // 1. Make sure the demo user exists, is confirmed, and has the known password.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    userId = data.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD, email_confirm: true });
    if (error) throw new Error(`Could not reset the demo password: ${error.message}`);
    console.log(`✓ Demo user exists (${userId}); password reset`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: DEMO_PROFILE.full_name } });
    if (error) throw new Error(`Could not create the demo user: ${error.message}`);
    userId = data.user.id;
    console.log(`✓ Created demo user (${userId})`);
  }

  // 2. Sign in as the demo user and seed through RLS.
  const client = createClient(url, anon, opts);
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (signInError) throw new Error(`Could not sign in as the demo user: ${signInError.message}`);
  const repo = new SupabaseRepo(client, session.user.id);
  await seedDemoData(repo, (m) => console.log(`  ${m}`));

  const docs = await repo.listDocuments();
  console.log(`\n✓ Seeded ${docs.length} documents:`);
  for (const d of docs) console.log(`   ${d.file_name.padEnd(32)} trust ${d.trust_score}`);
  console.log(`\nSign in with "Try Demo Account" (${DEMO_EMAIL} / ${DEMO_PASSWORD}).\n`);
}

main().catch((err) => {
  console.error(`\n✗ Seeding failed: ${(err as Error).message}`);
  if (/relation .* does not exist|42P01/.test(String((err as Error).message))) console.error('  Run supabase/migrations/20261006000000_init.sql in the Supabase SQL editor first.');
  if (/bucket/i.test(String((err as Error).message))) console.error('  The "documents" storage bucket is created by the migration; re-run it.');
  process.exit(1);
});
