import { BadRequestException, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WritingDeskIntakeDto } from './dto/writing-desk-intake.dto';
import { WritingDeskFollowUpDto } from './dto/writing-desk-follow-up.dto';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { WritingDeskJobsService } from '../writing-desk-jobs/writing-desk-jobs.service';
import { UserMpService } from '../user-mp/user-mp.service';
import { UsersService } from '../users/users.service';
import { UserAddressService } from '../user-address-store/user-address.service';
import {
  ActiveWritingDeskJobResource,
  WritingDeskLetterStatus,
  WritingDeskLetterTone,
  WritingDeskResearchStatus,
  WRITING_DESK_LETTER_TONES,
} from '../writing-desk-jobs/writing-desk-jobs.types';
import { UpsertActiveWritingDeskJobDto } from '../writing-desk-jobs/dto/upsert-active-writing-desk-job.dto';
import { Observable, ReplaySubject, Subscription } from 'rxjs';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';

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
  | { type: 'event'; event: Record<string, unknown> }
  | { type: 'delta'; text: string }
  | { type: 'letter_delta'; html: string }
  | {
      type: 'complete';
      letter: LetterCompletePayload;
      remainingCredits: number | null;
    }
  | { type: 'error'; message: string; remainingCredits?: number | null };

interface WritingDeskLetterResult {
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
}

interface LetterCompletePayload {
  mpName: string;
  mpAddress1: string;
  mpAddress2: string;
  mpCity: string;
  mpCounty: string;
  mpPostcode: string;
  date: string;
  letterContent: string;
  senderName: string;
  senderAddress1: string;
  senderAddress2: string;
  senderAddress3: string;
  senderCity: string;
  senderCounty: string;
  senderPostcode: string;
  references: string[];
  responseId: string | null;
  tone: WritingDeskLetterTone;
  rawJson: string;
}

interface LetterDocumentInput {
  mpName?: string | null;
  mpAddress1?: string | null;
  mpAddress2?: string | null;
  mpCity?: string | null;
  mpCounty?: string | null;
  mpPostcode?: string | null;
  date?: string | null;
  letterContentHtml?: string | null;
  senderName?: string | null;
  senderAddress1?: string | null;
  senderAddress2?: string | null;
  senderAddress3?: string | null;
  senderCity?: string | null;
  senderCounty?: string | null;
  senderPostcode?: string | null;
  references?: string[] | null;
}

interface LetterContext {
  mpName: string;
  mpAddress1: string;
  mpAddress2: string;
  mpCity: string;
  mpCounty: string;
  mpPostcode: string;
  constituency: string;
  senderName: string;
  senderAddress1: string;
  senderAddress2: string;
  senderAddress3: string;
  senderCity: string;
  senderCounty: string;
  senderPostcode: string;
  today: string;
}

