import { PROBLEM } from '../data/content.js';
import Icon from './Icon.jsx';
import Section from './Section.jsx';

export default function Problem() {
  return (
    <Section id="problem" kicker={PROBLEM.kicker} title={PROBLEM.title}>
      <div className="grid grid--4">
        {PROBLEM.cards.map((c) => (
          <article key={c.title} className="card card--pad">
            <span className="icon-badge tone-coral"><Icon name={c.icon} /></span>
            <h3 className="card__title">{c.title}</h3>
            <p className="muted">{c.text}</p>
          </article>
        ))}
      </div>
      <div className="problem__bottom">
        <blockquote className="callout">{PROBLEM.quote}</blockquote>
        <div className="card card--pad">
          <p className="label">Documents we cover</p>
          <div className="chips">
            {PROBLEM.docs.map((d) => <span key={d} className="chip">{d}</span>)}
          </div>
          <p className="label mt">The gap we close</p>
          <p className="gap">{PROBLEM.gap}</p>
        </div>
      </div>
    </Section>
  );
}
