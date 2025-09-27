export const WRITING_DESK_JOB_PHASES = ['initial', 'generating', 'followup', 'summary', 'research'] as const;

export type WritingDeskJobPhase = (typeof WRITING_DESK_JOB_PHASES)[number];

export const WRITING_DESK_RESEARCH_STATUSES = ['idle', 'queued', 'in_progress', 'completed', 'failed', 'cancelled'] as const;

export type WritingDeskResearchStatus = (typeof WRITING_DESK_RESEARCH_STATUSES)[number];

export interface WritingDeskResearchAction {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface WritingDeskResearchState {
  status: WritingDeskResearchStatus;
  progress: number;
  actions: WritingDeskResearchAction[];
  result: string | null;
  responseId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  billedCredits: number | null;
}

export interface WritingDeskJobFormSnapshot {
  issueDetail: string;
  affectedDetail: string;
  backgroundDetail: string;
  desiredOutcome: string;
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
  research: WritingDeskResearchState;
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
  research?: WritingDeskResearchState;
}
