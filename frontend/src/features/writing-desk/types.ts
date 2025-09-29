export const WRITING_DESK_JOB_PHASES = ['initial', 'generating', 'followup', 'summary'] as const;

export type WritingDeskJobPhase = (typeof WRITING_DESK_JOB_PHASES)[number];

export const WRITING_DESK_RESEARCH_STATUSES = ['idle', 'running', 'completed', 'error'] as const;

export type WritingDeskResearchStatus = (typeof WRITING_DESK_RESEARCH_STATUSES)[number];

export const WRITING_DESK_LETTER_STATUSES = ['idle', 'running', 'completed', 'error'] as const;

export type WritingDeskLetterStatus = (typeof WRITING_DESK_LETTER_STATUSES)[number];

export const WRITING_DESK_LETTER_TONES = ['formal', 'polite_but_firm', 'empathetic', 'urgent', 'neutral'] as const;

export type WritingDeskLetterTone = (typeof WRITING_DESK_LETTER_TONES)[number];

export interface WritingDeskJobFormSnapshot {
  issueDescription: string;
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
  researchContent: string | null;
  researchResponseId: string | null;
  researchStatus: WritingDeskResearchStatus;
  letterTone: WritingDeskLetterTone | null;
  letterContent: string | null;
  letterResponseId: string | null;
  letterStatus: WritingDeskLetterStatus;
  letterReferences: string[];
  letterResult: string | null;
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
  researchContent?: string | null;
  researchResponseId?: string | null;
  researchStatus?: WritingDeskResearchStatus;
  letterTone?: WritingDeskLetterTone | null;
  letterContent?: string | null;
  letterResponseId?: string | null;
  letterStatus?: WritingDeskLetterStatus;
  letterReferences?: string[];
  letterResult?: string | null;
}
