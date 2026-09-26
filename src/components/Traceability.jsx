import { useState } from 'react';
import { TRACE } from '../data/content.js';
import Section from './Section.jsx';

function JsonValue({ value }) {
  if (typeof value === 'string') return <span className="j-str">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="j-num">{value}</span>;
  if (Array.isArray(value)) return <span className="j-num">[{value.join(',')}]</span>;
  return null;
}

export default function Traceability() {
  const [linked, setLinked] = useState(false);
  const { doc, json } = TRACE;

  const hover = {
    onMouseEnter: () => setLinked(true),
    onMouseLeave: () => setLinked(false),
    onFocus: () => setLinked(true),
    onBlur: () => setLinked(false),
    onClick: () => setLinked((v) => !v),
  };

  return (
    <Section id="traceability" kicker={TRACE.kicker} title={TRACE.title}>
      <p className="lead">Hover or tap the <span className="mono">source</span> block to see where the answer came from.</p>
      <div className="trace">
        <div className="paper" aria-label="Source document">
          <div className="paper__head">
            <strong>{doc.heading}</strong>
            <span>{doc.page}</span>
          </div>
          {doc.clauses.map((c) => {
            const parts = c.highlight ? c.text.split(c.highlight) : [c.text];
            return (
              <p key={c.id} className={`paper__clause ${c.highlight && linked ? 'is-linked' : ''}`}>
                <b>{c.id}</b>{' '}
                {c.highlight ? (
                  <>
                    {parts[0]}
                    <mark className={linked ? 'is-on' : ''}>{c.highlight}</mark>
                    {parts[1]}
                  </>
                ) : (
                  c.text
                )}
              </p>
            );
          })}
        </div>

        <div className="code card" aria-label="Extracted result">
          <div className="code__head"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="mono">extracted_result.json</span></div>
          <pre className="code__body">
            {'{\n'}
            {['type', 'label', 'value', 'derived'].map((k) => (
              <span key={k}>{'  '}<span className="j-key">&quot;{k}&quot;</span>: <JsonValue value={json[k]} />,{'\n'}</span>
            ))}
            <span className={`code__source ${linked ? 'is-on' : ''}`} tabIndex={0} role="button" aria-pressed={linked} {...hover}>
              {'  '}<span className="j-key">&quot;source&quot;</span>: {'{\n'}
              {Object.entries(json.source).map(([k, v], i, arr) => (
                <span key={k}>{'    '}<span className="j-key">&quot;{k}&quot;</span>: <JsonValue value={v} />{i < arr.length - 1 ? ',' : ''}{'\n'}</span>
              ))}
              {'  },\n'}
            </span>
            {'  '}<span className="j-key">&quot;confidence&quot;</span>: <JsonValue value={json.confidence} />{'\n}'}
          </pre>
        </div>
      </div>

      <ol className="steps">
        {TRACE.steps.map((s) => (
          <li key={s.n} className="card card--pad step">
            <span className="step__n">{s.n}</span>
            <div>
              <h3 className="card__title">{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
