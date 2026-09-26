import { TEAM } from '../data/content.js';

export default function Team() {
  return (
    <section id="team" className="section team" aria-labelledby="team-title">
      <div className="container team__inner">
        <h2 id="team-title" className="team__title">{TEAM.title}</h2>
        <p className="team__brand">DocTrace <b>AI</b></p>
        <p className="lead">{TEAM.line}</p>
        <p className="hero__tagline">{TEAM.tagline}</p>
        <p className="label mt-lg">{TEAM.name}</p>
        <ul className="members">
          {TEAM.members.map((m) => (
            <li key={m.name} className="member card">
              <span className="avatar" aria-hidden="true">{m.initials}</span>
              <strong>{m.name}</strong>
              <span className="muted small">{m.role}</span>
            </li>
          ))}
        </ul>
      </div>
      <footer className="footer container">
        <span>© 2026 Team Binary Beasts · DocTrace AI · Zero Origin Hackathon 2026</span>
        <a href="#top">Back to top ↑</a>
      </footer>
    </section>
  );
}
