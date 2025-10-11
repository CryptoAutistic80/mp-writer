import { WritingDeskLetterTone } from '../types';

export interface StoredLetterMetadataInput {
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

export interface SaveStoredLetterPayload {
  letterHtml: string;
  letterJson?: string | null;
  jobId?: string | null;
  responseId?: string | null;
  tone?: WritingDeskLetterTone | null;
  references: string[];
  metadata: StoredLetterMetadataInput;
}

export interface SaveStoredLetterResponse {
  letterId: string;
  savedAt: string;
  tone: WritingDeskLetterTone | null;
  mpName: string;
}

export async function saveStoredLetter(payload: SaveStoredLetterPayload): Promise<SaveStoredLetterResponse> {
  const res = await fetch('/api/writing-desk/letters', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      letterHtml: payload.letterHtml,
      letterJson: payload.letterJson ?? null,
      jobId: payload.jobId ?? null,
      responseId: payload.responseId ?? null,
      tone: payload.tone ?? null,
      references: payload.references,
      metadata: payload.metadata,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const data = (await res.json().catch(() => null)) as SaveStoredLetterResponse | null;
  if (!data || typeof data.letterId !== 'string' || typeof data.savedAt !== 'string') {
    throw new Error('We could not save your letter. Please try again.');
  }

  return data;
}
