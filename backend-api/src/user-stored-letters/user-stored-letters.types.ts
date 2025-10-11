import type {
  WritingDeskLetterTone as WritingDeskLetterToneContract,
} from '../writing-desk-jobs/writing-desk-jobs.types';

export type WritingDeskLetterTone = WritingDeskLetterToneContract;

export interface StoredLetterMetadata {
  mpName: string;
  mpAddress1: string;
  mpAddress2: string;
  mpCity: string;
  mpCounty: string;
  mpPostcode: string;
  date: string;
  senderName: string;
  senderAddress1: string;
  senderAddress2: string;
  senderAddress3: string;
  senderCity: string;
  senderCounty: string;
  senderPostcode: string;
  senderTelephone: string;
}

export interface StoredLetterPayload {
  jobId: string | null;
  letterHtml: string;
  letterJson: string | null;
  references: string[];
  responseId: string | null;
  tone: WritingDeskLetterTone | null;
  metadata: StoredLetterMetadata;
}

export interface UserStoredLetterRecord {
  id: string;
  letterId: string;
  userId: string;
  ciphertext: string;
  mpName: string;
  tone: WritingDeskLetterTone | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserStoredLetterResource {
  letterId: string;
  savedAt: string;
  tone: WritingDeskLetterTone | null;
  mpName: string;
}
