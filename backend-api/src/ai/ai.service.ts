import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { WritingDeskIntakeDto } from './dto/writing-desk-intake.dto';
import { WritingDeskFollowUpDto } from './dto/writing-desk-follow-up.dto';
import { WritingDeskResearchDto } from './dto/writing-desk-research.dto';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { WritingDeskJobsService } from '../writing-desk-jobs/writing-desk-jobs.service';
import {
  ActiveWritingDeskJobResource,
  WritingDeskJobResearchStatus,
} from '../writing-desk-jobs/writing-desk-jobs.types';

const FOLLOW_UP_CREDIT_COST = 0.1;
const RESEARCH_CREDIT_COST = 0.7;
const ALLOWED_WEB_SEARCH_CONTEXT_SIZES = new Set(['shallow', 'medium', 'deep']);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openaiClient: any | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
    private readonly jobs: WritingDeskJobsService,
  ) {}

  private async getOpenAiClient(apiKey: string) {
    if (this.openaiClient) return this.openaiClient;
    const { default: OpenAI } = await import('openai');
    this.openaiClient = new OpenAI({ apiKey });
    return this.openaiClient;
  }

  async generate(input: { prompt: string; model?: string }) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = input.model || this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    if (!apiKey) {
      // In dev without key, return a stub so flows work
      return { content: `DEV-STUB: ${input.prompt.slice(0, 120)}...` };
    }
    const client = await this.getOpenAiClient(apiKey);
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: input.prompt }],
      temperature: 0.7,
    });
    const content = resp.choices?.[0]?.message?.content ?? '';
    return { content };
  }

  async generateWritingDeskFollowUps(userId: string | null | undefined, input: WritingDeskIntakeDto) {
    if (!userId) {
      throw new BadRequestException('User account required');
    }

    const { credits: remainingAfterCharge } = await this.userCredits.deductFromMine(userId, FOLLOW_UP_CREDIT_COST);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('OPENAI_FOLLOW_UP_MODEL')?.trim() || 'gpt-5-mini';

    try {
      if (!apiKey) {
        const stubQuestions = this.buildStubFollowUps(input);
        this.logger.log(
          `[writing-desk step1] DEV-STUB ${JSON.stringify({
            model: 'dev-stub',
            input,
            followUpQuestions: stubQuestions,
          })}`,
        );
        return {
          model: 'dev-stub',
          responseId: 'dev-stub',
          followUpQuestions: stubQuestions,
          notes: null,
          remainingCredits: remainingAfterCharge,
        };
      }

      const client = await this.getOpenAiClient(apiKey);

      const instructions = `You help constituents prepare to write letters to their Members of Parliament.
From the provided information, identify up to three missing details that would materially strengthen the letter.
Ask at most three concise follow-up questions. If everything is already clear, return an empty list.
Focus on understanding the core issue better - ask about the nature of the problem, its impact, timeline, or context.
Do NOT ask for documents, permissions, names, addresses, or personal details. Only ask about the issue itself.`;

      const userSummary = `Issue detail:\n${input.issueDetail}\n\nAffected parties:\n${input.affectedDetail}\n\nSupporting background:\n${input.backgroundDetail}\n\nDesired outcome:\n${input.desiredOutcome}`;

      const response = await client.responses.create({
        model,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: instructions }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: userSummary }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'writing_desk_follow_up',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                questions: {
                  type: 'array',
                  description: 'Up to three clarifying follow-up questions for the user.',
                  maxItems: 3,
                  items: {
                    type: 'string',
                    description: 'A succinct question phrased conversationally.',
                  },
                },
                notes: {
                  type: 'string',
                  description: 'Optional short justification of why these questions matter.',
                  default: '',
                },
              },
              required: ['questions', 'notes'],
            },
          },
          verbosity: 'low',
        },
        reasoning: {
          effort: 'low',
          summary: null,
        },
        tools: [],
        store: true,
        include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
      });

      let parsed: { questions?: string[]; notes?: string } = {};
      const outputText = this.extractFirstText(response);
      if (outputText) {
        try {
          parsed = JSON.parse(outputText);
        } catch (err) {
          this.logger.warn(`Failed to parse follow-up response JSON: ${(err as Error).message}`);
        }
      }

      const followUpQuestions = Array.isArray(parsed.questions)
        ? parsed.questions.filter((q) => typeof q === 'string' && q.trim().length > 0)
        : [];

      const bundle = {
        model,
        responseId: (response as any)?.id ?? null,
        input,
        followUpQuestions,
        notes: parsed.notes,
      };
      this.logger.log(`[writing-desk step1] ${JSON.stringify(bundle)}`);

      return {
        model,
        responseId: (response as any)?.id ?? null,
        followUpQuestions,
        notes: parsed.notes ?? null,
        remainingCredits: remainingAfterCharge,
      };
    } catch (error) {
      await this.refundCredits(userId, FOLLOW_UP_CREDIT_COST);
      throw error;
    }
  }

  async recordWritingDeskFollowUps(input: WritingDeskFollowUpDto) {
    if (input.followUpQuestions.length !== input.followUpAnswers.length) {
      throw new BadRequestException('Answers must be provided for each follow-up question');
    }

    const cleanedQuestions = input.followUpQuestions.map((question) => question?.toString?.().trim?.() ?? '');
    const cleanedAnswers = input.followUpAnswers.map((answer) => answer?.trim?.() ?? '');
    if (cleanedAnswers.some((answer) => !answer)) {
      throw new BadRequestException('Follow-up answers cannot be empty');
    }

    const bundle = {
      issueDetail: input.issueDetail.trim(),
      affectedDetail: input.affectedDetail.trim(),
      backgroundDetail: input.backgroundDetail.trim(),
      desiredOutcome: input.desiredOutcome.trim(),
      followUpQuestions: cleanedQuestions,
      followUpAnswers: cleanedAnswers,
      notes: input.notes?.trim?.() || null,
      responseId: input.responseId ?? null,
      recordedAt: new Date().toISOString(),
    };

    this.logger.log(`[writing-desk step1-answers] ${JSON.stringify(bundle)}`);

    return { ok: true };
  }

  async startWritingDeskResearch(userId: string | null | undefined, input: WritingDeskResearchDto) {
    if (!userId) {
      throw new BadRequestException('User account required');
    }

    const startedAt = new Date();
    const { credits: remainingAfterCharge } = await this.userCredits.deductFromMine(
      userId,
      RESEARCH_CREDIT_COST,
    );

    const existingJob = await this.jobs.getActiveJobForUser(userId);

    const baseQuestions = Array.isArray(input.followUpQuestions)
      ? input.followUpQuestions.map((value) => value?.toString?.().trim?.() ?? '')
      : [];
    const baseAnswers = Array.isArray(input.followUpAnswers)
      ? input.followUpAnswers.map((value) => value?.toString?.().trim?.() ?? '')
      : [];
    const alignedAnswers = baseQuestions.map((_, idx) => baseAnswers[idx] ?? '');

    const notes = input.notes?.toString?.().trim?.() ?? '';
    const responseId = input.responseId?.toString?.().trim?.() ?? '';

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('OPENAI_DEEP_RESEARCH_MODEL')?.trim() || 'o4-mini-deep-research';
    const vectorStoreEnv = this.config.get<string>('OPENAI_DEEP_RESEARCH_VECTOR_STORE_IDS') ?? '';
    const contextSizeRaw = this.config.get<string>('OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE');
    const normalisedContextSize =
      typeof contextSizeRaw === 'string' ? contextSizeRaw.trim().toLowerCase() : '';
    const webSearchTool = ALLOWED_WEB_SEARCH_CONTEXT_SIZES.has(normalisedContextSize)
      ? { type: 'web_search_preview', web_search_context_size: normalisedContextSize }
      : { type: 'web_search_preview' };
    const vectorStoreIds = vectorStoreEnv
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const jobPayload = {
      jobId: input.jobId ?? existingJob?.jobId,
      phase: 'research' as const,
      stepIndex: existingJob?.stepIndex ?? 0,
      followUpIndex: existingJob?.followUpIndex ?? Math.max(baseQuestions.length - 1, 0),
      form: {
        issueDetail: input.issueDetail.trim(),
        affectedDetail: input.affectedDetail.trim(),
        backgroundDetail: input.backgroundDetail.trim(),
        desiredOutcome: input.desiredOutcome.trim(),
      },
      followUpQuestions: baseQuestions,
      followUpAnswers: alignedAnswers,
      notes: notes || undefined,
      responseId: responseId || undefined,
    };

    const metadata = {
      feature: 'writing_desk_research',
      jobId: jobPayload.jobId ?? null,
    };

    if (!apiKey) {
      const stubOutput = this.buildStubResearchOutput(jobPayload.form, baseQuestions, alignedAnswers);
      const researchState = {
        status: 'completed' as WritingDeskJobResearchStatus,
        startedAt: startedAt.toISOString(),
        completedAt: startedAt.toISOString(),
        updatedAt: startedAt.toISOString(),
        responseId: 'dev-stub',
        outputText: stubOutput,
        progress: 100,
        activities: [
          {
            id: 'dev-stub',
            type: 'stub',
            label: 'Generated placeholder research summary',
            status: 'completed',
            createdAt: startedAt.toISOString(),
            url: null,
          },
        ],
        error: null,
        creditsCharged: RESEARCH_CREDIT_COST,
        billedAt: startedAt.toISOString(),
      };

      const saved = await this.jobs.upsertActiveJob(userId, {
        ...jobPayload,
        research: researchState,
      });
      this.logger.log(`[writing-desk research] DEV-STUB ${JSON.stringify({ metadata, researchState })}`);
      return { job: saved, remainingCredits: remainingAfterCharge };
    }

    try {
      const client = await this.getOpenAiClient(apiKey);
      const tools: Array<Record<string, unknown>> = [webSearchTool];
      if (vectorStoreIds.length > 0) {
        tools.push({ type: 'file_search', vector_store_ids: vectorStoreIds });
      }
      tools.push({ type: 'code_interpreter', container: { type: 'auto' } });

      const response = await client.responses.create({
        model,
        input: this.buildResearchPrompt(jobPayload.form, baseQuestions, alignedAnswers, notes),
        background: true,
        tools,
        store: true,
        metadata,
      });

      const status = this.normaliseResearchStatus(response?.status);
      const researchState = {
        status,
        startedAt: startedAt.toISOString(),
        completedAt: null,
        updatedAt: startedAt.toISOString(),
        responseId: typeof response?.id === 'string' ? response.id : null,
        outputText: null,
        progress: this.estimateResearchProgress(status, 0, this.extractProgressHint(response)),
        activities: [],
        error: null,
        creditsCharged: RESEARCH_CREDIT_COST,
        billedAt: startedAt.toISOString(),
      };

      const saved = await this.jobs.upsertActiveJob(userId, {
        ...jobPayload,
        research: researchState,
      });

      this.logger.log(
        `[writing-desk research] started ${JSON.stringify({ metadata, responseId: researchState.responseId, model })}`,
      );

      return {
        job: saved,
        remainingCredits: remainingAfterCharge,
        responseId: researchState.responseId,
      };
    } catch (error) {
      await this.refundCredits(userId, RESEARCH_CREDIT_COST);
      throw error;
    }
  }

  async pollWritingDeskResearch(userId: string | null | undefined, jobId: string) {
    if (!userId) {
      throw new BadRequestException('User account required');
    }

    const job = await this.jobs.getActiveJobForUser(userId);
    if (!job || job.jobId !== jobId) {
      throw new NotFoundException('Active research job not found');
    }

    if (!job.research || !job.research.responseId) {
      return job;
    }

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      return job;
    }

    const client = await this.getOpenAiClient(apiKey);
    const response = await client.responses.retrieve(job.research.responseId);

    const activities = this.mapResearchActivities(response, job.research.activities);
    const status = this.normaliseResearchStatus(response?.status);
    const progress = this.estimateResearchProgress(
      status,
      activities.length,
      this.extractProgressHint(response),
    );

    const nowIso = new Date().toISOString();
    const outputText =
      status === 'completed'
        ? this.extractFirstText(response) ?? job.research.outputText
        : job.research.outputText;
    const errorMessage =
      status === 'failed' || status === 'cancelled'
        ? this.extractResearchError(response) ?? job.research.error ?? 'Research failed'
        : null;

    const researchState = {
      status,
      startedAt: job.research.startedAt ?? nowIso,
      completedAt:
        status === 'completed'
          ? job.research.completedAt ?? nowIso
          : status === 'failed' || status === 'cancelled'
            ? job.research.completedAt ?? nowIso
            : job.research.completedAt,
      updatedAt: nowIso,
      responseId: job.research.responseId,
      outputText: outputText ?? null,
      progress,
      activities,
      error: errorMessage,
      creditsCharged: job.research.creditsCharged ?? RESEARCH_CREDIT_COST,
      billedAt: job.research.billedAt ?? job.createdAt,
    };

    const saved = await this.jobs.upsertActiveJob(userId, {
      jobId: job.jobId,
      phase: 'research',
      stepIndex: job.stepIndex,
      followUpIndex: job.followUpIndex,
      form: {
        issueDetail: job.form.issueDetail ?? '',
        affectedDetail: job.form.affectedDetail ?? '',
        backgroundDetail: job.form.backgroundDetail ?? '',
        desiredOutcome: job.form.desiredOutcome ?? '',
      },
      followUpQuestions: [...job.followUpQuestions],
      followUpAnswers: [...job.followUpAnswers],
      notes: job.notes ?? undefined,
      responseId: job.responseId ?? undefined,
      research: researchState,
    });

    return saved;
  }

  private buildResearchPrompt(
    form: { issueDetail: string; affectedDetail: string; backgroundDetail: string; desiredOutcome: string },
    followUpQuestions: string[],
    followUpAnswers: string[],
    notes: string,
  ) {
    const followUpBlock = followUpQuestions
      .map((question, idx) => {
        const answer = followUpAnswers[idx] ?? '';
        return `Follow-up ${idx + 1}\nQuestion: ${question}\nAnswer: ${answer}`.trim();
      })
      .filter((entry) => entry.length > 0)
      .join('\n\n');

    const trimmedNotes = notes?.trim?.() ?? '';

    const instructions = [
      'You are an expert research analyst supporting a constituent who will write to their UK Member of Parliament.',
      'Gather high-quality, verifiable evidence to strengthen their case.',
      'Return only research notes. Do NOT draft the letter.',
      '',
      'Requirements:',
      '- Organise findings under clear Markdown headings (e.g. Key Facts, Impact on Constituents, Legal/Policy Context, Recent Developments, Possible Actions).',
      '- Provide bullet points containing specific facts, statistics, precedents, or quotes.',
      '- Every bullet must end with an inline citation using Markdown link syntax: [Source Title](https://example.com).',
      '- Prioritise recent UK or local sources first, then broader national or global context.',
      '- Highlight any statutory obligations, regulatory guidance, or oversight bodies that the MP could reference.',
      '- Identify opportunities for the MP to intervene (questions to raise, committees to involve, agencies to contact).',
      '- Surface any relevant campaigns, reports, FOI data, ombudsman findings, or watchdog investigations.',
      '- If evidence is limited, clearly state the gap and suggest how to obtain reliable information.',
      '',
      'Constituent intake summary:',
      `- Issue detail: ${form.issueDetail}`,
      `- Who is affected and how: ${form.affectedDetail}`,
      `- Supporting background: ${form.backgroundDetail}`,
      `- Desired outcome: ${form.desiredOutcome}`,
    ];

    if (followUpBlock) {
      instructions.push('', 'Clarifying follow-up Q&A:', followUpBlock);
    }

    instructions.push('', `Notes from clarifying step: ${trimmedNotes || 'None provided.'}`);
    instructions.push('', 'Return the research as Markdown with headings and bullet lists only.');

    return instructions.join('\n');
  }

  private buildStubResearchOutput(
    form: { issueDetail: string; affectedDetail: string; backgroundDetail: string; desiredOutcome: string },
    followUpQuestions: string[],
    followUpAnswers: string[],
  ) {
    const firstQuestion = followUpQuestions[0] ?? '';
    const firstAnswer = followUpAnswers[0] ?? '';
    return `## Key facts\n- Placeholder research summary for development environments. Issue: ${form.issueDetail}.\n- Impact described: ${form.affectedDetail}.\n- Desired change: ${form.desiredOutcome}.\n\n## Suggested next steps\n- Investigate official guidance or regulations relevant to this issue.\n- Gather statistics or case studies from reputable organisations.\n\n## Follow-up context\n- ${firstQuestion ? `Q: ${firstQuestion}` : 'No follow-up questions recorded.'}\n- ${firstAnswer ? `A: ${firstAnswer}` : 'No answers recorded.'}\n\n## Sources to consider\n- [Placeholder source](https://www.parliament.uk/) — Replace with real evidence.`;
  }

  private normaliseResearchStatus(status: unknown): WritingDeskJobResearchStatus {
    const value = typeof status === 'string' ? status.toLowerCase() : '';
    switch (value) {
      case 'queued':
        return 'queued';
      case 'in_progress':
        return 'in_progress';
      case 'cancelling':
        return 'cancelling';
      case 'cancelled':
        return 'cancelled';
      case 'failed':
        return 'failed';
      case 'completed':
        return 'completed';
      case 'requires_action':
        return 'requires_action';
      default:
        return 'in_progress';
    }
  }

  private mapResearchActivities(
    response: any,
    existing: Array<{ id: string; type: string; label: string; status: string; createdAt: string; url: string | null }> = [],
  ) {
    const existingMap = new Map<string, {
      id: string;
      type: string;
      label: string;
      status: string;
      createdAt: string;
      url: string | null;
    }>();
    for (const entry of existing) {
      if (!entry?.id) continue;
      existingMap.set(entry.id, { ...entry });
    }

    const outputSteps = Array.isArray(response?.output) ? response.output : [];
    let syntheticCounter = 0;

    for (const step of outputSteps) {
      if (!step || typeof step !== 'object') continue;
      const type = typeof step.type === 'string' ? step.type : '';
      if (!['web_search_call', 'file_search_call', 'code_interpreter_call'].includes(type)) continue;

      const id = typeof step.id === 'string' ? step.id : `activity-${syntheticCounter++}-${randomUUID()}`;
      const createdAt = this.parseTimestamp(step.created_at ?? step.timestamp ?? step.started_at) ?? new Date();
      const status = typeof step.status === 'string' ? step.status : existingMap.get(id)?.status ?? 'completed';
      const action = step.action ?? {};

      let label = existingMap.get(id)?.label ?? 'Research activity';
      let url: string | null = existingMap.get(id)?.url ?? null;

      if (type === 'web_search_call') {
        if (typeof action.query === 'string' && action.query.trim().length > 0) {
          label = `Web search: ${action.query}`;
        } else if (typeof action.url === 'string' && action.url.trim().length > 0) {
          label = `Opened source: ${action.url}`;
          url = action.url;
        } else {
          label = 'Web search action';
        }
        if (!url && typeof action.url === 'string' && action.url.trim().length > 0) {
          url = action.url;
        }
      } else if (type === 'file_search_call') {
        if (typeof action.query === 'string' && action.query.trim().length > 0) {
          label = `File search: ${action.query}`;
        } else if (typeof action.id === 'string') {
          label = `Fetched document ${action.id}`;
        } else {
          label = 'File search action';
        }
      } else if (type === 'code_interpreter_call') {
        label = 'Analysed data with code interpreter';
      }

      existingMap.set(id, {
        id,
        type,
        label,
        status,
        createdAt: existingMap.get(id)?.createdAt ?? createdAt.toISOString(),
        url,
      });
    }

    const merged = Array.from(existingMap.values()).map((entry) => ({
      ...entry,
      createdAt: this.parseTimestamp(entry.createdAt)?.toISOString() ?? entry.createdAt ?? new Date().toISOString(),
    }));

    merged.sort((a, b) => {
      const aTime = this.parseTimestamp(a.createdAt)?.getTime() ?? 0;
      const bTime = this.parseTimestamp(b.createdAt)?.getTime() ?? 0;
      return aTime - bTime;
    });

    return merged;
  }

  private estimateResearchProgress(
    status: WritingDeskJobResearchStatus,
    activityCount: number,
    hint: number | null,
  ) {
    if (typeof hint === 'number' && !Number.isNaN(hint)) {
      const normalised = hint <= 1 ? hint * 100 : hint;
      return Math.max(0, Math.min(100, Math.round(normalised)));
    }

    if (status === 'completed') return 100;
    if (status === 'failed' || status === 'cancelled') return 100;

    if (status === 'queued') {
      return activityCount > 0 ? Math.min(40, 10 + activityCount * 10) : 10;
    }

    if (status === 'in_progress' || status === 'requires_action' || status === 'cancelling') {
      return Math.min(95, 30 + activityCount * 12);
    }

    return 0;
  }

  private extractProgressHint(response: any): number | null {
    const details = response?.status_details;
    if (!details || typeof details !== 'object') return null;
    const candidates = [
      (details as any).progress_percent,
      (details as any).progress,
      (details as any).percentage,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const parsed = Number(candidate);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }

  private parseTimestamp(input: unknown): Date | null {
    if (input instanceof Date) return input;
    if (typeof input === 'number' && Number.isFinite(input)) {
      if (input > 1e12) {
        return new Date(input);
      }
      return new Date(input * 1000);
    }
    if (typeof input === 'string') {
      const parsed = new Date(input);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  }

  private extractResearchError(response: any): string | null {
    const candidates = [
      response?.status_message,
      response?.error?.message,
      response?.status_details?.error?.message,
      response?.status_details?.message,
      response?.last_error?.message,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  }

  private extractFirstText(response: any): string | null {
    if (!response) return null;
    const direct = response?.output_text;
    if (typeof direct === 'string' && direct.trim().length > 0) {
      return direct;
    }
    const steps = Array.isArray(response?.output) ? response.output : [];
    for (const step of steps) {
      const contentItems = Array.isArray(step?.content) ? step.content : [];
      for (const item of contentItems) {
        if (typeof item?.text === 'string' && item.text.trim().length > 0) {
          return item.text;
        }
        if (item?.type === 'output_text' && typeof item?.content === 'string') {
          return item.content;
        }
      }
    }
    return null;
  }

  private async refundCredits(userId: string, amount: number) {
    try {
      await this.userCredits.addToMine(userId, amount);
    } catch (err) {
      this.logger.error(`Failed to refund credits for user ${userId}: ${(err as Error).message}`);
    }
  }

  private buildStubFollowUps(input: WritingDeskIntakeDto) {
    const questions: string[] = [];
    
    // Check if issue detail is too brief or vague
    if (input.issueDetail.length < 100 || !/\b(problem|issue|concern|matter)\b/i.test(input.issueDetail)) {
      questions.push('Can you describe the specific problem or issue you\'re facing in more detail?');
    }
    
    // Check if affected parties need more detail
    if (input.affectedDetail.length < 50 || !/\b(people|residents|community|families|businesses)\b/i.test(input.affectedDetail)) {
      questions.push('Who else is affected by this issue in your area?');
    }
    
    // Check if desired outcome is clear
    if (input.desiredOutcome.length < 50 || !/\b(want|need|hope|expect|should|must)\b/i.test(input.desiredOutcome)) {
      questions.push('What specific outcome or resolution are you hoping for?');
    }
    
    return questions.slice(0, 3);
  }
}
