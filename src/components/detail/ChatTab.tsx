// Ask-the-Document. Every answer carries clickable citations; if the answer
// is not in the document, the reply says so instead of guessing.
import { Bot, Send, Trash2, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/app/auth';
import { t } from '@/app/i18n';
import { useToast } from '@/app/toast';
import { aiChat, aiStatus } from '@/lib/ai';
import { answerLocally, NOT_FOUND } from '@/lib/engine/qa';
import { nowISO, uuid } from '@/lib/id';
import type { ChatMessage, Citation, DocType, Lang, ParsedPage } from '@/lib/types';
import { Button, Cite, cx } from '../ui';

const SUGGESTIONS: Record<DocType, Record<Lang, string[]>> = {
  invoice: { en: ['When is the payment due?', 'What is the total amount?', 'What is the GST charged?'], hi: ['भुगतान की अंतिम तारीख कब है?', 'कुल राशि कितनी है?', 'जीएसटी कितना है?'] },
  contract: { en: ['What is the late payment penalty?', 'When does the agreement renew?', 'What must CloudServe deliver every month?'], hi: ['देर से भुगतान पर कितना जुर्माना लगेगा?', 'अनुबंध का नवीनीकरण कब है?', 'नोटिस कितने दिन पहले देना है?'] },
  purchase_order: { en: ['When must the goods be delivered?', 'What is the order total?', 'Who approved this order?'], hi: ['डिलीवरी की तारीख कब है?', 'ऑर्डर की कुल राशि कितनी है?', 'मॉनिटर की दर क्या है?'] },
  delivery_note: { en: ['Who received the goods?', 'Which PO does this relate to?', 'When were the goods delivered?'], hi: ['डिलीवरी कब हुई?', 'कुल राशि कितनी है?', 'ऑर्डर नंबर क्या है?'] },
  other: { en: ['What are the key dates?', 'What amounts are mentioned?'], hi: ['मुख्य तारीखें क्या हैं?', 'कौन सी राशियाँ हैं?'] },
};

export function ChatTab({ documentId, docType, pages, messages, onLocateCitation, onChanged }: { documentId: string; docType: DocType; pages: ParsedPage[] | null; messages: ChatMessage[]; onLocateCitation: (c: Citation, key: string) => void; onChanged: () => void }) {
  const { repo, profile } = useSession();
  const toast = useToast();
  const [lang, setLang] = useState<Lang>(profile.language);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<string>('…');
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const all = [...messages, ...local.filter((m) => !messages.some((x) => x.id === m.id))];

  useEffect(() => {
    void aiStatus().then((s) => setEngine(s.ai ? `${s.provider} · ${s.model}` : 'offline engine'));
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [all.length, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy || !pages) return;
    setBusy(true);
    setQ('');
    const userMsg: ChatMessage = { id: uuid(), document_id: documentId, user_id: repo.userId, role: 'user', content: text, citations: [], created_at: nowISO() };
    setLocal((l) => [...l, userMsg]);
    const answerLang: Lang = /[\u0900-\u097F]/.test(text) ? 'hi' : lang;
    let answer = '';
    let citations: Citation[] = [];
    let note = '';
    try {
      const status = await aiStatus();
      if (status.ai) {
        try {
          const r = await aiChat(text, pages, { privacy: profile.privacy_mode, language: answerLang, history: all.slice(-6).map((m) => ({ role: m.role, content: m.content })) });
          if (r.found) {
            answer = r.answer;
            citations = r.citations;
            if (r.discarded) note = `${r.discarded} citation${r.discarded === 1 ? '' : 's'} failed the Evidence Lock and ${r.discarded === 1 ? 'was' : 'were'} removed.`;
          } else if (r.discarded) note = 'The AI answer cited lines that do not contain its quote, so it was discarded.';
        } catch (err) {
          note = `AI unavailable (${(err as Error).message}); answered with the offline engine.`;
        }
      }
      if (!answer) {
        // Offline engine: grounded keyword search over the document's own lines.
        const r = answerLocally(text, pages, answerLang);
        answer = r.answer;
        citations = r.citations;
      }
      if (!citations.length) answer = NOT_FOUND[answerLang];
      const reply: ChatMessage = { id: uuid(), document_id: documentId, user_id: repo.userId, role: 'assistant', content: note ? `${answer}\n\n(${note})` : answer, citations, created_at: nowISO() };
      setLocal((l) => [...l, reply]);
      await repo.addChatMessages([userMsg, reply]);
      await repo.log('chat', { question: text.slice(0, 200), citations: citations.length, found: citations.length > 0 }, documentId);
      onChanged();
    } catch (err) {
      toast.error('Could not answer', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await repo.clearChat(documentId);
      setLocal([]);
      onChanged();
    } catch (err) {
      toast.error('Could not clear the chat', (err as Error).message);
    }
  };

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Answers come only from this document · <span className="font-mono">{engine}</span>
        </span>
        <div className="flex items-center gap-1">
          {(['en', 'hi'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={cx('rounded px-2 py-0.5', lang === l ? 'bg-yellow/15 text-yellow' : 'hover:text-ink')} aria-pressed={lang === l}>
              {l === 'en' ? 'English' : 'हिन्दी'}
            </button>
          ))}
          {all.length > 0 && (
            <button type="button" onClick={() => void clear()} className="ml-1 rounded p-1 hover:text-ink" title="Clear chat" aria-label="Clear chat">
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3">
        {!all.length && <p className="text-sm text-muted">Ask anything about this document, in English or Hindi. If the answer is not in it, you will be told so.</p>}
        {all.map((m) => (
          <div key={m.id} className={cx('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full', m.role === 'user' ? 'bg-purple/30' : 'bg-yellow/15 text-yellow')}>{m.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}</span>
            <div className={cx('max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-line', m.role === 'user' ? 'bg-purple/20' : 'border border-line bg-card')}>
              {m.content}
              {m.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-1.5">
                  {m.citations.map((c, i) => (
                    <Cite key={i} page={c.page} line={c.line} onClick={() => onLocateCitation(c, `chat:${m.id}:${i}`)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-muted">Reading the document…</p>}
        <div ref={end} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {SUGGESTIONS[docType][lang].map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => void ask(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-line-2 hover:text-ink disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('askPlaceholder', lang)} maxLength={500} aria-label="Question" />
        <Button type="submit" variant="primary" loading={busy} disabled={!q.trim()} aria-label="Ask">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
