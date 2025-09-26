export const WRITING_DESK_JOB_PHASES = ['initial', 'generating', 'followup', 'summary'] as const;

export type WritingDeskJobPhase = (typeof WRITING_DESK_JOB_PHASES)[number];

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
  createdAt: string;
  updatedAt: string;
}
