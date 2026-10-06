import { Link } from 'react-router-dom';

/** "Doc[Trace] AI": the highlighted word is the source being traced. */
export function Logo({ to = '/', small }: { to?: string; small?: boolean }) {
  return (
    <Link to={to} className={`inline-flex items-center font-bold tracking-tight ${small ? 'text-lg' : 'text-xl'}`} aria-label="DocTrace AI home">
      <span className="text-ink">Doc</span>
      <span className="relative mx-[1px] inline-block px-1 text-navy">
        <span className="absolute inset-x-0 inset-y-[3px] -skew-x-6 rounded-[3px] bg-yellow" aria-hidden="true" />
        <span className="relative">Trace</span>
      </span>
      <span className="ml-1.5 font-medium text-muted">AI</span>
    </Link>
  );
}
