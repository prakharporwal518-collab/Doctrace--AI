import { HERO } from '../data/content.js';
import Icon from './Icon.jsx';

export default function Hero() {
  return (
    <section id="top" className="hero">
      <div className="container hero__grid">
        <div className="hero__copy">
          <p className="kicker">{HERO.eyebrow}</p>
          <h1 className="hero__title">{HERO.title}</h1>
          <p className="hero__desc">{HERO.description}</p>
          <p className="hero__tagline">{HERO.tagline}</p>
          <div className="hero__actions">
            <a href="#demo" className="btn btn--primary"><Icon name="play" size={16} /> Try the live demo</a>
            <a href="#traceability" className="btn btn--ghost">How traceability works <Icon name="arrow" size={16} /></a>
          </div>
          <div className="hero__meta">
            <span className="muted small">Presented by</span>
            <strong>{HERO.team}</strong>
            <span className="dot" aria-hidden="true" />
            <span>{HERO.event}</span>
          </div>
        </div>

        <div className="hero__card card" aria-label="Example of traced findings">
          <div className="hero__card-head">
            <Icon name="file" size={18} />
            <span className="mono">{HERO.card.file}</span>
          </div>
          <ul className="hero__rows">
            {HERO.card.rows.map((row, i) => (
              <li key={row.tag} className={`hero__row tone-${row.tone}`} style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
                <span className="hero__tag">{row.tag}</span>
                <span className="hero__value">{row.value}</span>
                <span className="cite">↳ {row.source}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
