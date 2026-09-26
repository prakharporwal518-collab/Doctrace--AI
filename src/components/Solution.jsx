import { SOLUTION } from '../data/content.js';
import Icon from './Icon.jsx';
import Section from './Section.jsx';

export default function Solution() {
  return (
    <Section id="solution" kicker={SOLUTION.kicker} title={SOLUTION.title}>
      <div className="flow">
        <div className="card card--pad flow__col">
          <p className="label">Input</p>
          <ul className="list">
            {SOLUTION.inputs.map((i) => <li key={i}><Icon name="file" size={16} /> {i}</li>)}
          </ul>
        </div>
        <div className="flow__arrow" aria-hidden="true"><Icon name="arrow" size={28} /></div>
        <div className="card flow__engine">
          <span className="icon-badge tone-violet big"><Icon name="cpu" size={28} /></span>
          <h3>DocTrace Engine</h3>
          {SOLUTION.engine.map((e) => <p key={e} className="muted">{e}</p>)}
        </div>
        <div className="flow__arrow" aria-hidden="true"><Icon name="arrow" size={28} /></div>
        <div className="card card--pad flow__col">
          <p className="label">Output</p>
          <ul className="list list--out">
            {SOLUTION.outputs.map((o) => (
              <li key={o.label}><span>{o.label}</span><span className="cite">↳ {o.source}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid grid--4 mt-lg">
        {SOLUTION.pillars.map((p) => (
          <article key={p.title} className="pillar">
            <span className="icon-badge tone-teal"><Icon name={p.icon} /></span>
            <div>
              <h3 className="card__title">{p.title}</h3>
              <p className="muted small">{p.text}</p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
