import { FC, useMemo } from 'react';
import { WritingDeskResearchStatus } from '../types';

interface ResearchProgressBarProps {
  progress: number;
  status: WritingDeskResearchStatus;
}

const STATUS_LABELS: Record<WritingDeskResearchStatus, string> = {
  idle: 'Waiting to start',
  queued: 'Queued with OpenAI',
  in_progress: 'Research underway',
  completed: 'Research complete',
  failed: 'Research failed',
  cancelled: 'Research cancelled',
};

const ResearchProgressBar: FC<ResearchProgressBarProps> = ({ progress, status }) => {
  const clamped = useMemo(() => {
    if (!Number.isFinite(progress)) return 0;
    if (progress < 0) return 0;
    if (progress > 100) return 100;
    return Math.round(progress);
  }, [progress]);

  const statusLabel = STATUS_LABELS[status] ?? 'Research status';
  const ariaLabel = `${statusLabel} (${clamped}% complete)`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>{statusLabel}</span>
        <span style={{ fontSize: '0.9rem', color: '#4b5563' }}>{clamped}%</span>
      </div>
      <div style={{ marginTop: 8, height: 8, background: '#e5e7eb', borderRadius: 999 }}>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
          aria-label={ariaLabel}
          style={{
            width: `${clamped}%`,
            height: '100%',
            background: status === 'failed' ? '#b91c1c' : status === 'completed' ? '#16a34a' : '#2563eb',
            borderRadius: 999,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
};

export default ResearchProgressBar;
