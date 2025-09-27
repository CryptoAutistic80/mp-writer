import { FC, useMemo } from 'react';
import { WritingDeskResearchAction } from '../types';

interface ResearchActivityFeedProps {
  actions: WritingDeskResearchAction[];
}

const ResearchActivityFeed: FC<ResearchActivityFeedProps> = ({ actions }) => {
  const items = useMemo(() => {
    return [...actions]
      .filter((action) => action.message?.trim?.())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [actions]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  if (items.length === 0) {
    return (
      <div>
        <h4 className="section-title" style={{ fontSize: '1rem', marginBottom: 8 }}>Latest research activity</h4>
        <p style={{ margin: 0, color: '#4b5563' }}>Waiting for the research agent to report back…</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="section-title" style={{ fontSize: '1rem', marginBottom: 8 }}>Latest research activity</h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((action) => (
          <li
            key={action.id}
            style={{
              padding: '8px 0',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>{action.message}</span>
            <span style={{ fontSize: '0.75rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatTime(action.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ResearchActivityFeed;
