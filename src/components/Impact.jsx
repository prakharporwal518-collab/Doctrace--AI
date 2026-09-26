import { IMPACT } from '../data/content.js';
import Section from './Section.jsx';

export default function Impact() {
  return (
    <Section id="roadmap" kicker={IMPACT.kicker} title={IMPACT.title}>
      <div className="grid grid--4">
        {IMPACT.stats.map((s) => (
          <div key={s.value} className="stat card card--pad">
            <span className="stat__value">{s.value}</span>
            <span className="muted small">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="impact__bottom">
        <div className="card card--pad">
          <p className="label">Who benefits</p>
          <ul className="list list--dots">{IMPACT.beneficiaries.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
        <div>
          <p className="label">Roadmap</p>
          <ol className="roadmap">
            {IMPACT.roadmap.map((r) => (
              <li key={r.n} className={`roadmap__step ${r.n === 1 ? 'is-now' : ''}`}>
                <span className="roadmap__n">{r.n}</span>
                <h3>{r.title}</h3>
                <span className="roadmap__when">{r.when}</span>
                <ul>{r.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