const LETTER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    mp_name: {
      type: 'string',
      description: "Full name of the Member of Parliament.",
    },
    mp_address_1: {
      type: 'string',
      description: "First line of the MP's address.",
    },
    mp_address_2: {
      type: 'string',
      description: "Second line of the MP's address.",
    },
    mp_city: {
      type: 'string',
      description: "City of the MP's address.",
    },
    mp_county: {
      type: 'string',
      description: "County of the MP's address.",
    },
    mp_postcode: {
      type: 'string',
      description: "Post code of the MP's address.",
    },
    date: {
      type: 'string',
      description: 'Date the letter is written (ISO 8601 format recommended).',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    },
    letter_content: {
      type: 'string',
      description: 'The text body of the letter.',
    },
    sender_name: {
      type: 'string',
      description: 'Name of the person sending the letter.',
    },
    sender_address_1: {
      type: 'string',
      description: "First line of the sender's address.",
    },
    sender_address_2: {
      type: 'string',
      description: "Second line of the sender's address.",
    },
    sender_address_3: {
      type: 'string',
      description: "Third line of the sender's address.",
    },
    sender_city: {
      type: 'string',
      description: "City of the sender's address.",
    },
    sender_county: {
      type: 'string',
      description: "County of the sender's address.",
    },
    sender_postcode: {
      type: 'string',
      description: "Post code of the sender's address.",
    },
    references: {
      type: 'array',
      description: 'List of references or citation URLs.',
      items: {
        type: 'string',
        description: 'Citation or URL used as a reference in the letter.',
      },
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

const LETTER_TONE_DETAILS: Record<WritingDeskLetterTone, { label: string; prompt: string }> = {
  formal: {
    label: 'Formal',
    prompt:
      'Write with formal parliamentary etiquette: respectful, precise, and structured with clear paragraphs.',
  },
  polite_but_firm: {
    label: 'Polite but firm',
    prompt:
      'Maintain polite language while firmly emphasising the urgency and expectation of action.',
  },
  empathetic: {
    label: 'Empathetic',
    prompt:
      'Adopt a compassionate tone that centres the human impact while remaining respectful and solution-focused.',
  },
  urgent: {
    label: 'Urgent',
    prompt:
      'Convey urgency and seriousness without being aggressive. Keep sentences direct and compelling.',
  },
  neutral: {
    label: 'Neutral',
    prompt:
      'Use clear, matter-of-fact language that presents evidence and requests without emotional colouring.',
  },
};

const LETTER_TONE_SIGN_OFFS: Record<WritingDeskLetterTone, string> = {
  formal: 'Yours faithfully,',
  polite_but_firm: 'Yours sincerely,',
  empathetic: 'With thanks for your understanding,',
  urgent: 'Yours urgently,',
  neutral: 'Yours sincerely,',
};

const LETTER_TONE_REQUEST_PREFIX: Record<WritingDeskLetterTone, string> = {
  formal: 'I would be grateful if you could',
  polite_but_firm: 'I need you to',
  empathetic: 'I kindly ask that you',
  urgent: 'Please urgently',
  neutral: 'I ask that you',
};

const LETTER_SYSTEM_PROMPT = `You are generating a UK MP letter using stored MP and sender details plus prior user inputs.

Goals:

1. Return output strictly conforming to the provided JSON schema.
2. Use stored MP profile for mp_* fields and stored sender profile for sender_*.
3. Set date to match the schema’s regex: ^\\d{4}-\\d{2}-\\d{2}$.
4. Put the full HTML letter in letter_content. Use semantic HTML only (<p>, <strong>, <em>, lists).
5. Write in the tone selected by the user.
6. Draw on all prior inputs: user_intake (issue, who is affected, background, requested action); follow_ups (clarifications); deep_research (facts, citations, URLs).
7. Include only accurate, supportable statements. Add actual URLs used into the references array.
8. If any stored values are missing, output an empty string for that field, but keep the schema valid.

Letter content requirements:

* Opening: state the issue and constituency link.
* Body: evidence-led argument in chosen tone.
* Ask: specific, actionable request of the MP.
* Closing: professional and courteous.

Output:
Return only the JSON object defined by the schema. Do not output explanations or text outside the JSON.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openaiClient: any | null = null;
  private readonly deepResearchRuns = new Map<string, DeepResearchRun>();

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
    options?: { jobId?: string | null; tone?: string | null },
  ): Observable<MessageEvent> {
    if (!userId) {
      throw new BadRequestException('User account required');
    }

    const tone = this.normaliseLetterTone(options?.tone ?? null);
    if (!tone) {
      throw new BadRequestException('Select a tone before composing the letter.');
    }

    return new Observable<MessageEvent>((subscriber) => {
      let controller: { abort: () => void } | null = null;
      let closed = false;

      const send = (payload: LetterStreamPayload) => {
        if (!closed && !subscriber.closed) {
          subscriber.next({ data: JSON.stringify(payload) });
        }
      };

      const complete = () => {
        if (!closed && !subscriber.closed) {
          subscriber.complete();
        }
        closed = true;
      };

      (async () => {
        let deductionApplied = false;
        let remainingCredits: number | null = null;
        let baselineJob: ActiveWritingDeskJobResource | null = null;

        try {
          baselineJob = await this.resolveActiveWritingDeskJob(userId, options?.jobId ?? null);

          const researchContent = this.normaliseResearchContent(baselineJob.researchContent ?? null);
          if (!researchContent) {
            throw new BadRequestException('Run deep research before composing the letter.');
          }

          const { credits: creditsAfterCharge } = await this.userCredits.deductFromMine(
            userId,
            LETTER_CREDIT_COST,
          );
          deductionApplied = true;
          remainingCredits = Math.round(creditsAfterCharge * 100) / 100;

          await this.persistLetterState(userId, baselineJob, {
            status: 'generating',
            tone,
            responseId: null,
            content: null,
            references: [],
            json: null,
          });

          send({ type: 'status', status: 'Composing your letter…', remainingCredits });

          const apiKey = this.config.get<string>('OPENAI_API_KEY');
          const model = this.config.get<string>('OPENAI_LETTER_MODEL')?.trim() || 'gpt-5';
          const verbosity = this.normaliseLetterVerbosity(
            this.config.get<string>('OPENAI_LETTER_VERBOSITY'),
          );
          const reasoningEffort = this.normaliseLetterReasoningEffort(
            model,
            this.config.get<string>('OPENAI_LETTER_REASONING_EFFORT'),
          );

          const context = await this.resolveLetterContext(userId);
          const research = researchContent;
          const prompt = this.buildLetterPrompt({ job: baselineJob, tone, context, research });

          if (!apiKey) {
            const stub = this.buildStubLetter({ job: baselineJob, tone, context, research });
            const stubDocument = this.buildLetterDocumentHtml({
              mpName: stub.mp_name,
              mpAddress1: stub.mp_address_1,
              mpAddress2: stub.mp_address_2,
              mpCity: stub.mp_city,
              mpCounty: stub.mp_county,
              mpPostcode: stub.mp_postcode,
              date: stub.date,
              letterContentHtml: stub.letter_content,
              senderName: stub.sender_name,
              senderAddress1: stub.sender_address_1,
              senderAddress2: stub.sender_address_2,
              senderAddress3: stub.sender_address_3,
              senderCity: stub.sender_city,
              senderCounty: stub.sender_county,
              senderPostcode: stub.sender_postcode,
              references: stub.references,
            });
            const rawJson = JSON.stringify(stub);
            await this.persistLetterResult(userId, baselineJob, {
              status: 'completed',
              tone,
              responseId: 'dev-stub',
              content: stubDocument,
              references: stub.references ?? [],
              json: rawJson,
            });
            send({ type: 'letter_delta', html: stubDocument });
            send({
              type: 'complete',
              letter: this.toLetterCompletePayload(
                { ...stub, letter_content: stubDocument },
                {
                  responseId: 'dev-stub',
                  tone,
                  rawJson,
                },
              ),
              remainingCredits,
            });
            complete();
            return;
          }

          const client = await this.getOpenAiClient(apiKey);

          const stream = client.responses.stream({
            model,
            input: [
              { role: 'system', content: [{ type: 'input_text', text: this.buildLetterSystemPrompt() }] },
              { role: 'user', content: [{ type: 'input_text', text: prompt }] },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'mp_letter',
                strict: true,
                schema: LETTER_RESPONSE_SCHEMA,
              },
              verbosity,
            },
            reasoning: {
              effort: reasoningEffort,
              summary: 'auto',
            },
            tools: [],
            store: true,
            include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
          }) as ResponseStreamLike;

          controller = stream.controller ?? null;

          let jsonBuffer = '';

          for await (const event of stream) {
            const normalised = this.normaliseStreamEvent(event);
            const eventType = typeof normalised.type === 'string' ? normalised.type : null;

            if (eventType?.startsWith('response.reasoning')) {
              send({ type: 'event', event: normalised });
              continue;
            }

            if (eventType === 'response.output_text.delta') {
              const delta = this.extractOutputTextDelta(normalised);
              if (delta) {
                jsonBuffer += delta;
                send({ type: 'delta', text: delta });
                const preview = this.extractLetterPreview(jsonBuffer);
                if (preview !== null) {
                  const previewDocument = this.buildLetterDocumentHtml({
                    mpName: context.mpName,
                    mpAddress1: context.mpAddress1,
                    mpAddress2: context.mpAddress2,
                    mpCity: context.mpCity,
                    mpCounty: context.mpCounty,
                    mpPostcode: context.mpPostcode,
                    date: context.today,
                    letterContentHtml: preview,
                    senderName: context.senderName,
                    senderAddress1: context.senderAddress1,
                    senderAddress2: context.senderAddress2,
                    senderAddress3: context.senderAddress3,
                    senderCity: context.senderCity,
                    senderCounty: context.senderCounty,
                    senderPostcode: context.senderPostcode,
                    references: [],
                  });
                  send({ type: 'letter_delta', html: previewDocument });
                }
              }
              continue;
            }

            if (eventType === 'response.output_text.done') {
              const preview = this.extractLetterPreview(jsonBuffer);
              if (preview !== null) {
                const previewDocument = this.buildLetterDocumentHtml({
                  mpName: context.mpName,
                  mpAddress1: context.mpAddress1,
                  mpAddress2: context.mpAddress2,
                  mpCity: context.mpCity,
                  mpCounty: context.mpCounty,
                  mpPostcode: context.mpPostcode,
                  date: context.today,
                  letterContentHtml: preview,
                  senderName: context.senderName,
                  senderAddress1: context.senderAddress1,
                  senderAddress2: context.senderAddress2,
                  senderAddress3: context.senderAddress3,
                  senderCity: context.senderCity,
                  senderCounty: context.senderCounty,
                  senderPostcode: context.senderPostcode,
                  references: [],
                });
                send({ type: 'letter_delta', html: previewDocument });
              }
              continue;
            }

            if (eventType === 'response.completed') {
              const responseId = (normalised as any)?.response?.id ?? null;
              const finalText = this.extractFirstText((normalised as any)?.response) ?? jsonBuffer;
              const parsed = this.parseLetterResult(finalText);
              const references = Array.isArray(parsed.references) ? parsed.references : [];
              const finalDocument = this.buildLetterDocumentHtml({
                mpName: parsed.mp_name,
                mpAddress1: parsed.mp_address_1,
                mpAddress2: parsed.mp_address_2,
                mpCity: parsed.mp_city,
                mpCounty: parsed.mp_county,
                mpPostcode: parsed.mp_postcode,
                date: parsed.date,
                letterContentHtml: parsed.letter_content,
                senderName: parsed.sender_name,
                senderAddress1: parsed.sender_address_1,
                senderAddress2: parsed.sender_address_2,
                senderAddress3: parsed.sender_address_3,
                senderCity: parsed.sender_city,
                senderCounty: parsed.sender_county,
                senderPostcode: parsed.sender_postcode,
                references,
              });

              await this.persistLetterResult(userId, baselineJob, {
                status: 'completed',
                tone,
                responseId,
                content: finalDocument,
                references,
                json: finalText,
              });

              send({ type: 'letter_delta', html: finalDocument });

              send({
                type: 'complete',
                letter: this.toLetterCompletePayload(
                  { ...parsed, letter_content: finalDocument },
                  {
                    responseId,
                    tone,
                    rawJson: finalText,
                  },
                ),
                remainingCredits,
              });
              complete();
              return;
            }

            if (eventType === 'response.error' || eventType === 'response.failed') {
              const message =
                typeof (normalised as any)?.error?.message === 'string'
                  ? ((normalised as any).error.message as string)
                  : 'Letter composition failed. Please try again in a few moments.';
              throw new Error(message);
            }
          }

          throw new Error('Letter composition ended unexpectedly. Please try again in a few moments.');
        } catch (error) {
          if (deductionApplied) {
            await this.refundCredits(userId, LETTER_CREDIT_COST);
            if (typeof remainingCredits === 'number') {
              remainingCredits = Math.round((remainingCredits + LETTER_CREDIT_COST) * 100) / 100;
            }
          }

          if (baselineJob) {
            try {
              await this.persistLetterState(userId, baselineJob, { status: 'error', tone });
            } catch (persistError) {
              this.logger.warn(
                `Failed to persist letter error state for user ${userId}: ${(persistError as Error)?.message ?? persistError}`,
              );
            }
          }

          const message =
            error instanceof BadRequestException
              ? error.message
              : 'Letter composition failed. Please try again in a few moments.';

          send({ type: 'error', message, remainingCredits });
          complete();
        } finally {
          if (controller) {
            try {
              controller.abort();
            } catch {
              // ignore
            }
          }
        }
      })();

      return () => {
        closed = true;
        if (controller) {
          try {
            controller.abort();
          } catch {
            // ignore
          }
        }
      };
    });
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
    const payload = this.buildBaseUpsertPayload(job);

    const nextContent = this.normaliseResearchContent(result.content ?? null);
    if (nextContent !== null) {
      payload.researchContent = nextContent;
    }

    const researchResponseId = result.responseId?.toString?.().trim?.();
    if (researchResponseId) {
      payload.researchResponseId = researchResponseId;
    }

    if (result.status) {
      payload.researchStatus = result.status;
    }

    return payload;
  }

  private buildBaseUpsertPayload(job: ActiveWritingDeskJobResource): UpsertActiveWritingDeskJobDto {
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
      letterStatus: job.letterStatus ?? 'idle',
      letterReferences: Array.isArray(job.letterReferences) ? [...job.letterReferences] : [],
    };

    const existingResearchContent = this.normaliseResearchContent(job.researchContent ?? null);
    if (existingResearchContent !== null) {
      payload.researchContent = existingResearchContent;
    }

    const existingResearchResponseId = job.researchResponseId?.toString?.().trim?.();
    if (existingResearchResponseId) {
      payload.researchResponseId = existingResearchResponseId;
    }

    const existingTone = job.letterTone?.toString?.().trim?.();
    if (existingTone) {
      payload.letterTone = existingTone as any;
    }

    const existingLetterResponseId = job.letterResponseId?.toString?.().trim?.();
    if (existingLetterResponseId) {
      payload.letterResponseId = existingLetterResponseId;
    }

    const existingLetterContent = this.normaliseResearchContent(job.letterContent ?? null);
    if (existingLetterContent !== null) {
      payload.letterContent = existingLetterContent;
    }

    const existingLetterJson = this.normaliseResearchContent(job.letterJson ?? null);
    if (existingLetterJson !== null) {
      payload.letterJson = existingLetterJson;
    }

    return payload;
  }

  private normaliseResearchContent(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalised = value.replace(/\r\n/g, '\n');
    return normalised.trim().length > 0 ? normalised : null;
  }

  private normaliseLetterTone(value: string | null | undefined): WritingDeskLetterTone | null {
    if (typeof value !== 'string') return null;
    const normalised = value.trim().toLowerCase().replace(/\s+/g, '_');
    const matched = (WRITING_DESK_LETTER_TONES as readonly string[]).find((tone) => tone === normalised);
    return (matched as WritingDeskLetterTone | undefined) ?? null;
  }

  private normaliseLetterVerbosity(raw: string | undefined | null): 'low' | 'medium' | 'high' {
    const value = raw?.trim?.().toLowerCase?.();
    if (value === 'low' || value === 'high') return value;
    return 'medium';
  }

  private normaliseLetterReasoningEffort(
    model: string,
    raw: string | undefined | null,
  ): 'low' | 'medium' | 'high' {
    const supported = this.getSupportedReasoningEfforts(model);
    const requested = raw?.trim?.().toLowerCase?.();
    if (requested && (supported as readonly string[]).includes(requested)) {
      return requested as 'low' | 'medium' | 'high';
    }
    if (supported.includes('medium')) return 'medium';
    return supported[0];
  }

  private async resolveLetterContext(userId: string): Promise<LetterContext> {
    const [userRecord, addressRecord, mpRecord] = await Promise.all([
      this.users.findById(userId).catch(() => null),
      this.userAddress
        .getMine(userId)
        .catch(() => ({ address: null })),
      this.userMp.getMine(userId).catch(() => null),
    ]);

    const senderNameRaw = (userRecord as any)?.name;
    const senderName = typeof senderNameRaw === 'string' && senderNameRaw.trim().length > 0 ? senderNameRaw.trim() : '';

    const senderAddress = (addressRecord as any)?.address ?? {};
    const senderAddress1 = typeof senderAddress?.line1 === 'string' ? senderAddress.line1 : '';
    const senderAddress2 = typeof senderAddress?.line2 === 'string' ? senderAddress.line2 : '';
    const senderCity = typeof senderAddress?.city === 'string' ? senderAddress.city : '';
    const senderCounty = typeof senderAddress?.county === 'string' ? senderAddress.county : '';
    const senderPostcode = typeof senderAddress?.postcode === 'string' ? senderAddress.postcode : '';

    const mpName =
      typeof (mpRecord as any)?.mp?.name === 'string' && (mpRecord as any).mp.name.trim().length > 0
        ? (mpRecord as any).mp.name.trim()
        : '';
    const constituency =
      typeof (mpRecord as any)?.constituency === 'string' && (mpRecord as any).constituency.trim().length > 0
        ? (mpRecord as any).constituency.trim()
        : '';

    const parsedMpAddress = this.parseParliamentaryAddress((mpRecord as any)?.mp?.parliamentaryAddress);

    const today = new Date().toISOString().slice(0, 10);

    return {
      mpName,
      mpAddress1: parsedMpAddress.line1,
      mpAddress2: parsedMpAddress.line2,
      mpCity: parsedMpAddress.city,
      mpCounty: parsedMpAddress.county,
      mpPostcode: parsedMpAddress.postcode,
      constituency,
      senderName,
      senderAddress1,
      senderAddress2,
      senderAddress3: '',
      senderCity,
      senderCounty,
      senderPostcode,
      today,
    };
  }

  private buildLetterPrompt(params: {
    job: ActiveWritingDeskJobResource;
    tone: WritingDeskLetterTone;
    context: LetterContext;
    research: string;
  }): string {
    const { job, tone, context, research } = params;
    const toneDetail = LETTER_TONE_DETAILS[tone];
    const intake = job.form?.issueDescription ?? '';
    const followUps = Array.isArray(job.followUpQuestions)
      ? job.followUpQuestions
          .map((question, index) => {
            const answer = job.followUpAnswers?.[index] ?? '';
            if (!question && !answer) return null;
            return `Question: ${question}\nAnswer: ${answer}`;
          })
          .filter((entry): entry is string => !!entry)
      : [];

    const followUpSection =
      followUps.length > 0 ? followUps.join('\n\n') : 'No follow-up questions were required.';

    const researchSection = research || 'No deep research findings were available.';

    const sections = [
      `Selected tone: ${toneDetail.label}. ${toneDetail.prompt}`,
      `Today's date: ${context.today}`,
      `MP profile:\n- Name: ${context.mpName || 'Unknown'}\n- Constituency: ${context.constituency || 'Unknown'}\n- Parliamentary address line 1: ${context.mpAddress1 || ''}\n- Parliamentary address line 2: ${context.mpAddress2 || ''}\n- Parliamentary city: ${context.mpCity || ''}\n- Parliamentary county: ${context.mpCounty || ''}\n- Parliamentary postcode: ${context.mpPostcode || ''}`,
      `Sender profile:\n- Name: ${context.senderName || ''}\n- Address line 1: ${context.senderAddress1 || ''}\n- Address line 2: ${context.senderAddress2 || ''}\n- Address line 3: ${context.senderAddress3 || ''}\n- City: ${context.senderCity || ''}\n- County: ${context.senderCounty || ''}\n- Postcode: ${context.senderPostcode || ''}`,
      `User intake description:\n${intake}`,
      `Follow-up details:\n${followUpSection}`,
      `Deep research findings:\n${researchSection}`,
    ];

    return sections.join('\n\n');
  }

  private buildLetterSystemPrompt(): string {
    return LETTER_SYSTEM_PROMPT;
  }

  private buildStubLetter(params: {
    job: ActiveWritingDeskJobResource;
    tone: WritingDeskLetterTone;
    context: LetterContext;
    research: string;
  }): WritingDeskLetterResult {
    const { job, tone, context, research } = params;
    const intake = (job.form?.issueDescription ?? '').trim();
    const intakeSummary =
      intake.length > 0
        ? intake
        : 'I am raising an urgent local issue that requires your attention on behalf of my household.';

    const qaPairs = Array.isArray(job.followUpQuestions)
      ? job.followUpQuestions
          .map((question, index) => {
            const answer = job.followUpAnswers?.[index] ?? '';
            if (!(question && question.trim()) && !(answer && answer.trim())) {
              return null;
            }
            return {
              question: (question ?? '').trim(),
              answer: (answer ?? '').trim(),
            };
          })
          .filter((value): value is { question: string; answer: string } => !!value)
          .slice(0, 3)
      : [];

    const normalisedResearch = research
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const bulletCandidates = normalisedResearch
      .filter((line) => /^[-*•]/.test(line))
      .map((line) => line.replace(/^[-*•]\s*/, ''));

    const processedResearchLines = (bulletCandidates.length > 0 ? bulletCandidates : normalisedResearch)
      .map((line) => line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)'))
      .map((line) => line.replace(/[*#>`]/g, ''))
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, bulletCandidates.length > 0 ? 3 : 2);

    const escapeHtml = (value: string): string =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const toParagraph = (value: string): string =>
      `<p>${escapeHtml(value).replace(/\n+/g, '<br />')}</p>`;

    const followUpHtml =
      qaPairs.length > 0
        ? `<p><strong>Additional detail previously provided:</strong></p><ul>${qaPairs
            .map(({ question, answer }) => {
              const escapedQuestion = escapeHtml(question);
              if (answer.length === 0) {
                return `<li><strong>${escapedQuestion}</strong></li>`;
              }
              const answerHtml = escapeHtml(` ${answer}`).replace(/\n+/g, '<br />');
              return `<li><strong>${escapedQuestion}</strong>${answerHtml}</li>`;
            })
            .join('')}</ul>`
        : '';

    let researchHtml = '';
    if (processedResearchLines.length > 0) {
      if (processedResearchLines.length === 1) {
        researchHtml = toParagraph(`Supporting evidence: ${processedResearchLines[0]}`);
      } else {
        researchHtml = `<p><strong>Supporting evidence:</strong></p><ul>${processedResearchLines
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join('')}</ul>`;
      }
    }

    const requestPrefix = LETTER_TONE_REQUEST_PREFIX[tone] ?? LETTER_TONE_REQUEST_PREFIX.neutral;
    const request = `${requestPrefix} raise this issue with the relevant authorities, outline the steps you can take, and keep me informed of any progress.`;
    const signOff = LETTER_TONE_SIGN_OFFS[tone] ?? LETTER_TONE_SIGN_OFFS.neutral;
    const senderName = context.senderName || 'A concerned constituent';

    const letterSections: string[] = [
      toParagraph(
        `I am writing as a constituent in ${context.constituency || 'our constituency'} to share the following situation: ${intakeSummary}`,
      ),
    ];

    if (followUpHtml) {
      letterSections.push(followUpHtml);
    }

    if (researchHtml) {
      letterSections.push(researchHtml);
    }

    letterSections.push(toParagraph(request));
    letterSections.push(`<p>${escapeHtml(signOff)}<br />${escapeHtml(senderName)}</p>`);

    return {
      mp_name: context.mpName || 'Your MP',
      mp_address_1: context.mpAddress1 || '',
      mp_address_2: context.mpAddress2 || '',
      mp_city: context.mpCity || '',
      mp_county: context.mpCounty || '',
      mp_postcode: context.mpPostcode || '',
      date: context.today,
      letter_content: letterSections.join(''),
      sender_name: context.senderName || '',
      sender_address_1: context.senderAddress1 || '',
      sender_address_2: context.senderAddress2 || '',
      sender_address_3: context.senderAddress3 || '',
      sender_city: context.senderCity || '',
      sender_county: context.senderCounty || '',
      sender_postcode: context.senderPostcode || '',
      references: [],
    };
  }

  private buildLetterDocumentHtml(input: LetterDocumentInput): string {
    const sections: string[] = [];
    const mpLines = this.buildAddressLines({
      name: input.mpName,
      line1: input.mpAddress1,
      line2: input.mpAddress2,
      line3: null,
      city: input.mpCity,
      county: input.mpCounty,
      postcode: input.mpPostcode,
    });
    if (mpLines.length > 0) {
      sections.push(`<p>${mpLines.map((line) => this.escapeLetterHtml(line)).join('<br />')}</p>`);
    }

    const formattedDate = this.formatLetterDisplayDate(input.date);
    if (formattedDate) {
      sections.push(`<p>${this.escapeLetterHtml(formattedDate)}</p>`);
    }

    if (input.letterContentHtml) {
      sections.push(input.letterContentHtml);
    }

    const senderLines = this.buildAddressLines({
      name: input.senderName,
      line1: input.senderAddress1,
      line2: input.senderAddress2,
      line3: input.senderAddress3,
      city: input.senderCity,
      county: input.senderCounty,
      postcode: input.senderPostcode,
    });

    const hasAddressDetail = senderLines.slice(1).some((line) => line.trim().length > 0);
    if (hasAddressDetail && this.shouldAppendSenderAddress(input.letterContentHtml ?? '', senderLines)) {
      sections.push(`<p>${senderLines.map((line) => this.escapeLetterHtml(line)).join('<br />')}</p>`);
    }

    const references = Array.isArray(input.references)
      ? input.references.filter((ref) => typeof ref === 'string' && ref.trim().length > 0)
      : [];
    if (references.length > 0) {
      sections.push('<p><strong>References</strong></p>');
      sections.push(
        `<ul>${references
          .map((ref) => {
            const trimmed = ref.trim();
            if (!trimmed) return '';
            const escaped = this.escapeLetterHtml(trimmed);
            return `<li><a href="${escaped}" target="_blank" rel="noreferrer noopener">${escaped}</a></li>`;
          })
          .filter((entry) => entry.length > 0)
          .join('')}</ul>`,
      );
    }

    return sections.join('');
  }

  private buildAddressLines(input: {
    name?: string | null;
    line1?: string | null;
    line2?: string | null;
    line3?: string | null;
    city?: string | null;
    county?: string | null;
    postcode?: string | null;
  }): string[] {
    const lines: string[] = [];
    const push = (value?: string | null) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        lines.push(trimmed);
      }
    };

    push(input.name);
    push(input.line1);
    push(input.line2);
    push(input.line3);

    const city = typeof input.city === 'string' ? input.city.trim() : '';
    const county = typeof input.county === 'string' ? input.county.trim() : '';
    const postcode = typeof input.postcode === 'string' ? input.postcode.trim() : '';
    const locality = [city, county].filter((part) => part.length > 0).join(', ');

    if (locality && postcode) {
      lines.push(`${locality} ${postcode}`.trim());
    } else if (locality) {
      lines.push(locality);
    } else if (postcode) {
      lines.push(postcode);
    }

    return lines;
  }

  private escapeLetterHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatLetterDisplayDate(value: string | null | undefined): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const isoMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    if (!isoMatch) {
      return trimmed;
    }
    const [year, month, day] = trimmed.split('-');
    if (!year || !month || !day) return trimmed;
    return `${day}/${month}/${year}`;
  }

  private shouldAppendSenderAddress(letterHtml: string, senderLines: string[]): boolean {
    if (senderLines.length === 0) return false;
    const addressDetail = senderLines.slice(1).filter((line) => line.trim().length > 0);
    if (addressDetail.length === 0) return false;
    const text = this.normaliseLetterPlainText(letterHtml);
    if (!text) return true;
    const lower = text.toLowerCase();
    const name = senderLines[0]?.trim()?.toLowerCase();
    const hasName = name ? lower.includes(name) : false;
    const hasAddress = addressDetail.some((line) => lower.includes(line.trim().toLowerCase()));
    return !(hasName && hasAddress);
  }

  private normaliseLetterPlainText(value: string | null | undefined): string {
    if (typeof value !== 'string') return '';
    return value
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(p|div|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toLetterCompletePayload(
    result: WritingDeskLetterResult,
    extras: { responseId: string | null; tone: WritingDeskLetterTone; rawJson: string },
  ): LetterCompletePayload {
    return {
      mpName: result.mp_name ?? '',
      mpAddress1: result.mp_address_1 ?? '',
      mpAddress2: result.mp_address_2 ?? '',
      mpCity: result.mp_city ?? '',
      mpCounty: result.mp_county ?? '',
      mpPostcode: result.mp_postcode ?? '',
      date: result.date ?? '',
      letterContent: result.letter_content ?? '',
      senderName: result.sender_name ?? '',
      senderAddress1: result.sender_address_1 ?? '',
      senderAddress2: result.sender_address_2 ?? '',
      senderAddress3: result.sender_address_3 ?? '',
      senderCity: result.sender_city ?? '',
      senderCounty: result.sender_county ?? '',
      senderPostcode: result.sender_postcode ?? '',
      references: Array.isArray(result.references) ? result.references : [],
      responseId: extras.responseId ?? null,
      tone: extras.tone,
      rawJson: extras.rawJson,
    };
  }

  private parseLetterResult(text: string): WritingDeskLetterResult {
    try {
      const parsed = JSON.parse(text) as WritingDeskLetterResult;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Letter response was not an object');
      }
      return {
        mp_name: parsed.mp_name ?? '',
        mp_address_1: parsed.mp_address_1 ?? '',
        mp_address_2: parsed.mp_address_2 ?? '',
        mp_city: parsed.mp_city ?? '',
        mp_county: parsed.mp_county ?? '',
        mp_postcode: parsed.mp_postcode ?? '',
        date: parsed.date ?? '',
        letter_content: parsed.letter_content ?? '',
        sender_name: parsed.sender_name ?? '',
        sender_address_1: parsed.sender_address_1 ?? '',
        sender_address_2: parsed.sender_address_2 ?? '',
        sender_address_3: parsed.sender_address_3 ?? '',
        sender_city: parsed.sender_city ?? '',
        sender_county: parsed.sender_county ?? '',
        sender_postcode: parsed.sender_postcode ?? '',
        references: Array.isArray(parsed.references) ? parsed.references : [],
      };
    } catch (error) {
      throw new Error(`Failed to parse letter JSON: ${(error as Error)?.message ?? error}`);
    }
  }

  private extractOutputTextDelta(event: Record<string, unknown>): string | null {
    const delta = (event as any)?.delta ?? (event as any)?.text ?? null;
    return typeof delta === 'string' ? delta : null;
  }

  private extractLetterPreview(buffer: string): string | null {
    const marker = '"letter_content":"';
    const index = buffer.lastIndexOf(marker);
    if (index === -1) return null;
    const start = index + marker.length;
    let result = '';
    let i = start;
    while (i < buffer.length) {
      const char = buffer[i];
      if (char === '"') {
        const escaped = i > start && buffer[i - 1] === '\\';
        if (!escaped) {
          break;
        }
      }

      if (char === '\\') {
        const next = buffer[i + 1];
        if (next === 'n') {
          result += '\n';
          i += 2;
          continue;
        }
        if (next === 'r') {
          result += '\n';
          i += 2;
          continue;
        }
        if (next === 't') {
          result += '\t';
          i += 2;
          continue;
        }
        if (next === 'b' || next === 'f') {
          i += 2;
          continue;
        }
        if (next === '\\' || next === '"') {
          result += next;
          i += 2;
          continue;
        }
        if (next === '/') {
          result += '/';
          i += 2;
          continue;
        }
        if (next === 'u' && i + 5 < buffer.length) {
          const code = buffer.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(code)) {
            result += String.fromCharCode(parseInt(code, 16));
            i += 6;
            continue;
          }
        }
        i += 2;
        continue;
      }

      result += char;
      i += 1;
    }

    return result;
  }

  private async persistLetterState(
    userId: string,
    fallback: ActiveWritingDeskJobResource,
    update: {
      status?: WritingDeskLetterStatus;
      tone?: WritingDeskLetterTone | null;
      responseId?: string | null;
      content?: string | null;
      references?: string[] | null;
      json?: string | null;
    },
  ) {
    const latest = await this.writingDeskJobs.getActiveJobForUser(userId);
    const job = latest ?? fallback;
    const payload = this.buildLetterUpsertPayload(job, update);
    await this.writingDeskJobs.upsertActiveJob(userId, payload);
  }

  private async persistLetterResult(
    userId: string,
    fallback: ActiveWritingDeskJobResource,
    update: {
      status: WritingDeskLetterStatus;
      tone?: WritingDeskLetterTone | null;
      responseId?: string | null;
      content?: string | null;
      references?: string[] | null;
      json?: string | null;
    },
  ) {
    await this.persistLetterState(userId, fallback, update);
  }

  private buildLetterUpsertPayload(
    job: ActiveWritingDeskJobResource,
    update: {
      status?: WritingDeskLetterStatus;
      tone?: WritingDeskLetterTone | null;
      responseId?: string | null;
      content?: string | null;
      references?: string[] | null;
      json?: string | null;
    },
  ): UpsertActiveWritingDeskJobDto {
    const payload = this.buildBaseUpsertPayload(job);

    if (update.status) {
      payload.letterStatus = update.status;
    }

    if (update.tone !== undefined) {
      payload.letterTone = update.tone ?? undefined;
    }

    if (update.responseId !== undefined) {
      payload.letterResponseId = update.responseId ?? undefined;
    }

    if (update.content !== undefined) {
      const normalised = this.normaliseResearchContent(update.content);
      payload.letterContent = normalised ?? undefined;
    }

    if (update.references !== undefined) {
      payload.letterReferences = Array.isArray(update.references)
        ? update.references
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0)
        : [];
    }

    if (update.json !== undefined) {
      const normalisedJson = this.normaliseResearchContent(update.json);
      payload.letterJson = normalisedJson ?? undefined;
    }

    return payload;
  }

  private parseParliamentaryAddress(value: string | null | undefined) {
    if (typeof value !== 'string') {
      return { line1: '', line2: '', city: '', county: '', postcode: '' };
    }

    const segments = value
      .split(/[\n,]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    const postcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
    let postcode = '';
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const candidate = segments[i];
      if (postcodeRegex.test(candidate)) {
        postcode = this.normaliseUkPostcode(candidate);
        segments.splice(i, 1);
        break;
      }
    }

    const line1 = segments.shift() ?? '';
    const line2 = segments.shift() ?? '';
    const city = segments.shift() ?? '';
    const county = segments.shift() ?? '';

    return { line1, line2, city, county, postcode };
  }

  private normaliseUkPostcode(input: string): string {
    const tight = (input || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(tight)) return input?.trim?.() ?? '';
    return `${tight.slice(0, -3)} ${tight.slice(-3)}`;
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
