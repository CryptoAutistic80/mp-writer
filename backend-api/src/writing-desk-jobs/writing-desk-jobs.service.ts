import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { UpsertActiveWritingDeskJobDto } from './dto/upsert-active-writing-desk-job.dto';
import { WritingDeskJobsRepository } from './writing-desk-jobs.repository';
import {
  ActiveWritingDeskJobResource,
  WritingDeskJobPersistencePayload,
  WritingDeskJobSnapshot,
  WritingDeskJobFormSnapshot,
  WritingDeskJobRecord,
  WritingDeskJobResearchSnapshot,
  WritingDeskJobResearchUpdatePayload,
  WritingDeskResearchActionSnapshot,
  WritingDeskResearchStatus,
} from './writing-desk-jobs.types';
import { EncryptionService } from '../crypto/encryption.service';
import { UserCreditsService } from '../user-credits/user-credits.service';

const RESEARCH_CREDIT_COST = 0.7;
const MAX_RESEARCH_ACTIONS = 50;
const FINAL_RESEARCH_STATUSES: WritingDeskResearchStatus[] = ['completed', 'failed', 'cancelled'];

@Injectable()
export class WritingDeskJobsService {
  private readonly logger = new Logger(WritingDeskJobsService.name);
  private openaiClient: any | null = null;

  constructor(
    private readonly repository: WritingDeskJobsRepository,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
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
    const existingRecord = await this.repository.findActiveByUserId(userId);
    const existingSnapshot = existingRecord ? this.toSnapshot(existingRecord) : null;
    const sanitized = this.sanitiseInput(input, existingSnapshot);
    const nextJobId = this.resolveJobId(existingRecord, input.jobId);
    const payload: WritingDeskJobPersistencePayload = {
      jobId: nextJobId,
      phase: sanitized.phase,
      stepIndex: sanitized.stepIndex,
      followUpIndex: sanitized.followUpIndex,
      followUpQuestions: sanitized.followUpQuestions,
      formCiphertext: this.encryption.encryptObject(sanitized.form),
      followUpAnswersCiphertext: this.encryption.encryptObject(sanitized.followUpAnswers),
      notes: sanitized.notes,
      responseId: sanitized.responseId,
      researchStatus: sanitized.research.status,
      researchProgress: sanitized.research.progress,
      researchActions: sanitized.research.actions,
      researchResult: sanitized.research.result,
      researchResponseId: sanitized.research.responseId,
      researchError: sanitized.research.error,
      researchStartedAt: sanitized.research.startedAt,
      researchCompletedAt: sanitized.research.completedAt,
      researchBilledCredits: sanitized.research.billedCredits,
      researchCursor: sanitized.research.cursor,
    };

    const saved = await this.repository.upsertActiveJob(userId, payload);
    const snapshot = this.toSnapshot(saved);
    return this.toResource(snapshot);
  }

  async deleteActiveJob(userId: string): Promise<void> {
    await this.repository.deleteActiveJob(userId);
  }

