import { ActiveWritingDeskJob } from '../types';

interface StartResearchResponse {
  job: ActiveWritingDeskJob;
  remainingCredits: number | null;
}

export async function startWritingDeskResearch(): Promise<StartResearchResponse> {
  const res = await fetch('/api/writing-desk/jobs/active/research/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const data = (await res.json().catch(() => null)) as StartResearchResponse | null;
  if (!data || !data.job) {
    throw new Error('Unexpected response when starting research');
  }
  return data;
}

export async function fetchWritingDeskResearchStatus(): Promise<ActiveWritingDeskJob> {
  const res = await fetch('/api/writing-desk/jobs/active/research/status', {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const data = (await res.json().catch(() => null)) as ActiveWritingDeskJob | null;
  if (!data) {
    throw new Error('Unexpected response when polling research');
  }
  return data;
}
