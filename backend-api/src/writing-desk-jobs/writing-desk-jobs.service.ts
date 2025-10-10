import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UpsertActiveWritingDeskJobDto } from './dto/upsert-active-writing-desk-job.dto';
import { WritingDeskJobsRepository } from './writing-desk-jobs.repository';
import {
  ActiveWritingDeskJobResource,
  WritingDeskJobSnapshot,
  WritingDeskJobFormSnapshot,
  WritingDeskJobRecord,
  WRITING_DESK_LETTER_STATUSES,
  WRITING_DESK_LETTER_TONES,
  WRITING_DESK_RESEARCH_STATUSES,
  WritingDeskLetterStatus,
  WritingDeskLetterTone,
  WritingDeskResearchStatus,
} from './writing-desk-jobs.types';
import { EncryptionService } from '../crypto/encryption.service';

@Injectable()
export class WritingDeskJobsService {
  constructor(
    private readonly repository: WritingDeskJobsRepository,
    private readonly encryption: EncryptionService,
  ) {}

  async getActiveJobForUser(userId: string): Promise<ActiveWritingDeskJobResource | null> {
    const record = await this.repository.findActiveByUserId(userId);
    if (!record) return null;
    const snapshot = this.toSnapshot(record);
    return this.toResource(snapshot);
  }

  async upsertActiveJob(
    userId: string,
    input: UpsertActiveWritingDeskJobDto,
  ): Promise<ActiveWritingDeskJobResource> {
    const existing = await this.repository.findActiveByUserId(userId);
    const sanitized = this.sanitiseInput(input);
    const nextJobId = this.resolveJobId(existing, input.jobId);
    const payload = {
      jobId: nextJobId,
      phase: sanitized.phase,
      stepIndex: sanitized.stepIndex,
      followUpIndex: sanitized.followUpIndex,
      followUpQuestionsCiphertext: this.encryption.encryptObject(sanitized.followUpQuestions),
      formCiphertext: this.encryption.encryptObject(sanitized.form),
      followUpAnswersCiphertext: this.encryption.encryptObject(sanitized.followUpAnswers),
      notesCiphertext: this.encryption.encryptObject(sanitized.notes),
      responseId: sanitized.responseId,
      researchContentCiphertext: this.encryption.encryptObject(sanitized.researchContent),
      researchResponseId: sanitized.researchResponseId,
      researchStatus: sanitized.researchStatus,
      letterStatus: sanitized.letterStatus,
      letterTone: sanitized.letterTone,
      letterResponseId: sanitized.letterResponseId,
      letterContentCiphertext: this.encryption.encryptObject(sanitized.letterContent),
      letterReferencesCiphertext: this.encryption.encryptObject(sanitized.letterReferences),
      letterJsonCiphertext: this.encryption.encryptObject(sanitized.letterJson),
    };

    const saved = await this.repository.upsertActiveJob(userId, payload);
    const snapshot = this.toSnapshot(saved);
    return this.toResource(snapshot);
  }

  async deleteActiveJob(userId: string): Promise<void> {
    await this.repository.deleteActiveJob(userId);
  }

  private resolveJobId(existing: { jobId: string } | null, requestedJobId: string | undefined) {
    if (!existing) {
      return requestedJobId && this.isUuid(requestedJobId) ? requestedJobId : randomUUID();
    }
    if (requestedJobId && existing.jobId === requestedJobId) {
      return existing.jobId;
    }
    return randomUUID();
  }