  async startResearch(userId: string): Promise<{ job: ActiveWritingDeskJobResource; remainingCredits: number | null }> {
    const record = await this.repository.findActiveByUserId(userId);
    if (!record) {
      throw new NotFoundException('No active writing desk job found');
    }

    const snapshot = this.toSnapshot(record);
    const currentResearch = snapshot.research;
    if (!FINAL_RESEARCH_STATUSES.includes(currentResearch.status) && currentResearch.status !== 'idle') {
      const { credits } = await this.userCredits.getMine(userId);
      return { job: this.toResource(snapshot), remainingCredits: credits };
    }

    const { credits: remainingCredits } = await this.userCredits.deductFromMine(userId, RESEARCH_CREDIT_COST);
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    const researchModel = this.config.get<string>('OPENAI_DEEP_RESEARCH_MODEL')?.trim() || 'o4-mini-deep-research';
    const now = new Date();

    if (!apiKey) {
      const stubResult = this.buildStubResearch(snapshot);
      const stubUpdates: WritingDeskJobResearchUpdatePayload = {
        phase: 'research',
        researchStatus: 'completed',
        researchProgress: 100,
        researchActions: [],
        researchResult: stubResult,
        researchResponseId: 'dev-stub',
        researchError: null,
        researchStartedAt: now,
        researchCompletedAt: now,
        researchBilledCredits: RESEARCH_CREDIT_COST,
        researchCursor: 0,
      };
      const updated = await this.repository.updateResearchState(userId, stubUpdates);
      if (!updated) throw new NotFoundException('Unable to update research state');
      return { job: this.toResource(this.toSnapshot(updated)), remainingCredits };
    }

    try {
      const client = await this.getOpenAiClient(apiKey);
      const vectorStoreIds = this.parseVectorStoreIds();
      const prompt = this.buildResearchPrompt(snapshot);
      const tools = this.buildResearchTools(vectorStoreIds);

      const response = await client.responses.create({
        model: researchModel,
        input: prompt,
        background: true,
        store: true,
        reasoning: { effort: 'medium', summary: 'auto' },
        tools,
        metadata: {
          feature: 'writing-desk-research',
          jobId: snapshot.jobId,
        },
      });

      const status = this.mapOpenAiStatus(response?.status);
      const initialProgress = status === 'queued' ? 0 : status === 'completed' ? 100 : 5;
      const initialCursor = Array.isArray(response?.output) ? response.output.length : 0;

      const updates: WritingDeskJobResearchUpdatePayload = {
        phase: 'research',
        researchStatus: status,
        researchProgress: this.clampProgress(initialProgress),
        researchActions: [],
        researchResult: null,
        researchResponseId: response?.id ?? null,
        researchError: null,
        researchStartedAt: now,
        researchCompletedAt: null,
        researchBilledCredits: RESEARCH_CREDIT_COST,
        researchCursor: initialCursor,
      };

      const updated = await this.repository.updateResearchState(userId, updates);
      if (!updated) throw new NotFoundException('Unable to update research state');

      return { job: this.toResource(this.toSnapshot(updated)), remainingCredits };
    } catch (error) {
      await this.refundCredits(userId, RESEARCH_CREDIT_COST);
      this.logger.error(`Failed to start deep research for job ${snapshot.jobId}: ${(error as Error).message}`);
      throw error;
    }
  }

  async refreshResearchStatus(userId: string): Promise<ActiveWritingDeskJobResource | null> {
    const record = await this.repository.findActiveByUserId(userId);
    if (!record) return null;

    const snapshot = this.toSnapshot(record);
    const research = snapshot.research;

    if (!research.responseId || FINAL_RESEARCH_STATUSES.includes(research.status)) {
      return this.toResource(snapshot);
    }

    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return this.toResource(snapshot);
    }

    try {
      const client = await this.getOpenAiClient(apiKey);
      const response = await client.responses.retrieve(research.responseId);
      const updates = this.buildResearchUpdateFromResponse(snapshot, response);
      const updated = await this.repository.updateResearchState(userId, updates);
      if (!updated) throw new NotFoundException('Unable to update research state');
      return this.toResource(this.toSnapshot(updated));
    } catch (error) {
      this.logger.error(`Failed to refresh deep research for job ${snapshot.jobId}: ${(error as Error).message}`);
      const fallbackUpdates: WritingDeskJobResearchUpdatePayload = {
        phase: 'research',
        researchStatus: 'failed',
        researchProgress: 100,
        researchActions: research.actions,
        researchResult: research.result,
        researchResponseId: research.responseId,
        researchError: (error as Error)?.message ?? 'Deep research request failed',
        researchStartedAt: research.startedAt ?? new Date(),
        researchCompletedAt: new Date(),
        researchBilledCredits: research.billedCredits,
        researchCursor: research.cursor,
      };
      const updated = await this.repository.updateResearchState(userId, fallbackUpdates);
      if (!updated) throw new NotFoundException('Unable to update research state');
      return this.toResource(this.toSnapshot(updated));
    }
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

  private sanitiseInput(
    input: UpsertActiveWritingDeskJobDto,
    existing: WritingDeskJobSnapshot | null,
  ) {
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

    const research = existing?.research ?? this.buildDefaultResearchSnapshot();

    return {
      phase: input.phase,
      stepIndex,
      followUpIndex,
      form,
      followUpQuestions,
      followUpAnswers: alignedAnswers,
      notes: trimNullable(input.notes),
      responseId: trimNullable(input.responseId),
      research,
    };
  }

