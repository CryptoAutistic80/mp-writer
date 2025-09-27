export const WRITING_DESK_JOB_PHASES = ['initial', 'generating', 'followup', 'summary', 'research'] as const;

export type WritingDeskJobPhase = (typeof WRITING_DESK_JOB_PHASES)[number];

export const WRITING_DESK_RESEARCH_STATUSES = ['idle', 'queued', 'in_progress', 'completed', 'failed', 'cancelled'] as const;

export type WritingDeskResearchStatus = (typeof WRITING_DESK_RESEARCH_STATUSES)[number];

export interface WritingDeskResearchActionSnapshot {
  id: string;
  type: string;
  message: string;
  createdAt: Date;
}

export interface WritingDeskJobResearchSnapshot {
  status: WritingDeskResearchStatus;
  progress: number;
  actions: WritingDeskResearchActionSnapshot[];
  result: string | null;
  responseId: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  billedCredits: number | null;
  cursor: number;
}

export interface WritingDeskJobFormSnapshot {
  issueDetail: string;
  affectedDetail: string;
  backgroundDetail: string;
  desiredOutcome: string;
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
  research: WritingDeskJobResearchSnapshot;
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
  researchStatus?: WritingDeskResearchStatus;
  researchProgress?: number;
  researchActions?: WritingDeskResearchActionSnapshot[];
  researchResult?: string | null;
  researchResponseId?: string | null;
  researchError?: string | null;
  researchStartedAt?: Date | null;
  researchCompletedAt?: Date | null;
  researchBilledCredits?: number | null;
  researchCursor?: number | null;
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
    status: WritingDeskResearchStatus;
    progress: number;
    actions: Array<{
      id: string;
      type: string;
      message: string;
      createdAt: string;
    }>;
    result: string | null;
    responseId: string | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    billedCredits: number | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface WritingDeskJobPersistencePayload {
  jobId: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  followUpQuestions: string[];
  formCiphertext: string;
  followUpAnswersCiphertext: string;
  notes: string | null;
  responseId: string | null;
  researchStatus: WritingDeskResearchStatus;
  researchProgress: number;
  researchActions: WritingDeskResearchActionSnapshot[];
  researchResult: string | null;
  researchResponseId: string | null;
  researchError: string | null;
  researchStartedAt: Date | null;
  researchCompletedAt: Date | null;
  researchBilledCredits: number | null;
  researchCursor: number;
}

export interface WritingDeskJobResearchUpdatePayload {
  phase: WritingDeskJobPhase;
  researchStatus: WritingDeskResearchStatus;
  researchProgress: number;
  researchActions: WritingDeskResearchActionSnapshot[];
  researchResult: string | null;
  researchResponseId: string | null;
  researchError: string | null;
  researchStartedAt: Date | null;
  researchCompletedAt: Date | null;
  researchBilledCredits: number | null;
  researchCursor: number;
}
