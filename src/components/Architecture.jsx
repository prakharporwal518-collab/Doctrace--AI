import { ARCHITECTURE } from '../data/content.js';
import Section from './Section.jsx';

export default function Architecture() {
  return (
    <Section id="architecture" kicker={ARCHITECTURE.kicker} title={ARCHITECTURE.title}>
      <ol className="pipeline">
        {ARCHITECTURE.steps.map((s) => (
          <li key={s.n} className="card pipeline__step">
            <span className="pipeline__n">{s.n}</span>
            <h3>{s.title}</h3>
            <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
          </li>
        ))}
      </ol>
      <div className="arch__bottom">
        <div className="card card--pad">
          <p className="label">Data layer</p>
          <ul className="datalayer">
            {ARCHITECTURE.dataLayer.map((d) => {
              const [name, role] = d.split(' · ');
              return <li key={d}><strong>{name}</strong><span className="muted"> · {role}</span></li>;
            })}
          </ul>
        </div>
        <div className="card card--pad">
          <p className="label">Tech stack</p>
          <div className="chips">
            {ARCHITECTURE.stack.map((t) => <span key={t} className="chip chip--solid">{t}</span>)}
          </div>
          <p className="muted small mt">
            The live demo on this page runs the Understand, Extract and Verify steps in the browser with a
            rules engine, so it works offline and never sends your files anywhere.
          </p>
        </div>
      </div>
    </Section>
  );
}
