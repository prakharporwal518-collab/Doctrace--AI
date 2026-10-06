import { ArrowLeftRight, CalendarClock, ClipboardList, FileStack, GitCompareArrows, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Store, Upload, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { UploadDialog } from '@/components/UploadDialog';
import { Button, cx } from '@/components/ui';
import { useSession } from './auth';
import { useData } from './data';
import { t, type StringKey } from './i18n';
import { useToast } from './toast';

const NAV: Array<{ to: string; key: StringKey; icon: ReactNode }> = [
  { to: '/dashboard', key: 'dashboard', icon: <LayoutDashboard className="size-4" /> },
  { to: '/documents', key: 'documents', icon: <FileStack className="size-4" /> },
  { to: '/radar', key: 'radar', icon: <CalendarClock className="size-4" /> },
  { to: '/three-way', key: 'threeWay', icon: <ArrowLeftRight className="size-4" /> },
  { to: '/compare', key: 'compare', icon: <GitCompareArrows className="size-4" /> },
  { to: '/vendors', key: 'vendors', icon: <Store className="size-4" /> },
  { to: '/audit', key: 'audit', icon: <ClipboardList className="size-4" /> },
  { to: '/settings', key: 'settings', icon: <Settings className="size-4" /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, mode, signOut, updateProfile, isDemo } = useSession();
  const { openUpload } = useData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const lang = profile.language;

  const togglePrivacy = async () => {
    try {
      await updateProfile({ privacy_mode: !profile.privacy_mode });
      toast.info(profile.privacy_mode ? 'Privacy mode off' : 'Privacy mode on', profile.privacy_mode ? 'Text is sent to the AI model as-is.' : 'PAN, Aadhaar, bank account and phone numbers are masked before any text reaches the AI model.');
    } catch (err) {
      toast.error('Could not change privacy mode', (err as Error).message);
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo to="/dashboard" small />
        <button type="button" className="rounded p-1 text-faint hover:text-ink lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-3">
        <Button variant="primary" className="w-full" onClick={() => { setOpen(false); openUpload(); }}>
          <Upload className="size-4" /> {t('upload', lang)}
        </Button>
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-white/[0.06] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-ink')}>
            {n.icon}
            {t(n.key, lang)}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-3 border-t border-line p-4">
        <button type="button" onClick={togglePrivacy} className="flex w-full items-center justify-between rounded-lg px-1 text-sm text-muted hover:text-ink" aria-pressed={profile.privacy_mode}>
          <span className="flex items-center gap-2">
            <ShieldCheck className={cx('size-4', profile.privacy_mode && 'text-amount')} /> {t('privacy', lang)}
          </span>
          <span className={cx('relative h-5 w-9 rounded-full transition-colors', profile.privacy_mode ? 'bg-amount' : 'bg-line-2')}>
            <span className={cx('absolute top-0.5 size-4 rounded-full bg-white transition-all', profile.privacy_mode ? 'left-[18px]' : 'left-0.5')} />
          </span>
        </button>
        <div className="flex items-center gap-3">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-purple/30 text-xs font-semibold text-ink">{(profile.full_name || user.email).slice(0, 2).toUpperCase()}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{profile.full_name || user.email}</p>
            <p className="truncate text-xs text-faint capitalize">
              {profile.role}
              {isDemo ? ' · demo' : ''}
            </p>
          </div>
          <button type="button" onClick={signOut} className="rounded p-1.5 text-faint hover:text-ink" title={t('signOut', lang)} aria-label={t('signOut', lang)}>
            <LogOut className="size-4" />
          </button>
        </div>
        <p className={cx('rounded-md px-2 py-1 text-[11px]', mode === 'cloud' ? 'bg-amount/10 text-amount' : 'bg-yellow/10 text-yellow')} title={mode === 'cloud' ? 'Data is stored in Supabase with Row Level Security.' : 'No Supabase keys configured: data stays in this browser (IndexedDB).'}>
          {mode === 'cloud' ? '● Cloud · Supabase' : '● Offline demo · data stays in this browser'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-navy-2 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-rise border-r border-line bg-navy-2">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-navy/90 px-4 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="rounded p-1.5 text-muted hover:text-ink" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Logo to="/dashboard" small />
        <button type="button" onClick={openUpload} className="rounded p-1.5 text-yellow" aria-label="Upload">
          <Upload className="size-5" />
        </button>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <UploadDialog />
    </div>
  );
}
