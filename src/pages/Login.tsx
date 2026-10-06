import { ArrowRight, Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { FullPageLoader } from '@/app/RequireAuth';
import { useToast } from '@/app/toast';
import { Logo } from '@/components/Logo';
import { Button, cx } from '@/components/ui';
import { CLOUD, DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/config';
import { validatePassword } from '@/lib/localAuth';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

export default function Login() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/dashboard';
  const [mode, setMode] = useState<'signin' | 'signup'>(loc.pathname === '/signup' ? 'signup' : 'signin');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', organisation: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (auth.status === 'loading') return <FullPageLoader />;
  if (auth.status === 'signedIn' && auth.user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    if (mode === 'signup') {
      const bad = validatePassword(form.password);
      if (bad) return setError(bad);
      if (!form.full_name.trim()) return setError('Enter your name.');
    } else if (!form.password) return setError('Enter your password.');
    setBusy(mode);
    try {
      if (mode === 'signin') {
        await auth.signIn(form.email, form.password);
        navigate(from, { replace: true });
      } else {
        const r = await auth.signUp(form.email, form.password, { full_name: form.full_name.trim(), organisation: form.organisation.trim() });
        if (r.needsConfirmation) {
          setNotice('Check your inbox: we sent a confirmation link. Sign in after confirming.');
          setMode('signin');
        } else {
          toast.success('Account created', 'Welcome to DocTrace AI.');
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    setError(null);
    setBusy('Signing in…');
    try {
      await auth.signInDemo((m) => setBusy(m));
      toast.success('Signed in to the demo account', 'Three sample documents are ready to explore.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setError(null);
    try {
      await auth.signInWithGoogle();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
          <p className="mt-1 text-sm text-muted">{mode === 'signin' ? 'Welcome back.' : 'Start tracing every number to its source.'}</p>

          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => void demo()} loading={Boolean(busy) && busy !== 'signin' && busy !== 'signup'}>
            {busy && busy !== 'signin' && busy !== 'signup' ? busy : (
              <>
                Try Demo Account <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <p className="mt-2 text-center text-xs text-faint">
            <span className="font-mono">{DEMO_EMAIL}</span> · <span className="font-mono">{DEMO_PASSWORD}</span> · pre-loaded with sample documents
          </p>

          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>

          <Button className="w-full" onClick={() => void google()} disabled={!CLOUD} title={CLOUD ? undefined : 'Needs Supabase configuration'}>
            <GoogleIcon /> Continue with Google
          </Button>

          <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
            {mode === 'signup' && (
              <>
                <label className="block text-sm">
                  <span className="text-muted">Full name</span>
                  <input className="input mt-1" autoComplete="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Organisation (optional)</span>
                  <input className="input mt-1" autoComplete="organization" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
                </label>
              </>
            )}
            <label className="block text-sm">
              <span className="text-muted">Email</span>
              <input className="input mt-1" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Password</span>
              <input className="input mt-1" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {mode === 'signup' && <span className="mt-1 block text-xs text-faint">At least 8 characters, with letters and a number.</span>}
            </label>
            {error && (
              <p role="alert" className="rounded-md border border-anomaly/40 bg-anomaly/10 px-3 py-2 text-sm text-[#ff8a95]">
                {error}
              </p>
            )}
            {notice && <p className="rounded-md border border-amount/40 bg-amount/10 px-3 py-2 text-sm text-amount">{notice}</p>}
            <Button type="submit" variant="secondary" className="w-full" loading={busy === mode}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted">
            {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
            <button type="button" className="text-yellow hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}>
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          {!CLOUD && (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-yellow/25 bg-yellow/5 p-3 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0 text-yellow" />
              Offline demo mode: accounts and documents are stored only in this browser. Add Supabase keys to enable cloud accounts, Google sign-in and sync (see README).
            </p>
          )}
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-line bg-navy-2 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <p className="label">From invoice_0423.pdf</p>
        <div className="mt-4 rounded-md bg-white p-6 font-serif text-[15px] leading-7 text-[#1b2030] shadow-2xl shadow-black/50">
          <p className="text-xs tracking-[0.2em] text-[#6b7280]">TAX INVOICE · PAGE 2</p>
          <p className="mt-3">Subtotal (taxable value) ··· 4,00,000.00</p>
          <p>CGST @ 9% ··· 36,000.00</p>
          <p>SGST @ 9% ··· 36,000.00</p>
          <p className="mt-1">
            <span className="rounded-sm px-1 ring-2 ring-[#ff5d6c]" style={{ background: 'rgba(255,93,108,.15)' }}>
              Total amount payable ··· ₹4,82,500.00
            </span>
          </p>
        </div>
        <div className={cx('card mt-5 max-w-md p-4')}>
          <p className="text-xs text-[#ff8a95]">HIGH · ARITH_TOTAL</p>
          <p className="mt-1 font-semibold">Total ≠ Σ line items + GST (₹10,500.00 gap)</p>
          <p className="mt-1 text-sm text-muted">Expected ₹4,72,000.00 · found ₹4,82,500.00</p>
          <p className="cite mt-2 text-yellow">↳ p.2 · L18</p>
        </div>
        <p className="mt-10 max-w-md font-serif text-2xl leading-snug">
          “No source, <span className="italic">no output.</span>”
        </p>
        <p className="mt-2 text-sm text-faint">Every number DocTrace shows you is pinned to the line it came from.</p>
      </aside>
    </div>
  );
}
