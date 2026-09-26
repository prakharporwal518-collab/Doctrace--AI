// Short human label for where a finding came from: "p.2 · L18 · cl.7.2"
export function citationLabel(source) {
  if (!source) return 'no source';
  if (source.schema) return `schema: ${source.field}`;
  const parts = [`p.${source.page}`, `L${source.line}`];
  if (source.clause) parts.push(`cl.${source.clause}`);
  return parts.join(' · ');
}
