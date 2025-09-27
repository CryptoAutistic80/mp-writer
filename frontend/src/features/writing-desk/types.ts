export const WRITING_DESK_JOB_PHASES = ['initial', 'generating', 'followup', 'summary', 'research'] as const;

export type WritingDeskJobPhase = (typeof WRITING_DESK_JOB_PHASES)[number];

export interface WritingDeskJobFormSnapshot {
  issueDetail: string;
  affectedDetail: string;
  backgroundDetail: string;
  desiredOutcome: string;
}

export const WRITING_DESK_RESEARCH_STATUSES = [
  'idle',
  'queued',
  'in_progress',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'requires_action',
] as const;

export type WritingDeskResearchStatus = (typeof WRITING_DESK_RESEARCH_STATUSES)[number];

export interface WritingDeskResearchActivity {
  id: string;
  type: string;
  label: string;
  status: string;
  createdAt: string;
  url: string | null;
}

export interface WritingDeskResearchState {
  status: WritingDeskResearchStatus;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  responseId: string | null;
  outputText: string | null;
  progress: number | null;
  activities: WritingDeskResearchActivity[];
  error: string | null;
  creditsCharged: number | null;
  billedAt: string | null;
}

export interface ActiveWritingDeskJob {
  jobId: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  form: WritingDeskJobFormSnapshot;
  followUpQuestions: string[];
  followUpAnswers: string[];
  notes: string | null;
  responseId: string | null;
  research: WritingDeskResearchState | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertActiveWritingDeskJobPayload {
  jobId?: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  form: WritingDeskJobFormSnapshot;
  followUpQuestions: string[];
  followUpAnswers: string[];
  notes?: string | null;
  responseId?: string | null;
  research?: WritingDeskResearchState | null;
}
