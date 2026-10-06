import { RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useToast } from '@/app/toast';
import { aiStatus, type AiStatus } from '@/lib/ai';
import { Button, Modal, PageHeader } from '@/components/ui';
import { useAsync } from '@/app/useAsync';
import type { Lang, Role } from '@/lib/types';

/** Resize a chosen image to a 160px square data URL (stored on the profile). */
async function avatarDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MB.');
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 160, 160);
  return c.toDataURL('image/jpeg', 0.85);
}

export default function Settings() {
  const { profile, user, updateProfile, isDemo, resetDemo, mode } = useSession();
  const { bump } = useData();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: profile.full_name ?? '', organisation: profile.organisation ?? '', role: profile.role, language: profile.language, avatar_url: profile.avatar_url });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { data: ai } = useAsync<AiStatus>(() => aiStatus(true), []);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ full_name: form.full_name.trim() || null, organisation: form.organisation.trim() || null, role: form.role, language: form.language, avatar_url: form.avatar_url });
      toast.success('Profile saved');
    } catch (err) {
      toast.error('Could not save your profile', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setConfirm(false);
    setResetting('Starting…');
    try {
      await resetDemo((m) => setResetting(m));
      toast.success('Demo data reset', 'The three sample documents were regenerated.');
      bump();
    } catch (err) {
      toast.error('Reset failed', (err as Error).message);
    } finally {
      setResetting(null);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('settings', profile.language)} subtitle={user.email} />
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Profile</h2>
        <div className="flex items-center gap-4">
          {form.avatar_url ? <img src={form.avatar_url} alt="" className="size-16 rounded-full object-cover" /> : <span className="grid size-16 place-items-center rounded-full bg-purple/30 text-lg font-semibold">{(form.full_name || user.email).slice(0, 2).toUpperCase()}</span>}
          <div className="flex gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line-2 px-3 text-[13px] hover:border-muted">
              Change photo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    setForm((s) => ({ ...s, avatar_url: '' }));
                    const url = await avatarDataUrl(f);
                    setForm((s) => ({ ...s, avatar_url: url }));
                  } catch (err) {
                    toast.error('Could not use that image', (err as Error).message);
                  }
                }}
              />
            </label>
            {form.avatar_url && (
              <Button size="sm" variant="ghost" onClick={() => setForm((s) => ({ ...s, avatar_url: null }))}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-muted">Full name</span>
            <input className="input mt-1" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={80} />
          </label>
          <label className="text-sm">
            <span className="text-muted">Organisation</span>
            <input className="input mt-1" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} maxLength={120} />
          </label>
          <label className="text-sm">
            <span className="text-muted">Role</span>
            <select className="input mt-1" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="uploader">Uploader: upload and read</option>
              <option value="reviewer">Reviewer: approve, reject and correct fields</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Preferred language</span>
            <select className="input mt-1" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Lang })}>
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-faint">Your organisation name tells DocTrace which party in a contract is you, so the other party becomes the vendor.</p>
        <Button variant="primary" onClick={() => void save()} loading={saving}>
          <Save className="size-4" /> Save profile
        </Button>
      </section>

      <section className="card mt-5 space-y-2 p-5 text-sm">
        <h2 className="font-semibold">How DocTrace is running</h2>
        <p className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-amount" /> Storage: {mode === 'cloud' ? 'Supabase (Postgres with Row Level Security, private storage bucket)' : 'this browser only (IndexedDB). Add Supabase keys to sync across devices.'}
        </p>
        <p className="text-muted">
          AI: {ai == null ? 'checking…' : ai.ai ? <span className="text-ink">{ai.provider} · {ai.model} (key kept on the server)</span> : <>rules engine only. {ai.reason}</>}
        </p>
        <p className="text-muted">OCR: Tesseract.js (English + Hindi), served from this site.</p>
        <p className="text-muted">Privacy mode: {profile.privacy_mode ? 'on' : 'off'} (toggle it in the sidebar).</p>
      </section>

      {isDemo && (
        <section className="card mt-5 p-5">
          <h2 className="font-semibold">Demo data</h2>
          <p className="mt-1 text-sm text-muted">Restore the three sample documents, review history, chats and audit entries to their original state.</p>
          <Button className="mt-3" variant="danger" onClick={() => setConfirm(true)} loading={Boolean(resetting)}>
            <RotateCcw className="size-4" /> {resetting ?? 'Reset demo data'}
          </Button>
        </section>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset demo data?">
        <p className="text-sm text-muted">Everything in this demo account (documents, reviews, chats and the audit trail) is deleted and regenerated.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void reset()}>
            Reset
          </Button>
        </div>
      </Modal>
    </div>
  );
}