  private buildDefaultResearchSnapshot(): WritingDeskJobResearchSnapshot {
    return {
      status: 'idle',
      progress: 0,
      actions: [],
      result: null,
      responseId: null,
      error: null,
      startedAt: null,
      completedAt: null,
      billedCredits: null,
      cursor: 0,
    };
  }

  private toSnapshot(record: WritingDeskJobRecord): WritingDeskJobSnapshot {
    const form = this.decryptForm(record);
    const followUpAnswers = this.decryptFollowUpAnswers(record);
    const research = this.resolveResearchSnapshot(record);

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
      research,
      createdAt,
      updatedAt,
    };
  }

  private resolveResearchSnapshot(record: WritingDeskJobRecord): WritingDeskJobResearchSnapshot {
    const status = this.normaliseResearchStatus(record.researchStatus);
    const progress = typeof record.researchProgress === 'number' ? this.clampProgress(record.researchProgress) : 0;
    const rawActions = Array.isArray(record.researchActions) ? record.researchActions : [];

    const actions: WritingDeskResearchActionSnapshot[] = rawActions
      .map((item) => {
        const createdAt = item?.createdAt instanceof Date
          ? item.createdAt
          : item?.createdAt
            ? new Date(item.createdAt)
            : new Date();
        return {
          id: typeof item?.id === 'string' && item.id.trim().length > 0 ? item.id : randomUUID(),
          type: typeof item?.type === 'string' && item.type.trim().length > 0 ? item.type : 'activity',
          message: typeof item?.message === 'string' ? item.message : '',
          createdAt,
        };
      })
      .filter((action) => action.message.trim().length > 0);

    const startedAt = record.researchStartedAt
      ? record.researchStartedAt instanceof Date
        ? record.researchStartedAt
        : new Date(record.researchStartedAt)
      : null;

    const completedAt = record.researchCompletedAt
      ? record.researchCompletedAt instanceof Date
        ? record.researchCompletedAt
        : new Date(record.researchCompletedAt)
      : null;

    const billedCredits = typeof record.researchBilledCredits === 'number' ? record.researchBilledCredits : null;
    const cursor = typeof record.researchCursor === 'number' ? record.researchCursor : 0;

    return {
      status,
      progress,
      actions,
      result: record.researchResult ?? null,
      responseId: record.researchResponseId ?? null,
      error: record.researchError ?? null,
      startedAt,
      completedAt,
      billedCredits,
      cursor,
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
      research: this.researchSnapshotToResource(snapshot.research),
      createdAt: snapshot.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: snapshot.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  private researchSnapshotToResource(research: WritingDeskJobResearchSnapshot) {
    return {
      status: research.status,
      progress: this.clampProgress(research.progress),
      actions: research.actions
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(-MAX_RESEARCH_ACTIONS)
        .map((action) => ({
          id: action.id,
          type: action.type,
          message: action.message,
          createdAt: action.createdAt.toISOString(),
        })),
      result: research.result ?? null,
      responseId: research.responseId ?? null,
      error: research.error ?? null,
      startedAt: research.startedAt ? research.startedAt.toISOString() : null,
      completedAt: research.completedAt ? research.completedAt.toISOString() : null,
      billedCredits: research.billedCredits ?? null,
    };
  }

  private normaliseResearchStatus(value: string | null | undefined): WritingDeskResearchStatus {
    if (!value) return 'idle';
    switch (value) {
      case 'queued':
      case 'in_progress':
      case 'completed':
      case 'failed':
      case 'cancelled':
      case 'idle':
        return value;
      default:
        return 'in_progress';
    }
  }

  private clampProgress(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return Math.round(value * 10) / 10;
  }

  private async getOpenAiClient(apiKey: string) {
    if (this.openaiClient) return this.openaiClient;
    const { default: OpenAI } = await import('openai');
    this.openaiClient = new OpenAI({ apiKey, timeout: 1000 * 60 * 15 });
    return this.openaiClient;
  }

  private parseVectorStoreIds(): string[] {
    const raw = this.config.get<string>('OPENAI_DEEP_RESEARCH_VECTOR_STORE_IDS');
    if (!raw) return [];
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  }

  private buildResearchPrompt(snapshot: WritingDeskJobSnapshot): string {
    const followUps = snapshot.followUpQuestions
      .map((question, idx) => {
        const answer = snapshot.followUpAnswers[idx] ?? '';
        return `Follow-up ${idx + 1}:\nQuestion: ${question}\nAnswer: ${answer}`;
      })
      .join('\n\n');

    return `You are an expert researcher preparing evidence for a UK constituent's letter to their Member of Parliament.
Use credible, current sources (official statistics, government publications, reputable news, NGOs, academic papers).
Return only raw research notes, not the letter itself.

Context for the case:
- Issue detail: ${snapshot.form.issueDetail}
- Who is affected: ${snapshot.form.affectedDetail}
- Background: ${snapshot.form.backgroundDetail}
- Desired outcome: ${snapshot.form.desiredOutcome}

Additional clarifications:
${followUps || 'No additional follow-up answers were provided.'}

Task:
- Investigate the situation thoroughly.
- Provide organised bullet points grouped by theme (e.g. Impact, Legal obligations, Recent developments, Support avenues).
- Each bullet must include inline citations with the source title and a direct URL in Markdown.
- Highlight specific facts, statistics, quotes, deadlines, regulatory requirements, and authoritative guidance.
- Do not draft the letter or provide prose beyond the research notes.`;
  }

  private buildResearchTools(vectorStoreIds: string[]) {
    const tools: any[] = [{ type: 'web_search_preview' }];
    if (vectorStoreIds.length > 0) {
      tools.push({ type: 'file_search', vector_store_ids: vectorStoreIds });
    }
    tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
    return tools;
  }

  private mapOpenAiStatus(status: string | undefined): WritingDeskResearchStatus {
    switch (status) {
      case 'queued':
      case 'in_progress':
      case 'completed':
      case 'failed':
      case 'cancelled':
        return status;
      case 'requires_action':
      case 'cancelling':
        return 'in_progress';
      default:
        return 'in_progress';
    }
  }

  private buildResearchUpdateFromResponse(
    snapshot: WritingDeskJobSnapshot,
    response: any,
  ): WritingDeskJobResearchUpdatePayload {
    const current = snapshot.research;
    const status = this.mapOpenAiStatus(response?.status);
    const { actions, cursor } = this.extractResearchActions(current, response);
    const mergedActions = this.mergeActions(current.actions, actions);
    const progress = this.computeResearchProgress(status, current.progress, mergedActions.length);

    let result = current.result;
    if (status === 'completed') {
      result = this.extractResearchOutput(response) ?? current.result;
    }

    const error = status === 'failed' ? this.extractResearchError(response) ?? current.error : current.error;
    const completedAt = FINAL_RESEARCH_STATUSES.includes(status)
      ? new Date()
      : current.completedAt ?? null;

    return {
      phase: 'research',
      researchStatus: status,
      researchProgress: this.clampProgress(progress),
      researchActions: mergedActions,
      researchResult: result ?? null,
      researchResponseId: current.responseId,
      researchError: error ?? null,
      researchStartedAt: current.startedAt ?? new Date(),
      researchCompletedAt: completedAt,
      researchBilledCredits: current.billedCredits,
      researchCursor: cursor,
    };
  }

  private extractResearchActions(
    current: WritingDeskJobResearchSnapshot,
    response: any,
  ): { actions: WritingDeskResearchActionSnapshot[]; cursor: number } {
    const output = Array.isArray(response?.output) ? response.output : [];
    const startIndex = Math.max(0, current.cursor);
    const newItems = output.slice(startIndex);
    const now = new Date();

    const actions = newItems.flatMap((item: any) => this.convertOutputItemToActions(item, now));
    const cursor = output.length;
    return { actions, cursor };
  }

  private convertOutputItemToActions(item: any, fallbackDate: Date): WritingDeskResearchActionSnapshot[] {
    if (!item || typeof item !== 'object') return [];
    const baseCreatedAt = typeof item.created_at === 'number'
      ? new Date(item.created_at * 1000)
      : item.created_at instanceof Date
        ? item.created_at
        : fallbackDate;

    const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : randomUUID();
    const actions: WritingDeskResearchActionSnapshot[] = [];

    if (item.type === 'web_search_call') {
      const actionType = item?.action?.type ?? 'search';
      const query = item?.action?.query;
      const url = item?.action?.url ?? item?.action?.link;
      let message = 'Web search in progress';
      if (actionType === 'search' && typeof query === 'string') {
        message = `Searching web for "${query}"`;
      } else if (actionType === 'open_page' && typeof url === 'string') {
        message = `Opening source ${url}`;
      } else if (actionType === 'find_in_page' && typeof query === 'string') {
        message = `Scanning page for "${query}"`;
      }
      actions.push({ id, type: 'web_search', message, createdAt: baseCreatedAt });
    } else if (item.type === 'file_search_call') {
      const query = item?.action?.query;
      const message = typeof query === 'string'
        ? `Searching reference files for "${query}"`
        : 'Reviewing internal reference files';
      actions.push({ id, type: 'file_search', message, createdAt: baseCreatedAt });
    } else if (item.type === 'code_interpreter_call') {
      const message = 'Analysing findings with code interpreter';
      actions.push({ id, type: 'code_interpreter', message, createdAt: baseCreatedAt });
    }

    return actions;
  }

  private mergeActions(
    current: WritingDeskResearchActionSnapshot[],
    additional: WritingDeskResearchActionSnapshot[],
  ): WritingDeskResearchActionSnapshot[] {
    if (additional.length === 0) return current.slice(0);
    const existingById = new Map(current.map((action) => [action.id, action] as const));
    const merged = [...current];
    for (const action of additional) {
      if (!existingById.has(action.id)) {
        merged.push(action);
        existingById.set(action.id, action);
      }
    }
    return merged.slice(-MAX_RESEARCH_ACTIONS);
  }

  private computeResearchProgress(
    status: WritingDeskResearchStatus,
    currentProgress: number,
    actionCount: number,
  ): number {
    if (FINAL_RESEARCH_STATUSES.includes(status)) {
      return 100;
    }
    if (status === 'queued') {
      return Math.max(currentProgress, 5);
    }
    const base = Math.max(currentProgress, 10);
    const incremental = Math.min(95, base + actionCount * 8);
    return incremental;
  }

  private extractResearchOutput(response: any): string | null {
    if (!response) return null;
    if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
      return response.output_text;
    }
    const steps = Array.isArray(response?.output) ? response.output : [];
    for (const step of steps) {
      const contents = Array.isArray(step?.content) ? step.content : [];
      for (const content of contents) {
        if (typeof content?.text === 'string' && content.text.trim().length > 0) {
          return content.text;
        }
        if (content?.type === 'output_text' && typeof content?.content === 'string') {
          return content.content;
        }
      }
    }
    return null;
  }

  private extractResearchError(response: any): string | null {
    if (!response) return null;
    const message = response?.last_error?.message ?? response?.error?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
    return null;
  }

  private buildStubResearch(snapshot: WritingDeskJobSnapshot): string {
    return `DEV-STUB RESEARCH\n\nIssue summary:\n${snapshot.form.issueDetail}\n\nPotential avenues:\n- Highlight the impact on affected parties: ${snapshot.form.affectedDetail}\n- Reference any previous actions or background: ${snapshot.form.backgroundDetail}\n- Desired outcome: ${snapshot.form.desiredOutcome}\n\nFollow-up answers:\n${snapshot.followUpQuestions
      .map((question, idx) => `Q${idx + 1}: ${question}\nA${idx + 1}: ${snapshot.followUpAnswers[idx] ?? ''}`)
      .join('\n')}`;
  }

  private async refundCredits(userId: string, amount: number) {
    try {
      await this.userCredits.addToMine(userId, amount);
    } catch (err) {
      this.logger.error(`Failed to refund credits for user ${userId}: ${(err as Error).message}`);
    }
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
