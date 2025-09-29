import { BadRequestException, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WritingDeskIntakeDto } from './dto/writing-desk-intake.dto';
import { WritingDeskFollowUpDto } from './dto/writing-desk-follow-up.dto';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { WritingDeskJobsService } from '../writing-desk-jobs/writing-desk-jobs.service';
import { UserMpService } from '../user-mp/user-mp.service';
import {
  ActiveWritingDeskJobResource,
  WritingDeskResearchStatus,
  WritingDeskLetterTone,
  WritingDeskLetterStatus,
} from '../writing-desk-jobs/writing-desk-jobs.types';
import { UpsertActiveWritingDeskJobDto } from '../writing-desk-jobs/dto/upsert-active-writing-desk-job.dto';
import { Observable, ReplaySubject, Subscription } from 'rxjs';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { UsersService } from '../users/users.service';
import { UserAddressService } from '../user-address-store/user-address.service';

const FOLLOW_UP_CREDIT_COST = 0.1;
const DEEP_RESEARCH_CREDIT_COST = 0.7;
const LETTER_CREDIT_COST = 0.2;

type DeepResearchRequestExtras = {
  tools?: Array<Record<string, unknown>>;
  max_tool_calls?: number;
  reasoning?: {
    summary?: 'auto' | 'disabled' | null;
    effort?: 'low' | 'medium' | 'high';
  };
};

type DeepResearchStreamPayload =
  | { type: 'status'; status: string; remainingCredits?: number | null }
  | { type: 'delta'; text: string }
  | { type: 'event'; event: Record<string, unknown> }
  | {
      type: 'complete';
      content: string;
      responseId: string | null;
      remainingCredits: number | null;
      usage?: Record<string, unknown> | null;
    }
  | { type: 'error'; message: string; remainingCredits?: number | null };

type DeepResearchRunStatus = 'running' | 'completed' | 'error';

interface DeepResearchRun {
  key: string;
  userId: string;
  jobId: string;
  subject: ReplaySubject<DeepResearchStreamPayload>;
  status: DeepResearchRunStatus;
  startedAt: number;
  cleanupTimer: NodeJS.Timeout | null;
  promise: Promise<void> | null;
  responseId: string | null;
}

type ResponseStreamLike = AsyncIterable<ResponseStreamEvent> & {
  controller?: { abort: () => void };
};

const DEEP_RESEARCH_RUN_BUFFER_SIZE = 2000;
const DEEP_RESEARCH_RUN_TTL_MS = 5 * 60 * 1000;
const BACKGROUND_POLL_INTERVAL_MS = 2000;
const BACKGROUND_POLL_TIMEOUT_MS = 20 * 60 * 1000;

type LetterStreamPayload =
  | { type: 'status'; status: string; remainingCredits?: number | null }
  | { type: 'letter_delta'; html: string }
  | { type: 'event'; event: Record<string, unknown> }
  | {
      type: 'complete';
      responseId: string | null;
      remainingCredits: number | null;
      letter: MpLetterSchemaResult;
      usage?: Record<string, unknown> | null;
    }
  | { type: 'error'; message: string; remainingCredits?: number | null };

type LetterRunStatus = 'running' | 'completed' | 'error';

interface LetterRun {
  key: string;
  userId: string;
  jobId: string;
  tone: WritingDeskLetterTone | null;
  subject: ReplaySubject<LetterStreamPayload>;
  status: LetterRunStatus;
  startedAt: number;
  cleanupTimer: NodeJS.Timeout | null;
  promise: Promise<void> | null;
  responseId: string | null;
  aggregatedJson: string;
  aggregatedLetterHtml: string;
  result: MpLetterSchemaResult | null;
}

const LETTER_RUN_BUFFER_SIZE = 2000;
const LETTER_RUN_TTL_MS = 5 * 60 * 1000;

type MpLetterSchemaResult = {
  mp_name: string;
  mp_address_1: string;
  mp_address_2: string;
  mp_city: string;
  mp_county: string;
  mp_postcode: string;
  date: string;
  letter_content: string;
  sender_name: string;
  sender_address_1: string;
  sender_address_2: string;
  sender_address_3: string;
  sender_city: string;
  sender_county: string;
  sender_postcode: string;
  references: string[];
};

type LetterContext = {
  date: string;
  mp: {
    name: string;
    constituency: string;
    party: string;
    email: string;
    website: string;
    twitter: string;
    parliamentaryAddress: string;
    address: {
      line1: string;
      line2: string;
      city: string;
      county: string;
      postcode: string;
    };
  };
  sender: {
    name: string;
    address1: string;
    address2: string;
    address3: string;
    city: string;
    county: string;
    postcode: string;
  };
  followUps: Array<{ question: string; answer: string }>;
  intake: string;
  notes: string | null;
  research: string;
};

