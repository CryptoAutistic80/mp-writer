export const WRITING_DESK_JOB_PHASES = ['initial', 'generating', 'followup', 'summary'] as const;

export type WritingDeskJobPhase = (typeof WRITING_DESK_JOB_PHASES)[number];

export const WRITING_DESK_RESEARCH_STATUSES = ['idle', 'running', 'completed', 'error'] as const;

export type WritingDeskResearchStatus = (typeof WRITING_DESK_RESEARCH_STATUSES)[number];

export const WRITING_DESK_LETTER_STATUSES = ['idle', 'generating', 'completed', 'error'] as const;

export type WritingDeskLetterStatus = (typeof WRITING_DESK_LETTER_STATUSES)[number];

export const WRITING_DESK_LETTER_TONES = [
  'formal',
  'polite_but_firm',
  'empathetic',
  'urgent',
  'neutral',
  'highly_persuasive',
] as const;

export type WritingDeskLetterTone = (typeof WRITING_DESK_LETTER_TONES)[number];

export interface WritingDeskJobFormSnapshot {
  issueDescription: string;
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
  researchContent: string | null;
  researchResponseId: string | null;
  researchStatus: WritingDeskResearchStatus;
  letterStatus: WritingDeskLetterStatus;
  letterTone: WritingDeskLetterTone | null;
  letterResponseId: string | null;
  letterContent: string | null;
  letterReferences: string[];
  letterJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WritingDeskJobRecord {
  jobId: string;
  userId: string;
  phase: WritingDeskJobPhase;
  stepIndex: number;
  followUpIndex: number;
  followUpQuestionsCiphertext?: string;
  followUpQuestions: string[];
  formCiphertext?: string;
  followUpAnswersCiphertext?: string;
  form?: WritingDeskJobFormSnapshot & {
    issueDetail?: string;
    affectedDetail?: string;
    backgroundDetail?: string;
    desiredOutcome?: string;
  };
  followUpAnswers?: string[];
  notesCiphertext?: string;
  notes: string | null;
  responseId: string | null;
  researchContentCiphertext?: string;
  researchContent: string | null;
  researchResponseId: string | null;
  researchStatus: WritingDeskResearchStatus;
  letterStatus: WritingDeskLetterStatus;
  letterTone: WritingDeskLetterTone | null;
  letterResponseId: string | null;
  letterContentCiphertext?: string;
  letterContent: string | null;
  letterReferencesCiphertext?: string;
  letterReferences: string[];
  letterJsonCiphertext?: string;
  letterJson: string | null;
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
  researchContent: string | null;
  researchResponseId: string | null;
  researchStatus: WritingDeskResearchStatus;
  letterStatus: WritingDeskLetterStatus;
  letterTone: WritingDeskLetterTone | null;
  letterResponseId: string | null;
  letterContent: string | null;
  letterReferences: string[];
  letterJson: string | null;
  createdAt: string;
  updatedAt: string;
}
