import { CHECKS } from '../data/content.js';
import Icon from './Icon.jsx';
import Section from './Section.jsx';

export default function Checks() {
  return (
    <Section id="checks" kicker={CHECKS.kicker} title={CHECKS.title}>
      <div className="checks">
        <div className="grid grid--2">
          {CHECKS.layers.map((l, i) => (
            <article key={l.title} className="card card--pad">
              <div className="row gap-sm">
                <span className={`icon-badge ${['tone-yellow', 'tone-teal', 'tone-violet', 'tone-coral'][i]}`}><Icon name={l.icon} /></span>
                <h3 className="card__title">{l.title}</h3>
              </div>
              <ul className="list list--dots">{l.items.map((it) => <li key={it}>{it}</li>)}</ul>
            </article>
          ))}
        </div>
        <aside className="card card--pad">
          <p className="label">Missing-data check</p>
          <p className="muted small">{CHECKS.schema.name}</p>
          <ul className="schema">
            {CHECKS.schema.fields.map((f) => (
              <li key={f.label} className={f.ok ? 'ok' : 'miss'}>
                <span className="schema__mark" aria-hidden="true">{f.ok ? '✓' : '!'}</span>
                <span>{f.label}</span>
                {!f.ok && <span className="badge sev-HIGH">Missing</span>}
                <span className="sr-only">{f.ok ? 'present' : 'missing'}</span>
              </li>
            ))}
          </ul>
          <p className="small mt">Every finding gets a severity and a citation</p>
          <div className="chips">
            {CHECKS.severities.map((s) => <span key={s} className={`badge sev-${s}`}>{s}</span>)}
          </div>
        </aside>
      </div>
    </Section>
  );
}