  private sanitiseInput(input: UpsertActiveWritingDeskJobDto) {
    const trim = (value: string | undefined | null) => (typeof value === 'string' ? value : '');
    const trimNullable = (value: string | undefined) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    const normaliseMultiline = (value: string | undefined) => {
      if (typeof value !== 'string') return null;
      const normalised = value.replace(/\r\n/g, '\n');
      return normalised.trim().length > 0 ? normalised : null;
    };

    const form: WritingDeskJobFormSnapshot = {
      issueDescription: trim(input.form?.issueDescription),
    };

    const followUpQuestions = Array.isArray(input.followUpQuestions)
      ? input.followUpQuestions.map((value) => trim(value))
      : [];

    const followUpAnswers = Array.isArray(input.followUpAnswers)
      ? input.followUpAnswers.map((value) => trim(value))
      : [];

    const maxFollowUps = followUpQuestions.length;
    const alignedAnswers = followUpAnswers.slice(0, maxFollowUps);
    while (alignedAnswers.length < maxFollowUps) {
      alignedAnswers.push('');
    }

    const stepIndex = Number.isFinite(input.stepIndex) && input.stepIndex >= 0 ? Math.floor(input.stepIndex) : 0;
    const followUpIndex = Number.isFinite(input.followUpIndex) && input.followUpIndex >= 0
      ? Math.min(Math.floor(input.followUpIndex), Math.max(maxFollowUps - 1, 0))
      : 0;

    const rawStatus = typeof input.researchStatus === 'string' ? input.researchStatus.trim() : '';
    const researchStatus = (WRITING_DESK_RESEARCH_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as WritingDeskResearchStatus)
      : 'idle';

    const rawLetterStatus = typeof input.letterStatus === 'string' ? input.letterStatus.trim() : '';
    const letterStatus = (WRITING_DESK_LETTER_STATUSES as readonly string[]).includes(rawLetterStatus)
      ? (rawLetterStatus as WritingDeskLetterStatus)
      : 'idle';

    const rawLetterTone = typeof input.letterTone === 'string' ? input.letterTone.trim() : '';
    const letterTone = (WRITING_DESK_LETTER_TONES as readonly string[]).includes(rawLetterTone)
      ? (rawLetterTone as WritingDeskLetterTone)
      : null;

    const letterReferences = Array.isArray(input.letterReferences)
      ? input.letterReferences
          .map((value) => trim(value))
          .filter((value) => value.length > 0)
      : [];

    return {
      phase: input.phase,
      stepIndex,
      followUpIndex,
      form,
      followUpQuestions,
      followUpAnswers: alignedAnswers,
      notes: trimNullable(input.notes),
      responseId: trimNullable(input.responseId),
      researchContent: normaliseMultiline(input.researchContent),
      researchResponseId: trimNullable(input.researchResponseId),
      researchStatus,
      letterStatus,
      letterTone,
      letterResponseId: trimNullable(input.letterResponseId),
      letterContent: normaliseMultiline(input.letterContent),
      letterReferences,
      letterJson: normaliseMultiline(input.letterJson),
    };
  }

  private toSnapshot(record: WritingDeskJobRecord): WritingDeskJobSnapshot {
    const form = this.decryptForm(record);
    const followUpQuestions = this.decryptFollowUpQuestions(record);
    const followUpAnswers = this.decryptFollowUpAnswers(record);
    const notes = this.decryptNotes(record);
    const researchContent = this.decryptResearchContent(record);
    const letterContent = this.decryptLetterContent(record);
    const letterReferences = this.decryptLetterReferences(record);
    const letterJson = this.decryptLetterJson(record);

    const createdAt = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt);
    const updatedAt = record.updatedAt instanceof Date ? record.updatedAt : new Date(record.updatedAt);

