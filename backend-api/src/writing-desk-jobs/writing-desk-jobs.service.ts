import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UpsertActiveWritingDeskJobDto } from './dto/upsert-active-writing-desk-job.dto';
import { WritingDeskJobsRepository } from './writing-desk-jobs.repository';
import {
  ActiveWritingDeskJobResource,
  WritingDeskJobSnapshot,
  WritingDeskJobFormSnapshot,
  WritingDeskJobRecord,
  WritingDeskJobResearchSnapshot,
  WritingDeskJobResearchActivity,
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
    const sanitized = this.sanitiseInput(input, existing);
    const nextJobId = this.resolveJobId(existing, input.jobId);
    const payload = {
      jobId: nextJobId,
      phase: sanitized.phase,
      stepIndex: sanitized.stepIndex,
      followUpIndex: sanitized.followUpIndex,
      followUpQuestions: sanitized.followUpQuestions,
      formCiphertext: this.encryption.encryptObject(sanitized.form),
      followUpAnswersCiphertext: this.encryption.encryptObject(sanitized.followUpAnswers),
      notes: sanitized.notes,
      responseId: sanitized.responseId,
      researchStateCiphertext:
        typeof sanitized.research === 'undefined'
          ? undefined
          : sanitized.research
            ? this.encryption.encryptObject(sanitized.research)
            : null,
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

  private sanitiseInput(input: UpsertActiveWritingDeskJobDto, existing: WritingDeskJobRecord | null) {
    const trim = (value: string | undefined | null) => (typeof value === 'string' ? value : '');
    const trimNullable = (value: string | undefined) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const form: WritingDeskJobFormSnapshot = {
      issueDetail: trim(input.form?.issueDetail),
      affectedDetail: trim(input.form?.affectedDetail),
      backgroundDetail: trim(input.form?.backgroundDetail),
      desiredOutcome: trim(input.form?.desiredOutcome),
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

    return {
      phase: input.phase,
      stepIndex,
      followUpIndex,
      form,
      followUpQuestions,
      followUpAnswers: alignedAnswers,
      notes: trimNullable(input.notes),
      responseId: trimNullable(input.responseId),
      research: this.normaliseResearch(input.research, existing),
    };
  }

  private toSnapshot(record: WritingDeskJobRecord): WritingDeskJobSnapshot {
    const form = this.decryptForm(record);
    const followUpAnswers = this.decryptFollowUpAnswers(record);

    const createdAt = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt);
    const updatedAt = record.updatedAt instanceof Date ? record.updatedAt : new Date(record.updatedAt);

    return {
      jobId: record.jobId,
      userId: record.userId,
      phase: record.phase,
      stepIndex: record.stepIndex,
      followUpIndex: record.followUpIndex,
      form,
      followUpQuestions: record.followUpQuestions ?? [],
      followUpAnswers,
      notes: record.notes ?? null,
      responseId: record.responseId ?? null,
      research: this.decryptResearch(record),
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
      return {
        issueDetail: record.form.issueDetail ?? '',
        affectedDetail: record.form.affectedDetail ?? '',
        backgroundDetail: record.form.backgroundDetail ?? '',
        desiredOutcome: record.form.desiredOutcome ?? '',
      };
    }

    return {
      issueDetail: '',
      affectedDetail: '',
      backgroundDetail: '',
      desiredOutcome: '',
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

  private decryptResearch(record: WritingDeskJobRecord): WritingDeskJobResearchSnapshot | null {
    if (record.researchStateCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<WritingDeskJobResearchSnapshot>(
          record.researchStateCiphertext,
        );
        return this.normaliseResearchSnapshot(decrypted);
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (record.researchState) {
      return this.normaliseResearchSnapshot(record.researchState);
    }

    return null;
  }

  private normaliseResearch(
    research: UpsertActiveWritingDeskJobDto['research'],
    existing: WritingDeskJobRecord | null,
  ): WritingDeskJobResearchSnapshot | null | undefined {
    if (typeof research === 'undefined') {
      return undefined;
    }

    if (research === null) {
      return null;
    }

    const fallback = existing ? this.decryptResearch(existing) : null;

    const toDate = (value: string | null | undefined) => {
      if (typeof value !== 'string') return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const mapActivities = (activities: unknown): WritingDeskJobResearchActivity[] => {
      if (!Array.isArray(activities)) {
        return fallback?.activities ?? [];
      }

      return activities
        .map((activity) => {
          const createdAt = toDate((activity as any)?.createdAt) ?? new Date();
          return {
            id: typeof (activity as any)?.id === 'string' ? (activity as any).id : randomUUID(),
            type: typeof (activity as any)?.type === 'string' ? (activity as any).type : 'unknown',
            label: typeof (activity as any)?.label === 'string' ? (activity as any).label : 'Activity',
            status: typeof (activity as any)?.status === 'string' ? (activity as any).status : 'unknown',
            createdAt,
            url: typeof (activity as any)?.url === 'string' ? (activity as any).url : null,
          };
        })
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    };

    const clampProgress = (value: number | null | undefined) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return fallback?.progress ?? null;
      }
      return Math.max(0, Math.min(100, Math.round(value)));
    };

    const snapshot: WritingDeskJobResearchSnapshot = {
      status: research.status,
      startedAt: toDate(research.startedAt) ?? fallback?.startedAt ?? null,
      completedAt: toDate(research.completedAt) ?? fallback?.completedAt ?? null,
      updatedAt: toDate(research.updatedAt) ?? new Date(),
      responseId:
        typeof research.responseId === 'string'
          ? research.responseId
          : fallback?.responseId ?? null,
      outputText:
        typeof research.outputText === 'string'
          ? research.outputText
          : fallback?.outputText ?? null,
      progress: clampProgress(research.progress),
      activities: mapActivities(research.activities),
      error: typeof research.error === 'string' ? research.error : fallback?.error ?? null,
      creditsCharged:
        typeof research.creditsCharged === 'number'
          ? Math.round(research.creditsCharged * 100) / 100
          : fallback?.creditsCharged ?? null,
      billedAt: toDate(research.billedAt) ?? fallback?.billedAt ?? null,
    };

    return snapshot;
  }

  private normaliseResearchSnapshot(
    input: WritingDeskJobResearchSnapshot | null,
  ): WritingDeskJobResearchSnapshot | null {
    if (!input) return null;

    const toDate = (value: unknown) => this.asDateOrNull(value) ?? new Date();

    return {
      status: input.status,
      startedAt: this.asDateOrNull(input.startedAt),
      completedAt: this.asDateOrNull(input.completedAt),
      updatedAt: this.asDateOrNull(input.updatedAt) ?? new Date(),
      responseId: input.responseId ?? null,
      outputText: input.outputText ?? null,
      progress:
        typeof input.progress === 'number' && !Number.isNaN(input.progress)
          ? Math.max(0, Math.min(100, Math.round(input.progress)))
          : null,
      activities: Array.isArray(input.activities)
        ? input.activities.map((activity) => ({
            id: activity.id,
            type: activity.type,
            label: activity.label,
            status: activity.status,
            createdAt: toDate(activity.createdAt),
            url: activity.url ?? null,
          }))
        : [],
      error: input.error ?? null,
      creditsCharged:
        typeof input.creditsCharged === 'number'
          ? Math.round(input.creditsCharged * 100) / 100
          : null,
      billedAt: this.asDateOrNull(input.billedAt),
    };
  }

  private asDateOrNull(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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
      research: snapshot.research
        ? {
            status: snapshot.research.status,
            startedAt: snapshot.research.startedAt?.toISOString?.() ?? null,
            completedAt: snapshot.research.completedAt?.toISOString?.() ?? null,
            updatedAt: snapshot.research.updatedAt?.toISOString?.() ?? null,
            responseId: snapshot.research.responseId ?? null,
            outputText: snapshot.research.outputText ?? null,
            progress:
              typeof snapshot.research.progress === 'number'
                ? Math.max(0, Math.min(100, Math.round(snapshot.research.progress)))
                : null,
            activities: snapshot.research.activities.map((activity) => ({
              id: activity.id,
              type: activity.type,
              label: activity.label,
              status: activity.status,
              createdAt: activity.createdAt?.toISOString?.() ?? new Date().toISOString(),
              url: activity.url ?? null,
            })),
            error: snapshot.research.error ?? null,
            creditsCharged:
              typeof snapshot.research.creditsCharged === 'number'
                ? Math.round(snapshot.research.creditsCharged * 100) / 100
                : null,
            billedAt: snapshot.research.billedAt?.toISOString?.() ?? null,
          }
        : null,
      createdAt: snapshot.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: snapshot.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
