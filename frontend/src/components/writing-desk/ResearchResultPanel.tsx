"use client";

type Citation = {
  label: string;
  url?: string;
  note?: string;
};

type ResearchResultPanelProps = {
  letterBody: string;
  citations: Citation[];
  mpSnapshot: any;
  addressSnapshot: any;
  researchModel?: string | null;
  updatedAt?: string | null;
  onCopyLetter: () => void;
  copyStatus: 'idle' | 'copied';
};

export default function ResearchResultPanel({
  letterBody,
  citations,
  mpSnapshot,
  addressSnapshot,
  researchModel,
  updatedAt,
  onCopyLetter,
  copyStatus,
}: ResearchResultPanelProps) {
  const mpName = mpSnapshot?.mp?.name ?? 'Member of Parliament';
  const mpAddress = mpSnapshot?.mp?.parliamentaryAddress ?? 'House of Commons\nLondon\nSW1A 0AA';
  const addressLines = formatAddress(addressSnapshot);

  return (
    <section className="card" aria-labelledby="research-results" style={{ marginTop: 16 }}>
      <div className="container" style={{ display: 'grid', gap: 20 }}>
        <header className="section-header" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 id="research-results" className="section-title" style={{ fontSize: 20 }}>
              Draft letter ready to send
            </h2>
            <p className="section-sub" style={{ marginTop: 4 }}>
              Copy everything below into your preferred editor or printer. We included your address block and the MP mailing address.
            </p>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-primary" onClick={onCopyLetter}>
              {copyStatus === 'copied' ? 'Copied!' : 'Copy letter'}
            </button>
          </div>
        </header>

        <div style={{ background: '#f3f4f6', borderRadius: 12, padding: 16 }}>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
              fontSize: 14,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {letterBody}
          </pre>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <h3 className="label" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>Addresses on file</h3>
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>Your address</p>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6 }}>{addressLines || 'Add your address on the dashboard to include it here.'}</pre>
              </div>
              <div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{mpName}</p>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6 }}>{mpAddress}</pre>
              </div>
            </div>
          </div>

          <div>
            <h3 className="label" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>Citations</h3>
            {citations.length === 0 ? (
              <p style={{ marginTop: 6 }}>No citations were returned for this draft.</p>
            ) : (
              <ol style={{ marginTop: 6, paddingLeft: 20, display: 'grid', gap: 6 }}>
                {citations.map((citation, index) => (
                  <li key={index}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span>{citation.label}</span>
                      {citation.url && (
                        <a href={citation.url} target="_blank" rel="noreferrer" className="link">
                          {citation.url}
                        </a>
                      )}
                      {citation.note && <span style={{ color: '#4b5563' }}>{citation.note}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <footer style={{ fontSize: 12, color: '#6b7280' }}>
            {researchModel && <span>Generated with {researchModel}. </span>}
            {updatedAt && <span>Completed {new Date(updatedAt).toLocaleString()}</span>}
          </footer>
        </div>
      </div>
    </section>
  );
}

function formatAddress(address: any) {
  if (!address) return '';
  const parts = [address.line1, address.line2, address.city, address.county, address.postcode]
    .map((part: any) => (part ? String(part).trim() : ''))
    .filter((part: string) => part.length > 0);
  return parts.join('\n');
}
