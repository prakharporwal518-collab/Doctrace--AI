export default function Section({ id, kicker, title, children, className = '' }) {
  return (
    <section id={id} className={`section ${className}`} aria-labelledby={`${id}-title`}>
      <div className="container">
        <p className="kicker">{kicker}</p>
        <h2 id={`${id}-title`} className="section__title">{title}</h2>
        {children}
      </div>
    </section>
  );
}
