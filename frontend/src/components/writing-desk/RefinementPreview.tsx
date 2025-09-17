"use client";

type RefinementPreviewProps = {
  refinement: {
    summary: string;
    keyPoints: string[];
    toneSuggestions: string[];
    followUpQuestions?: string[];
    model?: string | null;
  };
  onEdit: () => void;
  onReRun: () => void;
  onRunResearch: () => void;
  researchDisabled?: boolean;
  researchLoading?: boolean;
};

export default function RefinementPreview({
  refinement,
  onEdit,
  onReRun,
  onRunResearch,
  researchDisabled = false,
  researchLoading = false,
}: RefinementPreviewProps) {
  const hasFollowUps = Array.isArray(refinement.followUpQuestions) && refinement.followUpQuestions.length > 0;

  return (
    <div className="refinement-preview" style={{ display: 'grid', gap: 16 }}>
      <section aria-labelledby="refinement-summary" className="card" style={{ margin: 0 }}>
        <div className="container" style={{ display: 'grid', gap: 16 }}>
          <header className="section-header" style={{ alignItems: 'flex-start' }}>
            <div>
              <h2 id="refinement-summary" className="section-title" style={{ fontSize: 20 }}>
                Refined summary
              </h2>
              <p className="section-sub" style={{ marginTop: 4 }}>
                Here&apos;s what we heard. Edit your brief or re-run refinement if something looks off.
              </p>
            </div>
            <div className="header-actions" style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onEdit}>
                Edit brief
              </button>
              <button type="button" className="btn-secondary" onClick={onReRun}>
                Re-run refinement
              </button>
            </div>
          </header>

          <article style={{ display: 'grid', gap: 12 }}>
            <div>
              <h3 className="label" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>Summary</h3>
              <p style={{ marginTop: 4, lineHeight: 1.6 }}>{refinement.summary}</p>
            </div>

            <div>
              <h3 className="label" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>Key points</h3>
              <ul style={{ marginTop: 6, paddingLeft: 20, display: 'grid', gap: 6 }}>
                {refinement.keyPoints.map((point, index) => (
                  <li key={index} style={{ lineHeight: 1.5 }}>{point}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="label" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>Suggested tone</h3>
              <p style={{ marginTop: 4 }}>
                {refinement.toneSuggestions.join(', ')}
              </p>
            </div>

            {hasFollowUps && (
              <div>
                <h3 className="label" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.4 }}>Questions to clarify</h3>
                <ul style={{ marginTop: 6, paddingLeft: 20, display: 'grid', gap: 6 }}>
                  {refinement.followUpQuestions!.map((question, index) => (
                    <li key={index} style={{ lineHeight: 1.5 }}>{question}</li>
                  ))}
                </ul>
              </div>
            )}

            {refinement.model && (
              <p style={{ fontSize: 12, color: '#6b7280' }}>
                Generated with {refinement.model}
              </p>
            )}
          </article>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={onRunResearch}
              disabled={researchDisabled || researchLoading}
              aria-busy={researchLoading}
            >
              {researchLoading ? 'Running deep research…' : 'Run deep research'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
