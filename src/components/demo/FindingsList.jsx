import { citationLabel } from '../../lib/citation.js';
import { FILTERS } from './filters.js';

function crossDoc(f) {
  return f.layer === 'Cross-document';
}

export default function FindingsList({ findings, filter, onFilter, activeId, onSelect, counts, scopeLabel }) {
  return (
    <div className="findings">
      <div className="findings__head">
        <h3>Findings ({findings.length}) <span className="muted small">· {scopeLabel}</span></h3>
      </div>
      <div className="tabs" role="tablist" aria-label="Filter findings">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`tab ${filter === f.key ? 'is-active' : ''}`}
            onClick={() => onFilter(f.key)}
          >
            {f.label} <span className="tab__count">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {findings.length === 0 ? (
        <p className="empty muted">No findings of this kind.</p>
      ) : (
        <ul className="findings__list">
          {findings.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className={`finding ${activeId === f.id ? 'is-active' : ''}`}
                onClick={() => onSelect(f)}
                aria-pressed={activeId === f.id}
              >
                <span className={`badge sev-${f.severity}`}>{f.severity}</span>
                <span className="finding__body">
                  <span className="finding__label">{f.label}</span>
                  {(f.value || f.note) && (
                    <span className="finding__value">
                      {f.value}
                      {f.note ? <span className="muted"> · {f.note}</span> : null}
                    </span>
                  )}
                  {f.derived && <span className="finding__derived">= {f.derived}</span>}
                  <span className="finding__meta">
                    <span className="cite">↳ {crossDoc(f) ? 'cross-doc · ' : ''}{citationLabel(f.source)}</span>
                    <span className="muted">{f.layer}</span>
                    <span className="muted" title="Confidence">{Math.round((f.confidence || 0) * 100)}%</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
