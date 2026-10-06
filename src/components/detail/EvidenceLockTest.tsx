// "Stress-test the Evidence Lock": feed it fabricated fields next to a real
// one and watch it discard everything without evidence.
import { CheckCircle2, ShieldX } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/app/auth';
import { evidenceLock, type EvidenceResult } from '@/lib/engine/evidence';
import type { Extraction, FieldCandidate, ParsedDocument } from '@/lib/types';
import { Button, Modal } from '../ui';

function fabricate(real: Extraction, pageCount: number): FieldCandidate[] {
  const base: FieldCandidate = { category: real.category, label: real.label, value: real.value, normalized_value: real.normalized_value, page: real.page, line: real.line, source_text: real.raw_text, confidence: 0.97, origin: 'gemini' };
  return [
    { ...base, label: `${real.label} (genuine)` },
    { ...base, label: 'Hallucinated amount', category: 'amount', value: '₹9,99,999.00', normalized_value: '999999.00' },
    { ...base, label: 'Invented clause', category: 'obligation', value: 'Buyer must pay a 25% cancellation fee', source_text: 'A cancellation fee of 25% applies to all orders.' },
    { ...base, label: 'Wrong page', page: pageCount + 3 },
    { ...base, label: 'Wrong line', line: real.line === 1 ? 2 : real.line - 1 },
  ];
}

export function EvidenceLockTest({ open, onClose, parsed, extractions, documentId }: { open: boolean; onClose: () => void; parsed: ParsedDocument; extractions: Extraction[]; documentId: string }) {
  const { repo } = useSession();
  const [result, setResult] = useState<EvidenceResult | null>(null);
  const real = extractions.find((e) => e.category === 'amount' && /total/i.test(e.label)) ?? extractions[0];

  const run = async () => {
    if (!real) return;
    const r = evidenceLock(fabricate(real, parsed.pages.length), parsed);
    setResult(r);
    await repo.log('evidence_lock_test', { tested: 5, accepted: r.accepted.length, rejected: r.rejected.map((x) => ({ label: x.candidate.label, reason: x.reason })) }, documentId);
  };

  return (
    <Modal open={open} onClose={onClose} title="Stress-test the Evidence Lock" wide>
      <p className="text-sm text-muted">
        This sends five fields through the same verifier the LLM output goes through: one genuine field, plus four an AI might invent (a made-up amount quoting a real line, a clause that is not in the document, a wrong page and a wrong line). Only fields whose quote really exists at the cited page and line survive.
      </p>
      {!real ? (
        <p className="mt-4 text-sm text-muted">This document has no fields to test with.</p>
      ) : !result ? (
        <Button variant="primary" className="mt-4" onClick={() => void run()}>
          Run the test
        </Button>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-sm">
            <span className="font-semibold text-amount">{result.accepted.length} accepted</span>, <span className="font-semibold text-anomaly">{result.rejected.length} discarded</span>
          </p>
          {result.accepted.map((a) => (
            <div key={a.label} className="flex items-start gap-2 rounded-md border border-amount/30 bg-amount/5 p-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-amount" />
              <div>
                <p className="font-medium">{a.label}: {a.value}</p>
                <p className="text-xs text-muted">Quote found at p.{a.page} · L{a.line} ({Math.round(a.match_score * 100)}% match)</p>
              </div>
            </div>
          ))}
          {result.rejected.map((r, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border border-anomaly/30 bg-anomaly/5 p-2.5 text-sm">
              <ShieldX className="mt-0.5 size-4 shrink-0 text-anomaly" />
              <div className="min-w-0">
                <p className="font-medium">{r.candidate.label}: {r.candidate.value}</p>
                <p className="text-xs break-words text-muted">
                  Claimed p.{r.candidate.page} · L{r.candidate.line} · {r.reason}
                </p>
              </div>
            </div>
          ))}
          <p className="pt-2 text-xs text-faint">Logged to the audit trail. Your document’s fields were not changed.</p>
        </div>
      )}
    </Modal>
  );
}
