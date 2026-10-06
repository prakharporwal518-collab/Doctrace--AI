import { FileImage, FileText, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DOC_TYPE_LABEL } from '@/lib/categories';
import type { DocumentSummary } from '@/lib/data/repo';
import { Badge, TrustRing } from './ui';

export function DocRow({ d, anomalies }: { d: DocumentSummary; anomalies?: number }) {
  const Icon = d.mime_type.startsWith('image/') ? FileImage : FileText;
  return (
    <Link to={`/documents/${d.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
      <Icon className="size-5 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          <span className="truncate">{d.file_name}</span>
          {d.tamper_warning && <ShieldAlert className="size-3.5 shrink-0 text-missing" aria-label="Tamper warning" />}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
          <span>{DOC_TYPE_LABEL[d.doc_type]}</span>
          <span>· {new Date(d.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          {d.status !== 'ready' && <Badge className={d.status === 'failed' ? 'text-anomaly' : 'text-yellow'}>{d.status}</Badge>}
          {anomalies != null && anomalies > 0 && <span className="text-[#ff8a95]">· {anomalies} anomal{anomalies === 1 ? 'y' : 'ies'}</span>}
        </p>
      </div>
      <TrustRing score={d.trust_score} size={38} stroke={4} />
    </Link>
  );
}
