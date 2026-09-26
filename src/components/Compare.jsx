import { COMPARE } from '../data/content.js';
import Section from './Section.jsx';

const MARK = {
  yes: { symbol: '✓', text: 'Supported', cls: 'yes' },
  partial: { symbol: '◐', text: 'Partial / slow', cls: 'partial' },
  no: { symbol: '✕', text: 'Not supported', cls: 'no' },
};

export default function Compare() {
  return (
    <Section id="compare" kicker={COMPARE.kicker} title={COMPARE.title}>
      <div className="table-wrap card">
        <table className="compare">
          <caption className="sr-only">Capability comparison between manual review, OCR tools, generic AI chat and DocTrace AI</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              {COMPARE.columns.map((c, i) => (
                <th key={c} scope="col" className={i === COMPARE.columns.length - 1 ? 'us' : ''}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, i) => {
                  const m = v ? MARK[v] : null;
                  return (
                    <td key={i} className={i === r.values.length - 1 ? 'us' : ''}>
                      {m ? (
                        <span className={`mark mark--${m.cls}`} title={m.text}>
                          <span aria-hidden="true">{m.symbol}</span>
                          <span className="sr-only">{m.text}</span>
                        </span>
                      ) : (
                        <span className="muted small">N/A</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend">
        {Object.values(MARK).map((m) => (
          <span key={m.cls}><span className={`mark mark--${m.cls}`} aria-hidden="true">{m.symbol}</span> {m.text}</span>
        ))}
      </div>
    </Section>
  );
}
