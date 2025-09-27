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

export type WritingDeskJobResearchStatus = (typeof WRITING_DESK_RESEARCH_STATUSES)[number];

export interface WritingDeskJobResearchActivity {
  id: string;
  type: string;
  label: string;
  status: string;
  createdAt: Date;
  url: string | null;
}

export interface WritingDeskJobResearchSnapshot {
  status: WritingDeskJobResearchStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date | null;
  responseId: string | null;
  outputText: string | null;
  progress: number | null;
  activities: WritingDeskJobResearchActivity[];
  error: string | null;
  creditsCharged: number | null;
  billedAt: Date | null;
}

export interface WritingDeskJobSnapshot {
  jobId: string;
  userId: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  form: WritingDeskJobFormSnapshot;
  followUpQuestions: string[];
  followUpAnswers: string[];
  notes: string | null;
  responseId: string | null;
  research: WritingDeskJobResearchSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WritingDeskJobRecord {
  jobId: string;
  userId: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  followUpQuestions: string[];
  formCiphertext?: string;
  followUpAnswersCiphertext?: string;
  form?: WritingDeskJobFormSnapshot;
  followUpAnswers?: string[];
  notes: string | null;
  responseId: string | null;
  researchStateCiphertext?: string | null;
  researchState?: WritingDeskJobResearchSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActiveWritingDeskJobResource {
  jobId: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  form: WritingDeskJobFormSnapshot;
  followUpQuestions: string[];
  followUpAnswers: string[];
  notes: string | null;
  responseId: string | null;
  research: {
    status: WritingDeskJobResearchStatus;
    startedAt: string | null;
    completedAt: string | null;
    updatedAt: string | null;
    responseId: string | null;
    outputText: string | null;
    progress: number | null;
    activities: Array<{
      id: string;
      type: string;
      label: string;
      status: string;
      createdAt: string;
      url: string | null;
    }>;
    error: string | null;
    creditsCharged: number | null;
    billedAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}
