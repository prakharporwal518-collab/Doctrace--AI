import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <Logo />
        <p className="mt-8 font-mono text-sm text-faint">↳ p.404 · L0</p>
        <h1 className="mt-2 text-2xl font-semibold">No source, no page.</h1>
        <p className="mt-2 text-muted">We couldn’t find what you were looking for.</p>
        <Link to="/" className="mt-6 inline-block text-yellow hover:underline">
          Go home
        </Link>
      </div>
    </div>
  );
}