    return {
      jobId: record.jobId,
      userId: record.userId,
      phase: record.phase,
      stepIndex: record.stepIndex,
      followUpIndex: record.followUpIndex,
      form,
      followUpQuestions,
      followUpAnswers,
      notes,
      responseId: record.responseId ?? null,
      researchContent,
      researchResponseId: record.researchResponseId ?? null,
      researchStatus: (record as any)?.researchStatus ?? 'idle',
      letterStatus: (record as any)?.letterStatus ?? 'idle',
      letterTone: (record as any)?.letterTone ?? null,
      letterResponseId: (record as any)?.letterResponseId ?? null,
      letterContent,
      letterReferences,
      letterJson,
      createdAt,
      updatedAt,
    };
  }

  private decryptForm(record: WritingDeskJobRecord): WritingDeskJobFormSnapshot {
    if (record.formCiphertext) {
      try {
        return this.encryption.decryptObject<WritingDeskJobFormSnapshot>(record.formCiphertext);
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (record.form) {
      if (typeof (record.form as any)?.issueDescription === 'string') {
        return {
          issueDescription: (record.form as any).issueDescription ?? '',
        };
      }

      const legacyIssue = [
        record.form.issueDetail ?? '',
        record.form.affectedDetail ?? '',
        record.form.backgroundDetail ?? '',
        record.form.desiredOutcome ?? '',
      ]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
        .join('\n\n');

      return {
        issueDescription: legacyIssue,
      };
    }

    return {
      issueDescription: '',
    };
  }

  private decryptFollowUpAnswers(record: WritingDeskJobRecord): string[] {
    if (record.followUpAnswersCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string[]>(record.followUpAnswersCiphertext);
        if (Array.isArray(decrypted)) {
          return decrypted.map((value) => (typeof value === 'string' ? value : ''));
        }
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (Array.isArray(record.followUpAnswers)) {
      return record.followUpAnswers.map((value) => (typeof value === 'string' ? value : ''));
    }

    return [];
  }

  private decryptFollowUpQuestions(record: WritingDeskJobRecord): string[] {
    if ((record as any).followUpQuestionsCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string[]>((record as any).followUpQuestionsCiphertext);
        if (Array.isArray(decrypted)) {
          return decrypted.map((value) => (typeof value === 'string' ? value : ''));
        }
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (Array.isArray(record.followUpQuestions)) {
      return record.followUpQuestions.map((value) => (typeof value === 'string' ? value : ''));
    }

    return [];
  }

  private decryptNotes(record: WritingDeskJobRecord): string | null {
    if ((record as any).notesCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string | null>((record as any).notesCiphertext);
        return typeof decrypted === 'string' ? decrypted : null;
      } catch {
        // fall through to legacy/plain handling
      }
    }

    return record.notes ?? null;
  }

  private decryptResearchContent(record: WritingDeskJobRecord): string | null {
    if ((record as any).researchContentCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string | null>((record as any).researchContentCiphertext);
        return typeof decrypted === 'string' ? decrypted : null;
      } catch {
        // fall through to legacy/plain handling
      }
    }

    return record.researchContent ?? null;
  }

  private decryptLetterContent(record: WritingDeskJobRecord): string | null {
    if ((record as any).letterContentCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string | null>((record as any).letterContentCiphertext);
        return typeof decrypted === 'string' ? decrypted : null;
      } catch {
        // fall through to legacy/plain handling
      }
    }

    return record.letterContent ?? null;
  }

  private decryptLetterReferences(record: WritingDeskJobRecord): string[] {
    if ((record as any).letterReferencesCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string[]>((record as any).letterReferencesCiphertext);
        if (Array.isArray(decrypted)) {
          return decrypted.map((value) => (typeof value === 'string' ? value : ''));
        }
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (Array.isArray((record as any)?.letterReferences)) {
      return ((record as any).letterReferences as string[]).map((value) => (typeof value === 'string' ? value : ''));
    }

    return [];
  }

  private decryptLetterJson(record: WritingDeskJobRecord): string | null {
    if ((record as any).letterJsonCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string | null>((record as any).letterJsonCiphertext);
        return typeof decrypted === 'string' ? decrypted : null;
      } catch {
        // fall through to legacy/plain handling
      }
    }

    return (record as any)?.letterJson ?? null;
  }

  private toResource(snapshot: WritingDeskJobSnapshot): ActiveWritingDeskJobResource {
    return {
      jobId: snapshot.jobId,
      phase: snapshot.phase,
      stepIndex: snapshot.stepIndex,
      followUpIndex: snapshot.followUpIndex,
      form: snapshot.form,
      followUpQuestions: snapshot.followUpQuestions,
      followUpAnswers: snapshot.followUpAnswers,
      notes: snapshot.notes ?? null,
      responseId: snapshot.responseId ?? null,
      researchContent: snapshot.researchContent ?? null,
      researchResponseId: snapshot.researchResponseId ?? null,
      researchStatus: snapshot.researchStatus,
      letterStatus: snapshot.letterStatus,
      letterTone: snapshot.letterTone ?? null,
      letterResponseId: snapshot.letterResponseId ?? null,
      letterContent: snapshot.letterContent ?? null,
      letterReferences: Array.isArray(snapshot.letterReferences) ? snapshot.letterReferences : [],
      letterJson: snapshot.letterJson ?? null,
      createdAt: snapshot.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: snapshot.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