const MP_LETTER_SCHEMA = {
  type: 'object',
  properties: {
    mp_name: { type: 'string' },
    mp_address_1: { type: 'string' },
    mp_address_2: { type: 'string' },
    mp_city: { type: 'string' },
    mp_county: { type: 'string' },
    mp_postcode: { type: 'string' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    letter_content: { type: 'string' },
    sender_name: { type: 'string' },
    sender_address_1: { type: 'string' },
    sender_address_2: { type: 'string' },
    sender_address_3: { type: 'string' },
    sender_city: { type: 'string' },
    sender_county: { type: 'string' },
    sender_postcode: { type: 'string' },
    references: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'mp_name',
    'mp_address_1',
    'mp_address_2',
    'mp_city',
    'mp_county',
    'mp_postcode',
    'date',
    'letter_content',
    'sender_name',
    'sender_address_1',
    'sender_address_2',
    'sender_address_3',
    'sender_city',
    'sender_county',
    'sender_postcode',
    'references',
  ],
  additionalProperties: false,
} as const;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openaiClient: any | null = null;
  private readonly deepResearchRuns = new Map<string, DeepResearchRun>();
  private readonly letterRuns = new Map<string, LetterRun>();

  constructor(
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
    private readonly writingDeskJobs: WritingDeskJobsService,
    private readonly userMp: UserMpService,
    private readonly users: UsersService,
    private readonly userAddress: UserAddressService,
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
From the provided description, identify the most important gaps that stop you fully understanding the situation and what outcome the constituent wants.
Ask at most five concise follow-up questions. If everything is already clear, return an empty list.
Prioritise clarifying the specific problem, how it affects people, what has already happened, and what the constituent hopes their MP will achieve.
Do NOT ask for documents, permissions, names, addresses, or personal details. Only ask about the issue itself.`;

      const userSummary = `Constituent description:\n${input.issueDescription}`;

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
                  description: 'Up to five clarifying follow-up questions for the user.',
                  maxItems: 5,
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
      issueDescription: input.issueDescription.trim(),
      followUpQuestions: cleanedQuestions,
      followUpAnswers: cleanedAnswers,
      notes: input.notes?.trim?.() || null,
      responseId: input.responseId ?? null,
      recordedAt: new Date().toISOString(),
    };

    this.logger.log(`[writing-desk step1-answers] ${JSON.stringify(bundle)}`);

    return { ok: true };
  }

  streamWritingDeskDeepResearch(
    userId: string | null | undefined,
    options?: { jobId?: string | null },
  ): Observable<MessageEvent> {
    if (!userId) {
      throw new BadRequestException('User account required');
    }

    return new Observable<MessageEvent>((subscriber) => {
      let subscription: Subscription | null = null;
      let settled = false;

      const attach = async () => {
        try {
          const run = await this.beginDeepResearchRun(userId, options?.jobId ?? null);
          subscription = run.subject.subscribe({
            next: (payload) => {
              if (!subscriber.closed) {
                subscriber.next({ data: JSON.stringify(payload) });
              }
            },
            error: (error) => {
              if (!subscriber.closed) {
                subscriber.error(error);
              }
            },
            complete: () => {
              settled = true;
              if (!subscriber.closed) {
                subscriber.complete();
              }
            },
          });
        } catch (error) {
          settled = true;
          if (error instanceof BadRequestException) {
            subscriber.next({
              data: JSON.stringify({ type: 'error', message: error.message }),
            });
            subscriber.complete();
            return;
          }
          subscriber.error(error);
        }
      };

      void attach();

      return () => {
        subscription?.unsubscribe();
        subscription = null;
        settled = true;
      };
    });
  }

  streamWritingDeskLetter(
    userId: string | null | undefined,
    options?: { jobId?: string | null },
  ): Observable<MessageEvent> {
    if (!userId) {
      throw new BadRequestException('User account required');
    }

    return new Observable<MessageEvent>((subscriber) => {
      let subscription: Subscription | null = null;
      let settled = false;

      const attach = async () => {
        try {
          const run = await this.beginLetterRun(userId, options?.jobId ?? null);
          subscription = run.subject.subscribe({
            next: (payload) => {
              if (!subscriber.closed) {
                subscriber.next({ data: JSON.stringify(payload) });
              }
            },
            error: (error) => {
              if (!subscriber.closed) {
                subscriber.error(error);
              }
            },
            complete: () => {
              settled = true;
              if (!subscriber.closed) {
                subscriber.complete();
              }
            },
          });
        } catch (error) {
          settled = true;
          if (error instanceof BadRequestException) {
            subscriber.next({
              data: JSON.stringify({ type: 'error', message: error.message }),
            });
            subscriber.complete();
            return;
          }
          subscriber.error(error);
        }
      };

      void attach();

      return () => {
        subscription?.unsubscribe();
        subscription = null;
        settled = true;
      };
    });
  }

  async ensureLetterRun(
    userId: string,
    requestedJobId: string | null,
    options?: { tone?: WritingDeskLetterTone; restart?: boolean; createIfMissing?: boolean },
  ): Promise<{ jobId: string; status: LetterRunStatus }> {
    const run = await this.beginLetterRun(userId, requestedJobId, options);
    return { jobId: run.jobId, status: run.status };
  }

  private async beginLetterRun(
    userId: string,
    requestedJobId: string | null,
    options?: { tone?: WritingDeskLetterTone; restart?: boolean; createIfMissing?: boolean },
  ): Promise<LetterRun> {
    const baselineJob = await this.resolveActiveWritingDeskJob(userId, requestedJobId);
    const key = this.getLetterRunKey(userId, baselineJob.jobId);
    const existing = this.letterRuns.get(key);

    if (existing) {
      if (options?.restart) {
        if (existing.status === 'running') {
          throw new BadRequestException('Letter drafting is already running. Please wait for it to finish.');
        }
        if (existing.cleanupTimer) {
          clearTimeout(existing.cleanupTimer);
        }
        existing.subject.complete();
        this.letterRuns.delete(key);
      } else {
        return existing;
      }
    } else if (options?.createIfMissing === false) {
      throw new BadRequestException('We could not resume the letter draft. Please start a new run.');
    }

    const tone = options?.tone ?? baselineJob.letterTone ?? null;
    if (!tone) {
      throw new BadRequestException('Choose a tone before composing your letter.');
    }

    const subject = new ReplaySubject<LetterStreamPayload>(LETTER_RUN_BUFFER_SIZE);
    const run: LetterRun = {
      key,
      userId,
      jobId: baselineJob.jobId,
      tone,
      subject,
      status: 'running',
      startedAt: Date.now(),
      cleanupTimer: null,
      promise: null,
      responseId: null,
      aggregatedJson: '',
      aggregatedLetterHtml: '',
      result: null,
    };

    this.letterRuns.set(key, run);

    run.promise = this.executeLetterRun({ run, userId, baselineJob, subject, tone }).catch((error) => {
      this.logger.error(`Letter run encountered an unhandled error: ${(error as Error)?.message ?? error}`);
      subject.error(error);
    });

    return run;
  }

  async ensureDeepResearchRun(
    userId: string,
    requestedJobId: string | null,
    options?: { restart?: boolean; createIfMissing?: boolean },
  ): Promise<{ jobId: string; status: DeepResearchRunStatus }> {
    const run = await this.beginDeepResearchRun(userId, requestedJobId, options);
    return { jobId: run.jobId, status: run.status };
  }

  private async beginDeepResearchRun(
    userId: string,
    requestedJobId: string | null,
    options?: { restart?: boolean; createIfMissing?: boolean },
  ): Promise<DeepResearchRun> {
    const baselineJob = await this.resolveActiveWritingDeskJob(userId, requestedJobId);
    const key = this.getDeepResearchRunKey(userId, baselineJob.jobId);
    const existing = this.deepResearchRuns.get(key);

    if (existing) {
      if (options?.restart) {
        if (existing.status === 'running') {
          throw new BadRequestException('Deep research is already running. Please wait for it to finish.');
        }
        if (existing.cleanupTimer) {
          clearTimeout(existing.cleanupTimer);
        }
        existing.subject.complete();
        this.deepResearchRuns.delete(key);
      } else {
        return existing;
      }
    } else if (options?.createIfMissing === false) {
      throw new BadRequestException('We could not resume deep research. Please start a new run.');
    }

    const subject = new ReplaySubject<DeepResearchStreamPayload>(DEEP_RESEARCH_RUN_BUFFER_SIZE);
    const run: DeepResearchRun = {
      key,
      userId,
      jobId: baselineJob.jobId,
      subject,
      status: 'running',
      startedAt: Date.now(),
      cleanupTimer: null,
      promise: null,
      responseId: null,
    };

    this.deepResearchRuns.set(key, run);

    run.promise = this.executeDeepResearchRun({ run, userId, baselineJob, subject }).catch((error) => {
      this.logger.error(`Deep research run encountered an unhandled error: ${(error as Error)?.message ?? error}`);
      subject.error(error);
    });

    return run;
  }

  private async executeDeepResearchRun(params: {
    run: DeepResearchRun;
    userId: string;
    baselineJob: ActiveWritingDeskJobResource;
    subject: ReplaySubject<DeepResearchStreamPayload>;
  }) {
    const { run, userId, baselineJob, subject } = params;
    let deductionApplied = false;
    let remainingCredits: number | null = null;
    let aggregatedText = '';
    let settled = false;
    let openAiStream: ResponseStreamLike | null = null;
    let responseId: string | null = run.responseId ?? null;

    const captureResponseId = async (candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') return;
      const id = (candidate as any)?.id;
      if (typeof id !== 'string') return;
      const trimmed = id.trim();
      if (!trimmed || trimmed === responseId) return;
      responseId = trimmed;
      run.responseId = trimmed;
      try {
        await this.persistDeepResearchResult(userId, baselineJob, {
          responseId: trimmed,
          status: 'running',
        });
      } catch (error) {
        this.logger.warn(
          `Failed to persist deep research response id for user ${userId}: ${(error as Error)?.message ?? error}`,
        );
      }
    };

    const send = (payload: DeepResearchStreamPayload) => {
      subject.next(payload);
    };

    const pushDelta = (next: string | null | undefined) => {
      if (typeof next !== 'string') return;
      if (next.length <= aggregatedText.length) {
        aggregatedText = next;
        return;
      }
      const incremental = next.slice(aggregatedText.length);
      aggregatedText = next;
      if (incremental.length > 0) {
        send({ type: 'delta', text: incremental });
      }
    };

    const mpName = await this.resolveUserMpName(userId);

    try {
      await this.persistDeepResearchStatus(userId, baselineJob, 'running');
    } catch (error) {
      this.logger.warn(
        `Failed to persist deep research status for user ${userId}: ${(error as Error)?.message ?? error}`,
      );
    }

    send({ type: 'status', status: 'starting' });

    try {
      const { credits } = await this.userCredits.deductFromMine(userId, DEEP_RESEARCH_CREDIT_COST);
      deductionApplied = true;
      remainingCredits = credits;
      send({ type: 'status', status: 'charged', remainingCredits: credits });

      const apiKey = this.config.get<string>('OPENAI_API_KEY');
      const model = this.config.get<string>('OPENAI_DEEP_RESEARCH_MODEL')?.trim() || 'o4-mini-deep-research';

      if (!apiKey) {
        const stub = this.buildDeepResearchStub(baselineJob, { mpName });
        for (const chunk of stub.chunks) {
          send({ type: 'delta', text: chunk });
          await this.delay(180);
        }
        await this.persistDeepResearchResult(userId, baselineJob, {
          content: stub.content,
          responseId: 'dev-stub',
          status: 'completed',
        });
        run.status = 'completed';
        settled = true;
        send({
          type: 'complete',
          content: stub.content,
          responseId: 'dev-stub',
          remainingCredits,
        });
        subject.complete();
        return;
      }

      const prompt = this.buildDeepResearchPrompt(baselineJob, { mpName });
      const client = await this.getOpenAiClient(apiKey);
      const requestExtras = this.buildDeepResearchRequestExtras(model);

      this.logger.log(
        `[writing-desk research] start ${JSON.stringify({
          userId,
          jobId: baselineJob.jobId,
          model,
          tools: requestExtras.tools?.length ?? 0,
        })}`,
      );

      openAiStream = (await client.responses.create({
        model,
        input: prompt,
        background: true,
        store: true,
        stream: true,
        ...requestExtras,
      })) as ResponseStreamLike;

      let lastSequenceNumber: number | null = null;
      let currentStream: ResponseStreamLike | null = openAiStream;
      let resumeAttempts = 0;

      while (currentStream) {
        let streamError: unknown = null;

        try {
          for await (const event of currentStream) {
            if (!event) continue;

            const sequenceNumber = (event as any)?.sequence_number;
            if (Number.isFinite(sequenceNumber)) {
              lastSequenceNumber = Number(sequenceNumber);
            }

            if ((event as any)?.response) {
              await captureResponseId((event as any).response);
            }

            switch (event.type) {
              case 'response.created':
                send({ type: 'status', status: 'queued' });
                break;
              case 'response.queued':
                send({ type: 'status', status: 'queued' });
                break;
              case 'response.in_progress':
                send({ type: 'status', status: 'in_progress' });
                break;
              case 'response.output_text.delta': {
                const snapshot = (event as any)?.snapshot;
                if (typeof snapshot === 'string' && snapshot.length > aggregatedText.length) {
                  pushDelta(snapshot);
                  break;
                }
                if (typeof event.delta === 'string' && event.delta.length > 0) {
                  pushDelta(aggregatedText + event.delta);
                }
                break;
              }
              case 'response.output_text.done':
                if (typeof event.text === 'string' && event.text.length > 0) {
                  pushDelta(event.text);
                }
                break;
              case 'response.web_search_call.searching':
              case 'response.web_search_call.in_progress':
              case 'response.web_search_call.completed':
              case 'response.file_search_call.searching':
              case 'response.file_search_call.in_progress':
              case 'response.file_search_call.completed':
              case 'response.code_interpreter_call.in_progress':
              case 'response.code_interpreter_call.completed':
              case 'response.reasoning.delta':
              case 'response.reasoning.done':
              case 'response.reasoning_summary.delta':
              case 'response.reasoning_summary.done':
              case 'response.reasoning_summary_part.added':
              case 'response.reasoning_summary_part.done':
              case 'response.reasoning_summary_text.delta':
              case 'response.reasoning_summary_text.done':
                send({ type: 'event', event: this.normaliseStreamEvent(event) });
                break;
              case 'response.failed':
              case 'response.incomplete': {
                const errorMessage = (event as any)?.error?.message ?? 'Deep research failed';
                throw new Error(errorMessage);
              }
              case 'response.completed': {
                const finalResponse = event.response;
                const resolvedResponseId = (finalResponse as any)?.id ?? responseId ?? null;
                if (resolvedResponseId && resolvedResponseId !== responseId) {
                  await captureResponseId(finalResponse);
                }
                const finalText = this.extractFirstText(finalResponse) ?? aggregatedText;
                await this.persistDeepResearchResult(userId, baselineJob, {
                  content: finalText,
                  responseId: resolvedResponseId,
                  status: 'completed',
                });
                run.status = 'completed';
                settled = true;
                send({
                  type: 'complete',
                  content: finalText,
                  responseId: resolvedResponseId,
                  remainingCredits,
                  usage: (finalResponse as any)?.usage ?? null,
                });
                subject.complete();
                return;
              }
              default:
                send({ type: 'event', event: this.normaliseStreamEvent(event) });
            }
          }
          break;
        } catch (error) {
          streamError = error;
        }

        if (!streamError) {
          break;
        }

        const isTransportFailure =
          streamError instanceof Error && /premature close/i.test(streamError.message);

        if (!isTransportFailure) {
          throw streamError instanceof Error
            ? streamError
            : new Error('Deep research stream failed with an unknown error');
        }

        if (!responseId) {
          this.logger.warn(
            `[writing-desk research] transport failure before response id available: ${
              streamError instanceof Error ? streamError.message : 'unknown error'
            }`,
          );
          break;
        }

        resumeAttempts += 1;
        const resumeCursor = lastSequenceNumber ?? null;
        this.logger.warn(
          `[writing-desk research] resume attempt ${resumeAttempts} for response ${responseId} starting after ${
            resumeCursor ?? 'start'
          }`,
        );

        try {
          const resumeParams: {
            response_id: string;
            starting_after?: number;
            tools?: Array<Record<string, unknown>>;
          } = {
            response_id: responseId,
            starting_after: resumeCursor ?? undefined,
          };

          if (Array.isArray(requestExtras.tools) && requestExtras.tools.length > 0) {
            resumeParams.tools = requestExtras.tools;
          }

          currentStream = client.responses.stream(resumeParams) as ResponseStreamLike;
          openAiStream = currentStream;
          this.logger.log(
            `[writing-desk research] resume attempt ${resumeAttempts} succeeded for response ${responseId}`,
          );
        } catch (resumeError) {
          this.logger.error(
            `[writing-desk research] resume attempt ${resumeAttempts} failed for response ${responseId}: ${
              resumeError instanceof Error ? resumeError.message : 'unknown error'
            }`,
          );
          break;
        }
      }

      if (!settled) {
        if (!responseId) {
          throw new Error('Deep research stream ended before a response id was available');
        }

        this.logger.warn(
          `[writing-desk research] stream ended early for response ${responseId}, polling for completion`,
        );

        const finalResponse = await this.waitForBackgroundResponseCompletion(client, responseId);
        const finalStatus = (finalResponse as any)?.status ?? 'completed';

        if (finalStatus === 'completed') {
          const finalText = this.extractFirstText(finalResponse) ?? aggregatedText;
          pushDelta(finalText);
          await this.persistDeepResearchResult(userId, baselineJob, {
            content: finalText,
            responseId,
            status: 'completed',
          });
          run.status = 'completed';
          settled = true;
          send({
            type: 'complete',
            content: finalText,
            responseId,
            remainingCredits,
            usage: (finalResponse as any)?.usage ?? null,
          });
          subject.complete();
        } else {
          const message = this.buildBackgroundFailureMessage(finalResponse, finalStatus);
          await this.persistDeepResearchResult(userId, baselineJob, {
            responseId,
            status: 'error',
          });
          run.status = 'error';
          settled = true;
          send({ type: 'error', message, remainingCredits });
          subject.complete();
        }
      }
    } catch (error) {
      this.logger.error(
        `[writing-desk research] failure ${error instanceof Error ? error.message : 'unknown'}`,
      );

      if (deductionApplied && !settled) {
        await this.refundCredits(userId, DEEP_RESEARCH_CREDIT_COST);
        remainingCredits =
          typeof remainingCredits === 'number'
            ? Math.round((remainingCredits + DEEP_RESEARCH_CREDIT_COST) * 100) / 100
            : null;
      }

      run.status = 'error';

      try {
        await this.persistDeepResearchStatus(userId, baselineJob, 'error');
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist deep research error state for user ${userId}: ${(persistError as Error)?.message ?? persistError}`,
        );
      }

      const message =
        error instanceof BadRequestException
          ? error.message
          : 'Deep research failed. Please try again in a few moments.';

      send({
        type: 'error',
        message,
        remainingCredits,
      });
      subject.complete();
    } finally {
      if (!settled && openAiStream?.controller) {
        try {
          openAiStream.controller.abort();
        } catch (err) {
          this.logger.warn(
            `Failed to abort deep research stream: ${(err as Error)?.message ?? 'unknown error'}`,
          );
        }
      }

      this.scheduleRunCleanup(run);
    }
  }

  private async executeLetterRun(params: {
    run: LetterRun;
    userId: string;
    baselineJob: ActiveWritingDeskJobResource;
    subject: ReplaySubject<LetterStreamPayload>;
    tone: WritingDeskLetterTone;
  }) {
    const { run, userId, baselineJob, subject, tone } = params;
    let deductionApplied = false;
    let remainingCredits: number | null = null;
    let openAiStream: ResponseStreamLike | null = null;
    let responseId: string | null = run.responseId ?? null;
    let settled = false;
    let lastSequenceNumber: number | null = null;
    let resumeAttempts = 0;
    const jsonChunks: string[] = [];
    let lastPersistedSignature: string | null = null;

    const send = (payload: LetterStreamPayload) => {
      subject.next(payload);
    };

    const updatePersistence = async (
      result: MpLetterSchemaResult | null,
      status?: WritingDeskLetterStatus,
      extras?: { responseId?: string | null },
    ) => {
      const signature = result ? JSON.stringify(result) : null;
      if (!status && signature && signature === lastPersistedSignature) {
        return;
      }
      lastPersistedSignature = signature ?? lastPersistedSignature;
      const references = this.normaliseLetterReferences(result?.references ?? []);
      await this.persistLetterResult(userId, baselineJob, {
        tone,
        content: result?.letter_content ?? null,
        references,
        resultJson: signature,
        responseId: extras?.responseId ?? responseId,
        status,
      });
    };

    const captureResponseId = async (candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') return;
      const id = (candidate as any)?.id;
      if (typeof id !== 'string') return;
      const trimmed = id.trim();
      if (!trimmed || trimmed === responseId) return;
      responseId = trimmed;
      run.responseId = trimmed;
      await updatePersistence(run.result ?? null, 'running', { responseId: trimmed });
    };

    const applyResult = async (result: MpLetterSchemaResult | null) => {
      if (!result) return;
      run.result = result;
      const html = typeof result.letter_content === 'string' ? result.letter_content : '';
      if (html && html !== run.aggregatedLetterHtml) {
        run.aggregatedLetterHtml = html;
        send({ type: 'letter_delta', html });
      }
      await updatePersistence(result, undefined);
    };

    const appendJsonChunk = async (chunk: string | null) => {
      if (!chunk) return;
      jsonChunks.push(chunk);
      run.aggregatedJson = jsonChunks.join('');
      const parsed = this.tryParseLetterResult(run.aggregatedJson);
      if (parsed) {
        await applyResult(parsed);
      }
    };

    try {
      await updatePersistence(null, 'running');
    } catch (error) {
      this.logger.warn(
        `Failed to persist initial letter status for user ${userId}: ${(error as Error)?.message ?? error}`,
      );
    }

    send({ type: 'status', status: 'starting' });

    try {
      const { credits } = await this.userCredits.deductFromMine(userId, LETTER_CREDIT_COST);
      deductionApplied = true;
      remainingCredits = credits;
      send({ type: 'status', status: 'charged', remainingCredits: credits });

      const apiKey = this.config.get<string>('OPENAI_API_KEY');
      const model = this.config.get<string>('OPENAI_LETTER_MODEL')?.trim() || 'gpt-5';

      const context = await this.buildLetterContext(userId, baselineJob);
      const prompt = this.buildLetterPrompt({ job: baselineJob, tone, context });

      if (!apiKey) {
        const stub = this.buildLetterStub({ job: baselineJob, tone, context });
        await applyResult(stub);
        await updatePersistence(stub, 'completed', { responseId: 'dev-stub' });
        run.status = 'completed';
        settled = true;
        send({
          type: 'complete',
          responseId: 'dev-stub',
          remainingCredits,
          letter: stub,
        });
        subject.complete();
        return;
      }

      const client = await this.getOpenAiClient(apiKey);
      const verbosityRaw = this.config.get<string>('OPENAI_LETTER_VERBOSITY')?.trim()?.toLowerCase();
      const allowedVerbosity = ['low', 'medium', 'high'];
      const verbosity = allowedVerbosity.includes(verbosityRaw ?? '') ? verbosityRaw : 'medium';
      const effortRaw = this.config.get<string>('OPENAI_LETTER_REASONING_EFFORT')?.trim()?.toLowerCase();
      const supportedEfforts = this.getSupportedReasoningEfforts(model);
      const requestedEffort = (['low', 'medium', 'high'].includes(effortRaw ?? '')
        ? (effortRaw as 'low' | 'medium' | 'high')
        : 'medium') as 'low' | 'medium' | 'high';
      const reasoningEffort = supportedEfforts.includes(requestedEffort)
        ? requestedEffort
        : supportedEfforts[0];

      if (reasoningEffort !== requestedEffort) {
        this.logger.warn(
          `[writing-desk letter] reasoning effort "${requestedEffort}" not supported for model "${model}" – falling back to "${reasoningEffort}"`,
        );
      }

      this.logger.log(
        `[writing-desk letter] start ${JSON.stringify({ userId, jobId: baselineJob.jobId, model, tone })}`,
      );

      openAiStream = (await client.responses.create({
        model,
        input: prompt,
        background: true,
        store: true,
        stream: true,
        text: {
          format: {
            type: 'json_schema',
            name: 'mp_letter',
            strict: true,
            schema: MP_LETTER_SCHEMA,
          },
          verbosity,
        },
        reasoning: {
          effort: reasoningEffort,
        },
      })) as ResponseStreamLike;

      let currentStream: ResponseStreamLike | null = openAiStream;

      while (currentStream) {
        let streamError: unknown = null;

        try {
          for await (const event of currentStream) {
            if (!event) continue;

            const sequenceNumber = (event as any)?.sequence_number;
            if (Number.isFinite(sequenceNumber)) {
              lastSequenceNumber = Number(sequenceNumber);
            }

            if ((event as any)?.response) {
              await captureResponseId((event as any).response);
            }

            switch (event.type) {
              case 'response.created':
                send({ type: 'status', status: 'queued' });
                break;
              case 'response.queued':
                send({ type: 'status', status: 'queued' });
                break;
              case 'response.in_progress':
                send({ type: 'status', status: 'in_progress' });
                break;
              case 'response.output_json.delta':
                send({ type: 'event', event: this.normaliseStreamEvent(event) });
                await appendJsonChunk(this.extractJsonChunk(event));
                break;
              case 'response.output_text.delta': {
                send({ type: 'event', event: this.normaliseStreamEvent(event) });
                const deltaText = typeof (event as any)?.delta === 'string' ? (event as any).delta : '';
                await appendJsonChunk(deltaText);
                break;
              }
              case 'response.output_json.done':
              case 'response.output_text.done':
                send({ type: 'event', event: this.normaliseStreamEvent(event) });
                break;
              case 'response.completed': {
                send({ type: 'status', status: 'completed' });
                const finalResponse = (event as any)?.response ?? null;
                if (finalResponse) {
                  await captureResponseId(finalResponse);
                  const finalResult = this.extractLetterResultFromResponse(finalResponse);
                  if (finalResult) {
                    await appendJsonChunk(JSON.stringify(finalResult));
                  }
                  await applyResult(run.result ?? finalResult ?? null);
                  const resolved = run.result ?? finalResult ?? null;
                  await updatePersistence(resolved, 'completed');
                  run.status = 'completed';
                  settled = true;
                  send({
                    type: 'complete',
                    responseId: responseId ?? (finalResponse as any)?.id ?? null,
                    remainingCredits,
                    letter: resolved ?? this.buildLetterStub({ job: baselineJob, tone, context }),
                    usage: (finalResponse as any)?.usage ?? null,
                  });
                  subject.complete();
                  return;
                }
                break;
              }
              case 'response.failed':
              case 'response.incomplete':
                throw new Error('Letter generation failed');
              default:
                send({ type: 'event', event: this.normaliseStreamEvent(event) });
            }
          }
          break;
        } catch (error) {
          streamError = error;
        }

        if (!streamError) {
          break;
        }

        const isTransportFailure =
          streamError instanceof Error && /premature close/i.test(streamError.message);

        if (!isTransportFailure) {
          throw streamError instanceof Error
            ? streamError
            : new Error('Letter stream failed with an unknown error');
        }

        if (!responseId) {
          this.logger.warn(
            `[writing-desk letter] transport failure before response id available: ${
              streamError instanceof Error ? streamError.message : 'unknown error'
            }`,
          );
          break;
        }

        resumeAttempts += 1;
        const resumeCursor = lastSequenceNumber ?? null;
        this.logger.warn(
          `[writing-desk letter] resume attempt ${resumeAttempts} for response ${responseId} starting after ${resumeCursor ?? 'start'}`,
        );

        try {
          currentStream = client.responses.stream({
            response_id: responseId,
            starting_after: resumeCursor ?? undefined,
          }) as ResponseStreamLike;
          openAiStream = currentStream;
        } catch (resumeError) {
          this.logger.error(
            `[writing-desk letter] resume attempt ${resumeAttempts} failed for response ${responseId}: ${
              resumeError instanceof Error ? resumeError.message : 'unknown error'
            }`,
          );
          break;
        }
      }

      if (!settled) {
        if (!responseId) {
          throw new Error('Letter stream ended before a response id was available');
        }

        const finalResponse = await client.responses.retrieve(responseId);
        const status = (finalResponse as any)?.status ?? 'completed';
        if (status === 'completed') {
          const finalResult = this.extractLetterResultFromResponse(finalResponse);
          if (finalResult) {
            await appendJsonChunk(JSON.stringify(finalResult));
            await applyResult(finalResult);
          }
          await updatePersistence(run.result ?? finalResult ?? null, 'completed');
          run.status = 'completed';
          settled = true;
          send({
            type: 'complete',
            responseId,
            remainingCredits,
            letter: (run.result ?? finalResult) as MpLetterSchemaResult,
            usage: (finalResponse as any)?.usage ?? null,
          });
          subject.complete();
        } else {
          throw new Error('Letter generation finished without a usable result');
        }
      }
    } catch (error) {
      this.logger.error(
        `[writing-desk letter] failure ${error instanceof Error ? error.message : 'unknown'}`,
      );

      if (deductionApplied && !settled) {
        await this.refundCredits(userId, LETTER_CREDIT_COST);
        remainingCredits =
          typeof remainingCredits === 'number'
            ? Math.round((remainingCredits + LETTER_CREDIT_COST) * 100) / 100
            : null;
      }

      run.status = 'error';

      try {
        await updatePersistence(run.result ?? null, 'error');
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist letter error state for user ${userId}: ${(persistError as Error)?.message ?? persistError}`,
        );
      }

      const message =
        error instanceof BadRequestException
          ? error.message
          : 'Letter generation failed. Please try again in a few moments.';

      send({ type: 'error', message, remainingCredits });
      subject.complete();
    } finally {
      if (!settled && openAiStream?.controller) {
        try {
          openAiStream.controller.abort();
        } catch (abortError) {
          this.logger.warn(
            `Failed to abort letter stream: ${(abortError as Error)?.message ?? 'unknown error'}`,
          );
        }
      }

      this.scheduleLetterRunCleanup(run);
    }
  }

  private getLetterRunKey(userId: string, jobId: string): string {
    return `letter:${userId}::${jobId}`;
  }

  private getDeepResearchRunKey(userId: string, jobId: string): string {
    return `${userId}::${jobId}`;
  }

  private scheduleRunCleanup(run: DeepResearchRun) {
    if (run.cleanupTimer) {
      clearTimeout(run.cleanupTimer);
    }
    const timer = setTimeout(() => {
      this.deepResearchRuns.delete(run.key);
    }, DEEP_RESEARCH_RUN_TTL_MS);
    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    run.cleanupTimer = timer as NodeJS.Timeout;
  }

  private scheduleLetterRunCleanup(run: LetterRun) {
    if (run.cleanupTimer) {
      clearTimeout(run.cleanupTimer);
    }
    const timer = setTimeout(() => {
      this.letterRuns.delete(run.key);
    }, LETTER_RUN_TTL_MS);
    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
    run.cleanupTimer = timer as NodeJS.Timeout;
  }

  private async waitForBackgroundResponseCompletion(client: any, responseId: string) {
    const startedAt = Date.now();

    while (true) {
      try {
        const response = await client.responses.retrieve(responseId);
        const status = (response as any)?.status ?? null;

        if (!status || status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'incomplete') {
          return response;
        }

        if (Date.now() - startedAt >= BACKGROUND_POLL_TIMEOUT_MS) {
          throw new Error('Timed out waiting for deep research to finish');
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Timed out waiting')) {
          throw error;
        }
        if (Date.now() - startedAt >= BACKGROUND_POLL_TIMEOUT_MS) {
          throw new Error('Timed out waiting for deep research to finish');
        }
        this.logger.warn(
          `[writing-desk research] failed to retrieve background response ${responseId}: ${
            (error as Error)?.message ?? error
          }`,
        );
      }

      await this.delay(BACKGROUND_POLL_INTERVAL_MS);
    }
  }

  private buildBackgroundFailureMessage(response: any, status: string | null | undefined): string {
    const errorMessage = response?.error?.message;
    if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
      return errorMessage.trim();
    }

    const incompleteReason = response?.incomplete_details?.reason;
    if (typeof incompleteReason === 'string' && incompleteReason.trim().length > 0) {
      return incompleteReason.trim();
    }

    switch (status) {
      case 'cancelled':
        return 'Deep research was cancelled.';
      case 'failed':
      case 'incomplete':
        return 'Deep research failed. Please try again in a few moments.';
      default:
        return 'Deep research finished without a usable result. Please try again in a few moments.';
    }
  }

  private async persistDeepResearchStatus(
    userId: string,
    fallback: ActiveWritingDeskJobResource,
    status: WritingDeskResearchStatus,
  ) {
    const latest = await this.writingDeskJobs.getActiveJobForUser(userId);
    const job = latest ?? fallback;
    const payload = this.buildResearchUpsertPayload(job, { status });
    await this.writingDeskJobs.upsertActiveJob(userId, payload);
  }

  private async resolveActiveWritingDeskJob(
    userId: string,
    jobId: string | null,
  ): Promise<ActiveWritingDeskJobResource> {
    const job = await this.writingDeskJobs.getActiveJobForUser(userId);
    if (!job) {
      throw new BadRequestException(
        'We could not find an active letter to research. Save your answers and try again.',
      );
    }
    if (jobId && job.jobId !== jobId) {
      throw new BadRequestException(
        'Your saved letter changed. Refresh the page before running deep research again.',
      );
    }
    return job;
  }

  private buildDeepResearchPrompt(
    job: ActiveWritingDeskJobResource,
    options?: { mpName?: string | null },
  ): string {
    const sections: string[] = [
      'Research the issue described below and gather supporting facts, quotes, and statistics from credible, up-to-date sources.',
      "Before analysing the constituent's issue, confirm today's date and summarise the current composition of the UK Parliament, including who holds power, major opposition parties, and any recent leadership changes, citing authoritative sources.",
      'Provide a structured evidence report with inline citations for every key fact. Cite URLs or publication titles for each data point.',
      '',
      `Constituent description: ${this.normalisePromptField(job.form?.issueDescription, 'Not provided.')}`,
    ];

    const mpName = typeof options?.mpName === 'string' ? options.mpName.trim() : '';
    if (mpName) {
      sections.push(
        '',
        `Target MP: ${mpName}`,
        `Include a brief profile of ${mpName}, covering their background, priorities, and recent parliamentary activity relevant to this issue.`,
        `Identify persuasive angles that could help ${mpName} empathise with the constituent's situation (shared priorities, constituency impact, past statements, or committee work).`,
      );
    }

    if (Array.isArray(job.followUpQuestions) && job.followUpQuestions.length > 0) {
      sections.push('', 'Additional Context from Q&A:');
      job.followUpQuestions.forEach((question, index) => {
        const answer = job.followUpAnswers?.[index] ?? '';
        const q = question?.trim?.() ?? '';
        const a = answer?.trim?.() ?? '';
        sections.push(`Q${index + 1}: ${q || 'No question provided.'}`);
        sections.push(`A${index + 1}: ${a || 'No answer provided.'}`);
      });
    }

    if (job.notes?.trim()) {
      sections.push('', `Notes: ${job.notes.trim()}`);
    }

    sections.push(
      '',
      'Output Requirements:',
      '- Group evidence by theme or timeline using short paragraphs or bullet lists.',
      '- Include inline citations with source name and URL for every statistic, quote, or claim.',
      '- Prioritise authoritative sources (government publications, official statistics, reputable journalism).',
      '- Highlight material published within the last three years whenever available.',
      '- Call out any gaps in public evidence instead of guessing.',
    );

    return sections.join('\n');
  }

  private async buildLetterContext(
    userId: string,
    job: ActiveWritingDeskJobResource,
  ): Promise<LetterContext> {
    const today = new Date();
    const date = today.toISOString().slice(0, 10);

    let senderName = '';
    try {
      const user = await this.users.findById(userId);
      if (user && typeof (user as any)?.name === 'string') {
        const trimmed = ((user as any).name as string).trim();
        senderName = trimmed.length > 0 ? trimmed : '';
      }
    } catch (error) {
      this.logger.warn(
        `[writing-desk letter] failed to resolve user name for ${userId}: ${(error as Error)?.message ?? error}`,
      );
    }

    const senderAddress = { address1: '', address2: '', address3: '', city: '', county: '', postcode: '' };
    try {
      const stored = await this.userAddress.getMine(userId);
      const address = stored?.address ?? null;
      if (address) {
        senderAddress.address1 = address.line1 ?? '';
        senderAddress.address2 = address.line2 ?? '';
        senderAddress.address3 = '';
        senderAddress.city = address.city ?? '';
        senderAddress.county = address.county ?? '';
        senderAddress.postcode = address.postcode ?? '';
      }
    } catch (error) {
      this.logger.warn(
        `[writing-desk letter] failed to resolve sender address for ${userId}: ${(error as Error)?.message ?? error}`,
      );
    }

    let mpName = '';
    let mpConstituency = '';
    let mpParty = '';
    let mpEmail = '';
    let mpWebsite = '';
    let mpTwitter = '';
    let mpParliamentaryAddress = '';
    let mpAddress = { line1: '', line2: '', city: '', county: '', postcode: '' };

    try {
      const record = await this.userMp.getMine(userId);
      if (record) {
        mpConstituency = typeof record.constituency === 'string' ? record.constituency : '';
        const mp = record.mp ?? null;
        if (mp) {
          mpName = typeof mp.name === 'string' ? mp.name : '';
          mpParty = typeof mp.party === 'string' ? mp.party : '';
          mpEmail = typeof mp.email === 'string' ? mp.email : '';
          mpWebsite = typeof mp.website === 'string' ? mp.website : '';
          mpTwitter = typeof mp.twitter === 'string' ? mp.twitter : '';
          mpParliamentaryAddress = typeof mp.parliamentaryAddress === 'string' ? mp.parliamentaryAddress : '';
          mpAddress = this.splitAddressForSchema(mpParliamentaryAddress);
        }
      }
    } catch (error) {
      this.logger.warn(
        `[writing-desk letter] failed to resolve MP profile for ${userId}: ${(error as Error)?.message ?? error}`,
      );
    }

    const followUps: Array<{ question: string; answer: string }> = [];
    if (Array.isArray(job.followUpQuestions)) {
      job.followUpQuestions.forEach((question, index) => {
        const q = typeof question === 'string' ? question : '';
        const a = Array.isArray(job.followUpAnswers) ? job.followUpAnswers[index] ?? '' : '';
        followUps.push({ question: q, answer: typeof a === 'string' ? a : '' });
      });
    }

    return {
      date,
      mp: {
        name: mpName,
        constituency: mpConstituency,
        party: mpParty,
        email: mpEmail,
        website: mpWebsite,
        twitter: mpTwitter,
        parliamentaryAddress: mpParliamentaryAddress,
        address: mpAddress,
      },
      sender: {
        name: senderName,
        ...senderAddress,
      },
      followUps,
      intake: job.form?.issueDescription ?? '',
      notes: job.notes ?? null,
      research: job.researchContent ?? '',
    };
  }

  private buildLetterPrompt(input: {
    job: ActiveWritingDeskJobResource;
    tone: WritingDeskLetterTone;
    context: LetterContext;
  }): string {
    const { tone, context } = input;
    const lines: string[] = [];

    lines.push('System / Developer Instructions for MP Letter Composer');
    lines.push('You are generating a UK MP letter using stored MP and sender details plus prior user inputs.');
    lines.push('');
    lines.push('Goals:');
    lines.push('1. Return output strictly conforming to the provided JSON schema.');
    lines.push('2. Use stored MP profile for mp_* fields and stored sender profile for sender_*.');
    lines.push('3. Set date to match the schema’s regex: ^\\d{4}-\\d{2}-\\d{2}$.');
    lines.push('4. Put the full HTML letter in letter_content. Use semantic HTML only (<p>, <strong>, <em>, lists).');
    lines.push('5. Write in the tone selected by the user.');
    lines.push('6. Draw on all prior inputs (intake, follow-ups, deep research).');
    lines.push('7. Include only accurate, supportable statements. Add actual URLs used into the references array.');
    lines.push('8. If any stored values are missing, output an empty string for that field, but keep the schema valid.');

    lines.push('');
    lines.push(`Today’s date: ${context.date}. Tone: ${this.describeLetterTone(tone)}.`);

    lines.push('');
    lines.push('Stored MP profile:');
    lines.push(`- Name: ${context.mp.name}`);
    lines.push(`- Constituency: ${context.mp.constituency}`);
    lines.push(`- Party: ${context.mp.party}`);
    lines.push(`- Email: ${context.mp.email}`);
    lines.push(`- Website: ${context.mp.website}`);
    lines.push(`- Twitter: ${context.mp.twitter}`);
    lines.push(`- Parliamentary address: ${context.mp.parliamentaryAddress}`);
    lines.push(
      `- Address fields: line1=${context.mp.address.line1}, line2=${context.mp.address.line2}, city=${context.mp.address.city}, county=${context.mp.address.county}, postcode=${context.mp.address.postcode}`,
    );

    lines.push('');
    lines.push('Stored sender profile:');
    lines.push(`- Name: ${context.sender.name}`);
    lines.push(
      `- Address lines: line1=${context.sender.address1}, line2=${context.sender.address2}, line3=${context.sender.address3}`,
    );
    lines.push(`- City: ${context.sender.city}`);
    lines.push(`- County: ${context.sender.county}`);
    lines.push(`- Postcode: ${context.sender.postcode}`);

    lines.push('');
    lines.push('Constituent intake (issue description):');
    lines.push(context.intake || '');

    if (context.notes) {
      lines.push('');
      lines.push(`Additional notes: ${context.notes}`);
    }

    lines.push('');
    lines.push('Follow-up Q&A:');
    if (context.followUps.length === 0) {
      lines.push('- None provided.');
    } else {
      context.followUps.forEach((entry, index) => {
        lines.push(`Q${index + 1}: ${entry.question}`);
        lines.push(`A${index + 1}: ${entry.answer}`);
      });
    }

    lines.push('');
    lines.push('Deep research output (Markdown):');
    lines.push(context.research || '');

    lines.push('');
    lines.push('Letter content requirements:');
    lines.push('- Opening: state the issue and constituency link.');
    lines.push('- Body: evidence-led argument in the chosen tone.');
    lines.push('- Ask: specific, actionable request of the MP.');
    lines.push('- Closing: professional and courteous.');

    lines.push('');
    lines.push('Output: Return only the JSON object defined by the schema. Do not output explanations or text outside the JSON.');

    return lines.join('\n');
  }

  private buildLetterStub(input: {
    job: ActiveWritingDeskJobResource;
    tone: WritingDeskLetterTone;
    context: LetterContext;
  }): MpLetterSchemaResult {
    const { context } = input;
    const mpName = context.mp.name || 'Member of Parliament';
    const constituency = context.mp.constituency || 'your constituency';
    const senderName = context.sender.name || 'A concerned constituent';
    const issue = context.intake?.trim() ? context.intake.trim() : 'No detailed issue description was provided.';
    const researchSnippet = context.research?.trim()
      ? `Here is a snapshot of the evidence we collected:\n${context.research.split('\n').slice(0, 6).join('\n')}`
      : '';

    const body: string[] = [];
    body.push(`<p>Dear ${mpName},</p>`);
    body.push(
      `<p>I am writing as a resident of ${constituency} to raise the following issue which is affecting me and my community.</p>`,
    );
    body.push(`<p>${issue}</p>`);
    if (researchSnippet) {
      body.push(`<p>${researchSnippet}</p>`);
    }
    body.push(
      '<p>I would be grateful if you could review this situation, raise it with the relevant decision-makers, and let me know how you can help to resolve it.</p>',
    );
    body.push('<p>Thank you for your time and attention.</p>');
    body.push(`<p>Yours sincerely,<br />${senderName}</p>`);

    const mpAddress = context.mp.address;

    return {
      mp_name: context.mp.name ?? '',
      mp_address_1: mpAddress.line1 ?? '',
      mp_address_2: mpAddress.line2 ?? '',
      mp_city: mpAddress.city ?? '',
      mp_county: mpAddress.county ?? '',
      mp_postcode: mpAddress.postcode ?? '',
      date: context.date,
      letter_content: body.join('\n'),
      sender_name: senderName,
      sender_address_1: context.sender.address1 ?? '',
      sender_address_2: context.sender.address2 ?? '',
      sender_address_3: context.sender.address3 ?? '',
      sender_city: context.sender.city ?? '',
      sender_county: context.sender.county ?? '',
      sender_postcode: context.sender.postcode ?? '',
      references: [],
    };
  }

  private describeLetterTone(tone: WritingDeskLetterTone): string {
    switch (tone) {
      case 'formal':
        return 'a formal, respectful tone';
      case 'polite_but_firm':
        return 'a polite but firm tone';
      case 'empathetic':
        return 'an empathetic tone';
      case 'urgent':
        return 'an urgent tone';
      case 'neutral':
      default:
        return 'a neutral, clear tone';
    }
  }

  private splitAddressForSchema(raw: string | null | undefined) {
    if (typeof raw !== 'string') {
      return { line1: '', line2: '', city: '', county: '', postcode: '' };
    }

    const parts = raw
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const postcodeIndex = parts.findIndex((value) => /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(value));
    let postcode = '';
    if (postcodeIndex >= 0) {
      postcode = parts.splice(postcodeIndex, 1)[0];
    }

    const line1 = parts.shift() ?? '';
    const line2 = parts.shift() ?? '';
    const city = parts.shift() ?? '';
    const county = parts.shift() ?? '';

    return { line1, line2, city, county, postcode };
  }

  private normalisePromptField(value: string | null | undefined, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private buildDeepResearchStub(
    job: ActiveWritingDeskJobResource,
    options?: { mpName?: string | null },
  ) {
    const mpName = typeof options?.mpName === 'string' ? options.mpName.trim() : '';
    const lines = [
      'DEV-STUB deep research summary (no external research was performed).',
      '',
      `• Issue summary: ${this.truncateForStub(job.form?.issueDescription)}`,
      '',
      'Suggested evidence to look for:',
      '1. Recent government or regulator statistics quantifying the scale of the issue.',
      '2. Quotes from reputable organisations, MPs, or investigative journalism covering the topic.',
      '3. Current policy commitments or funding schemes that relate to the requested outcome.',
      '',
      mpName
        ? `Target MP (${mpName}): Research their background, interests, and public statements to find empathy hooks.`
        : 'Target MP: Add notes about your MP to tailor the evidence and empathy angles.',
      '',
      'Sources to consider:',
      '- GOV.UK and departmental research portals (latest releases).',
      '- Office for National Statistics datasets relevant to the subject.',
      '- Reputable national journalism such as the BBC, The Guardian, or Financial Times.',
    ];

    const content = lines.join('\n');
    const chunks = [
      `${lines[0]}\n\n`,
      `${lines[2]}\n${lines[3]}\n${lines[4]}\n\n`,
      `${lines[6]}\n${lines[7]}\n${lines[8]}\n${lines[9]}\n\n`,
      `${lines[11]}\n\n`,
      `${lines[13]}\n${lines[14]}\n${lines[15]}\n${lines[16]}`,
    ];

    return { content, chunks };
  }

  private truncateForStub(value: string | null | undefined): string {
    if (typeof value !== 'string') return 'Not provided.';
    const trimmed = value.trim();
    if (trimmed.length <= 160) return trimmed || 'Not provided.';
    return `${trimmed.slice(0, 157)}…`;
  }

  private buildDeepResearchRequestExtras(model?: string | null): DeepResearchRequestExtras {
    const tools: Array<Record<string, unknown>> = [];

    const enableWebSearch = this.parseBooleanEnv(
      this.config.get<string>('OPENAI_DEEP_RESEARCH_ENABLE_WEB_SEARCH'),
      true,
    );
    if (enableWebSearch) {
      const tool: Record<string, unknown> = { type: 'web_search_preview' };
      const contextSize = this.config
        .get<string>('OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE')
        ?.trim();
      if (contextSize) {
        const normalisedSize = contextSize.toLowerCase();
        if (['low', 'medium', 'high'].includes(normalisedSize)) {
          tool.search_context_size = normalisedSize;
        }
      }
      tools.push(tool);
    }

    const vectorStoreRaw = this.config.get<string>('OPENAI_DEEP_RESEARCH_VECTOR_STORE_IDS')?.trim();
    if (vectorStoreRaw) {
      const vectorStoreIds = vectorStoreRaw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (vectorStoreIds.length > 0) {
        tools.push({ type: 'file_search', vector_store_ids: vectorStoreIds });
      }
    }

    const enableCodeInterpreter = this.parseBooleanEnv(
      this.config.get<string>('OPENAI_DEEP_RESEARCH_ENABLE_CODE_INTERPRETER'),
      false,
    );
    if (enableCodeInterpreter) {
      tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
    }

    const extras: DeepResearchRequestExtras = {};
    if (tools.length > 0) {
      extras.tools = tools;
    }

    const maxToolCalls = this.parseOptionalInt(
      this.config.get<string>('OPENAI_DEEP_RESEARCH_MAX_TOOL_CALLS'),
    );
    if (typeof maxToolCalls === 'number' && maxToolCalls > 0) {
      extras.max_tool_calls = maxToolCalls;
    }

    const reasoningSummaryRaw = this.config
      .get<string>('OPENAI_DEEP_RESEARCH_REASONING_SUMMARY')
      ?.trim()
      .toLowerCase();
    const reasoningEffortRaw = this.config
      .get<string>('OPENAI_DEEP_RESEARCH_REASONING_EFFORT')
      ?.trim()
      .toLowerCase();

    let reasoningSummary: 'auto' | 'disabled' | null = 'auto';
    if (reasoningSummaryRaw === 'disabled') {
      reasoningSummary = 'disabled';
    } else if (reasoningSummaryRaw === 'auto') {
      reasoningSummary = 'auto';
    }

    const requestedEffort: 'low' | 'medium' | 'high' =
      reasoningEffortRaw === 'low' || reasoningEffortRaw === 'high'
        ? (reasoningEffortRaw as 'low' | 'high')
        : 'medium';

    const supportedEfforts = this.getSupportedReasoningEfforts(model);
    const fallbackEffort = supportedEfforts.includes('medium') ? 'medium' : supportedEfforts[0];
    const reasoningEffort = supportedEfforts.includes(requestedEffort)
      ? requestedEffort
      : fallbackEffort;

    if (requestedEffort !== reasoningEffort) {
      this.logger.warn(
        `[writing-desk research] reasoning effort "${requestedEffort}" is not supported for model "${
          model ?? 'unknown'
        }" – falling back to "${reasoningEffort}"`,
      );
    }

    extras.reasoning = {
      summary: reasoningSummary,
      effort: reasoningEffort,
    };

    return extras;
  }

  private getSupportedReasoningEfforts(model?: string | null): Array<'low' | 'medium' | 'high'> {
    if (!model) {
      return ['medium'];
    }

    const normalisedModel = model.trim().toLowerCase();
    if (normalisedModel === 'o4-mini-deep-research' || normalisedModel.startsWith('o4-mini-deep-research@')) {
      return ['medium'];
    }

    return ['low', 'medium', 'high'];
  }

  private async resolveUserMpName(userId: string): Promise<string | null> {
    try {
      const record = await this.userMp.getMine(userId);
      const rawName = (record as any)?.mp?.name;
      if (typeof rawName === 'string') {
        const trimmed = rawName.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    } catch (error) {
      this.logger.warn(
        `[writing-desk research] failed to resolve MP name for user ${userId}: ${(error as Error)?.message ?? error}`,
      );
    }
    return null;
  }

  private parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
    if (typeof raw !== 'string') return fallback;
    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
  }

  private parseOptionalInt(raw: string | undefined): number | null {
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private async persistDeepResearchResult(
    userId: string,
    fallback: ActiveWritingDeskJobResource,
    result: {
      content?: string | null | undefined;
      responseId?: string | null | undefined;
      status?: WritingDeskResearchStatus | null | undefined;
    },
  ) {
    const latest = await this.writingDeskJobs.getActiveJobForUser(userId);
    const job = latest ?? fallback;
    const payload = this.buildResearchUpsertPayload(job, result);
    await this.writingDeskJobs.upsertActiveJob(userId, payload);
  }

  private buildResearchUpsertPayload(
    job: ActiveWritingDeskJobResource,
    result: {
      content?: string | null | undefined;
      responseId?: string | null | undefined;
      status?: WritingDeskResearchStatus | null | undefined;
    },
  ): UpsertActiveWritingDeskJobDto {
    const payload: UpsertActiveWritingDeskJobDto = {
      jobId: job.jobId,
      phase: job.phase,
      stepIndex: job.stepIndex,
      followUpIndex: job.followUpIndex,
      form: {
        issueDescription: job.form?.issueDescription ?? '',
      },
      followUpQuestions: Array.isArray(job.followUpQuestions) ? [...job.followUpQuestions] : [],
      followUpAnswers: Array.isArray(job.followUpAnswers) ? [...job.followUpAnswers] : [],
      notes: job.notes ?? undefined,
      responseId: job.responseId ?? undefined,
      researchStatus: job.researchStatus ?? 'idle',
    };

    const existingContent = this.normaliseResearchContent(job.researchContent ?? null);
    if (existingContent !== null) {
      payload.researchContent = existingContent;
    }

    const nextContent = this.normaliseResearchContent(result.content ?? null);
    if (nextContent !== null) {
      payload.researchContent = nextContent;
    } else if (!payload.researchContent) {
      payload.researchContent = undefined;
    }

    const existingResponseId = job.researchResponseId?.toString?.().trim?.();
    if (existingResponseId) {
      payload.researchResponseId = existingResponseId;
    }

    const researchResponseId = result.responseId?.toString?.().trim?.();
    if (researchResponseId) {
      payload.researchResponseId = researchResponseId;
    }

    if (result.status) {
      payload.researchStatus = result.status;
    }

    if (job.letterTone) {
      payload.letterTone = job.letterTone;
    }

    const existingLetterContent = this.normaliseResearchContent(job.letterContent ?? null);
    if (existingLetterContent !== null) {
      payload.letterContent = existingLetterContent;
    }

    const existingLetterResponseId = job.letterResponseId?.toString?.().trim?.();
    if (existingLetterResponseId) {
      payload.letterResponseId = existingLetterResponseId;
    }

    if (job.letterStatus) {
      payload.letterStatus = job.letterStatus;
    }

    if (Array.isArray(job.letterReferences) && job.letterReferences.length > 0) {
      payload.letterReferences = job.letterReferences.filter((value) => typeof value === 'string' && value.trim().length > 0);
    }

    const existingLetterResult = job.letterResult?.toString?.().trim?.();
    if (existingLetterResult) {
      payload.letterResult = existingLetterResult;
    }

    return payload;
  }

  private async persistLetterResult(
    userId: string,
    fallback: ActiveWritingDeskJobResource,
    result: {
      tone?: WritingDeskLetterTone | null | undefined;
      content?: string | null | undefined;
      responseId?: string | null | undefined;
      status?: WritingDeskLetterStatus | null | undefined;
      references?: string[] | null | undefined;
      resultJson?: string | null | undefined;
    },
  ) {
    const latest = await this.writingDeskJobs.getActiveJobForUser(userId);
    const job = latest ?? fallback;
    const payload = this.buildLetterUpsertPayload(job, result);
    await this.writingDeskJobs.upsertActiveJob(userId, payload);
  }

  private buildLetterUpsertPayload(
    job: ActiveWritingDeskJobResource,
    result: {
      tone?: WritingDeskLetterTone | null | undefined;
      content?: string | null | undefined;
      responseId?: string | null | undefined;
      status?: WritingDeskLetterStatus | null | undefined;
      references?: string[] | null | undefined;
      resultJson?: string | null | undefined;
    },
  ): UpsertActiveWritingDeskJobDto {
    const payload: UpsertActiveWritingDeskJobDto = {
      jobId: job.jobId,
      phase: job.phase,
      stepIndex: job.stepIndex,
      followUpIndex: job.followUpIndex,
      form: {
        issueDescription: job.form?.issueDescription ?? '',
      },
      followUpQuestions: Array.isArray(job.followUpQuestions) ? [...job.followUpQuestions] : [],
      followUpAnswers: Array.isArray(job.followUpAnswers) ? [...job.followUpAnswers] : [],
      notes: job.notes ?? undefined,
      responseId: job.responseId ?? undefined,
      researchStatus: job.researchStatus ?? 'idle',
    };

    const researchContent = this.normaliseResearchContent(job.researchContent ?? null);
    if (researchContent !== null) {
      payload.researchContent = researchContent;
    }

    const researchResponseId = job.researchResponseId?.toString?.().trim?.();
    if (researchResponseId) {
      payload.researchResponseId = researchResponseId;
    }

    const tone = result.tone ?? job.letterTone ?? null;
    if (tone) {
      payload.letterTone = tone;
    }

    const existingLetterContent = this.normaliseResearchContent(job.letterContent ?? null);
    if (existingLetterContent !== null) {
      payload.letterContent = existingLetterContent;
    }

    const nextLetterContent = this.normaliseResearchContent(result.content ?? null);
    if (nextLetterContent !== null) {
      payload.letterContent = nextLetterContent;
    } else if (!payload.letterContent) {
      payload.letterContent = undefined;
    }

    const existingLetterResponseId = job.letterResponseId?.toString?.().trim?.();
    if (existingLetterResponseId) {
      payload.letterResponseId = existingLetterResponseId;
    }

    const nextLetterResponseId = result.responseId?.toString?.().trim?.();
    if (nextLetterResponseId) {
      payload.letterResponseId = nextLetterResponseId;
    }

    const references = this.normaliseLetterReferences(
      Array.isArray(result.references) && result.references.length > 0
        ? result.references
        : job.letterReferences ?? [],
    );
    if (references.length > 0 || Array.isArray(result.references)) {
      payload.letterReferences = references;
    }

    const existingResult = this.normaliseLetterResultJson(job.letterResult ?? null);
    if (existingResult !== null) {
      payload.letterResult = existingResult;
    }

    const nextResult = this.normaliseLetterResultJson(result.resultJson ?? null);
    if (nextResult !== null) {
      payload.letterResult = nextResult;
    } else if (!payload.letterResult) {
      payload.letterResult = undefined;
    }

    payload.letterStatus = result.status ?? job.letterStatus ?? 'idle';

    return payload;
  }

  private normaliseResearchContent(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalised = value.replace(/\r\n/g, '\n');
    return normalised.trim().length > 0 ? normalised : null;
  }

  private normaliseLetterResultJson(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normaliseLetterReferences(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const refs: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      const signature = trimmed.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(signature)) continue;
      seen.add(signature);
      refs.push(trimmed);
    }
    return refs;
  }

  private tryParseLetterResult(raw: string | null | undefined): MpLetterSchemaResult | null {
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw) as Partial<MpLetterSchemaResult>;
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.letter_content !== 'string') return null;
      const references = this.normaliseLetterReferences(parsed.references ?? []);
      return {
        mp_name: parsed.mp_name ?? '',
        mp_address_1: parsed.mp_address_1 ?? '',
        mp_address_2: parsed.mp_address_2 ?? '',
        mp_city: parsed.mp_city ?? '',
        mp_county: parsed.mp_county ?? '',
        mp_postcode: parsed.mp_postcode ?? '',
        date: parsed.date ?? '',
        letter_content: parsed.letter_content,
        sender_name: parsed.sender_name ?? '',
        sender_address_1: parsed.sender_address_1 ?? '',
        sender_address_2: parsed.sender_address_2 ?? '',
        sender_address_3: parsed.sender_address_3 ?? '',
        sender_city: parsed.sender_city ?? '',
        sender_county: parsed.sender_county ?? '',
        sender_postcode: parsed.sender_postcode ?? '',
        references,
      };
    } catch {
      return null;
    }
  }

  private extractJsonChunk(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const delta = (event as any)?.delta ?? null;
    return this.serialiseJsonDelta(delta);
  }

  private serialiseJsonDelta(delta: unknown): string | null {
    if (delta == null) return null;
    if (typeof delta === 'string') return delta;
    if (Array.isArray(delta)) {
      return delta.map((item) => this.serialiseJsonDelta(item) ?? '').join('');
    }
    if (typeof delta === 'object') {
      if (typeof (delta as any).value === 'string' && Object.keys(delta as any).length === 1) {
        return (delta as any).value as string;
      }
      try {
        return JSON.stringify(delta);
      } catch {
        return null;
      }
    }
    return null;
  }

  private extractLetterResultFromResponse(response: any): MpLetterSchemaResult | null {
    if (!response) return null;
    const outputs = Array.isArray((response as any)?.output) ? (response as any).output : [];
    for (const output of outputs) {
      const content = Array.isArray(output?.content) ? output.content : [];
      for (const part of content) {
        if (typeof part?.text === 'string') {
          const parsed = this.tryParseLetterResult(part.text);
          if (parsed) return parsed;
        }
        if (typeof part?.json === 'object') {
          try {
            const parsed = this.tryParseLetterResult(JSON.stringify(part.json));
            if (parsed) return parsed;
          } catch {
            // ignore
          }
        }
      }
    }

    const text = this.extractFirstText(response);
    if (typeof text === 'string') {
      const parsed = this.tryParseLetterResult(text);
      if (parsed) return parsed;
    }

    return null;
  }

  private normaliseStreamEvent(event: ResponseStreamEvent): Record<string, unknown> {
    if (!event || typeof event !== 'object') {
      return { value: event ?? null };
    }

    try {
      return JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    } catch (error) {
      const plain: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(event as unknown as Record<string, unknown>)) {
        plain[key] = value as unknown;
      }
      if (Object.prototype.hasOwnProperty.call(event, 'type') && !plain.type) {
        plain.type = (event as any).type;
      }
      if (Object.keys(plain).length === 0) {
        plain.serialised = String(event);
      }
      return plain;
    }
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
    const description = input.issueDescription?.trim?.() ?? '';
    const questions: string[] = [];

    if (description.length < 150) {
      questions.push("Could you share a little more detail about what has happened so far?");
    }

    if (!/\b(want|hope|expect|should|ask|seeking|goal)\b/i.test(description)) {
      questions.push('What action or outcome would you like your MP to push for?');
    }

    if (!/\b(family|neighbour|community|business|residents|my children|people)\b/i.test(description)) {
      questions.push('Who is being affected by this issue and how are they impacted?');
    }

    if (!/\b(since|for [0-9]+|weeks|months|years|when)\b/i.test(description)) {
      questions.push('How long has this been going on or when did it start?');
    }

    return questions.slice(0, 5);
  }
}
