import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseStatus,
} from 'openai/resources/responses/responses';
import {
  ComposeLetterDto,
  DeepResearchDto,
  GenerateFollowupsDto,
  ResearchPromptDto,
} from './dto/generate.dto';
import {
  composeLetterRequestSchema,
  composeLetterResponseSchema,
  deepResearchResponseSchema,
  generateFollowupsResponseSchema,
  researchPromptResponseSchema,
  type ComposeLetterRequest,
  type GenerateFollowupsResponse,
  type ResearchPromptResponse,
} from '@mp-writer/api-types';
import { z } from 'zod';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { UserMpService } from '../user-mp/user-mp.service';
import { UserAddressService } from '../user-address-store/user-address.service';

type ReasoningEffort = 'low' | 'medium' | 'high';

const DEFAULT_RESEARCH_MODEL = 'o4-mini-deep-research';
const DEFAULT_FOLLOWUP_MODEL = 'gpt-5-mini';
const DEFAULT_COMPOSE_MODEL = 'gpt-5';
const DEFAULT_COMPOSE_REASONING: ReasoningEffort = 'medium';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 900000;
const JOB_CLEANUP_MS = 10 * 60 * 1000;
const FAILED_JOB_CLEANUP_MS = 5 * 60 * 1000;

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

type ResponseTool = NonNullable<
  ResponseCreateParamsNonStreaming['tools']
>[number];
type WebSearchContextSize = 'small' | 'medium' | 'large';

type ResearchJobRecord = {
  id: string;
  userId: string;
  status: JobStatus;
  message: string;
  createdAt: number;
  updatedAt: number;
  researchSummary?: string | null;
  error?: string | null;
  credits?: number;
  lastResponseId?: string;
  tone?: string;
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly jobs = new Map<string, ResearchJobRecord>();

  constructor(
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
    private readonly userMp: UserMpService,
    private readonly userAddress: UserAddressService
  ) {}

  async generateFollowupQuestions(
    userId: string,
    body: GenerateFollowupsDto
  ): Promise<GenerateFollowupsResponse> {
    this.logger.debug(`Generating follow-up questions for user ${userId}`);
    const prompt = this.buildFollowupPrompt(
      body.issueSummary,
      body.baseAnswers
    );
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      return {
        questions: this.buildFallbackFollowupQuestions(body.baseAnswers),
      };
    }

    const responseText = await this.invokeModel({
      model: this.resolveFollowupModel(),
      instructions: this.followupSystemPrompt(),
      input: prompt,
      apiKey,
    });
    const parsed = this.parseResponse(
      generateFollowupsResponseSchema,
      responseText,
      'follow-up questions'
    );
    if (!parsed.questions?.length) {
      this.logger.warn(
        'Model returned no follow-up questions; using fallback prompts.'
      );
      return {
        questions: this.buildFallbackFollowupQuestions(body.baseAnswers),
      };
    }
    return parsed;
  }

  async generateResearchPrompt(
    userId: string,
    body: ResearchPromptDto
  ): Promise<ResearchPromptResponse> {
    this.logger.debug(`Generating research prompt for user ${userId}`);
    const prompt = this.buildResearchPrompt(body);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      return { prompt: `${prompt}\n\n(Stub research prompt)` };
    }

    const responseText = await this.invokeModel({
      model: this.resolveResearchPromptModel(),
      instructions: this.researchPromptSystemPrompt(),
      input: prompt,
      apiKey,
    });
    const parsed = this.parseResponse(
      researchPromptResponseSchema,
      responseText,
      'research prompt'
    );
    return parsed;
  }

  async enqueueDeepResearch(userId: string, body: DeepResearchDto) {
    const jobId = randomUUID();
    const { mpName, constituency, resolvedAddress, resolvedName } =
      await this.resolveUserContext(userId, body);

    const creditResult = await this.userCredits.deductFromMine(userId, 1);

    const job: ResearchJobRecord = {
      id: jobId,
      userId,
      status: 'in_progress',
      message: 'Starting deep research…',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      credits: creditResult.credits,
      tone: body.tone,
    };

    this.jobs.set(jobId, job);

    void this.performDeepResearch(job, {
      issueSummary: body.issueSummary,
      researchPrompt: body.researchPrompt,
      tone: body.tone,
      mpName,
      constituency,
      userName: resolvedName,
      userAddress: resolvedAddress,
    }).catch((error) => {
      this.logger.error(
        `Deep research job ${job.id} execution failed`,
        error.stack || error.message
      );
    });

    return deepResearchResponseSchema.parse({
      jobId,
      status: job.status,
      message: job.message,
      credits: job.credits,
    });
  }

  async composeLetter(userId: string, body: ComposeLetterDto) {
    const job = this.jobs.get(body.jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Deep research job not found');
    }

    if (job.status !== 'completed' || !job.researchSummary) {
      throw new NotFoundException(
        'Research summary not ready; complete deep research first'
      );
    }

    const payload = composeLetterRequestSchema.parse({
      jobId: body.jobId,
      issueSummary: body.issueSummary,
      baseAnswers: body.baseAnswers,
      followupAnswers: body.followupAnswers ?? [],
      tone: job.tone ?? body.tone,
      researchSummary: job.researchSummary,
      userName: body.userName,
      userAddressHtml: body.userAddressHtml,
      mpName: body.mpName,
      constituency: body.constituency,
    });

    const instructions = this.composeSystemPrompt();
    const input = this.composeUserPrompt(payload);
    const model = this.resolveComposeModel();
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      return composeLetterResponseSchema.parse({
        letter: {
          metadata: {
            generatedAtIso: new Date().toISOString(),
            tone: payload.tone,
            model: 'dev-stub',
            promptHash: undefined,
            jobId: payload.jobId,
          },
          recipient: {
            name: payload.mpName ?? 'Member of Parliament',
            constituency: payload.constituency ?? 'Unknown Constituency',
            role: 'MP',
            addressHtml: '',
          },
          sender: {
            name: payload.userName ?? 'Constituent',
            addressHtml: payload.userAddressHtml ?? '',
          },
          salutationHtml: '<p>Dear MP,</p>',
          body: {
            paragraphs: [
              {
                html: `<p>This is a development stub letter summarising: ${payload.issueSummary}</p>`,
              },
              {
                html: `<p>Research summary:</p><p>${payload.researchSummary.slice(
                  0,
                  400
                )}...</p>`,
              },
            ],
            actions: [
              { label: 'Review constituent concerns', description: undefined },
            ],
          },
          closingHtml: '<p>Yours sincerely,<br/>Constituent</p>',
          references: [],
        },
      }).letter;
    }

    const client = await this.createOpenAiClient(
      apiKey,
      DEFAULT_TIMEOUT_MS + 60000
    );
    const responseText = await this.invokeModel({
      client,
      model,
      instructions,
      input,
      apiKey,
      reasoning: this.resolveComposeReasoningEffort(),
    });

    return this.parseResponse(
      composeLetterResponseSchema.pick({ letter: true }),
      responseText,
      'letter composition'
    ).letter;
  }

  async getJob(jobId: string, userId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Deep research request not found');
    }

    return {
      jobId: job.id,
      status: job.status,
      message: job.message,
      credits: job.credits,
      updatedAt: job.updatedAt,
      content:
        job.status === 'completed'
          ? job.researchSummary ?? undefined
          : undefined,
      error:
        job.status === 'failed'
          ? job.error ?? 'Deep research failed.'
          : undefined,
    };
  }

  private async resolveUserContext(userId: string, body: DeepResearchDto) {
    const [mpDoc, addressDoc] = await Promise.all([
      this.userMp.getMine(userId).catch(() => null),
      this.userAddress.getMine(userId).catch(() => null),
    ]);

    const mpName =
      body.mpName ||
      mpDoc?.mp?.name ||
      mpDoc?.mp?.fullName ||
      mpDoc?.mp?.displayName ||
      '';
    const constituency = body.constituency || mpDoc?.constituency || '';
    const address = addressDoc?.address;
    const resolvedAddress =
      body.userAddressHtml ||
      (address
        ? [
            address.line1,
            address.line2,
            address.city,
            address.county,
            address.postcode,
          ]
            .map((part: string | undefined) => (part || '').trim())
            .filter(Boolean)
            .join(', ')
        : '');
    const resolvedName = body.userName || mpDoc?.userName || '';

    return { mpName, constituency, resolvedAddress, resolvedName };
  }

  private async performDeepResearch(
    job: ResearchJobRecord,
    input: {
      issueSummary: string;
      researchPrompt: string;
      tone?: string;
      mpName?: string;
      constituency?: string;
      userName?: string;
      userAddress?: string;
    }
  ) {
    try {
      const apiKey = this.config.get<string>('OPENAI_API_KEY');
      const configuredModel =
        this.config.get<string>('OPENAI_MODEL') || DEFAULT_RESEARCH_MODEL;
      const model = this.isDeepResearchModel(configuredModel)
        ? configuredModel
        : DEFAULT_RESEARCH_MODEL;

      if (!apiKey) {
        const summary = `DEV-STUB RESEARCH\n\n${input.researchPrompt.slice(
          0,
          400
        )}...`;
        this.updateJob(job, {
          status: 'completed',
          message: 'Deep research completed (stub).',
          researchSummary: summary,
        });
        this.scheduleCleanup(job.id, JOB_CLEANUP_MS);
        return;
      }

      this.updateJob(job, { message: 'Submitting deep research request…' });

      const client = await this.createOpenAiClient(
        apiKey,
        DEFAULT_TIMEOUT_MS + 60000
      );
      const tooling = this.buildToolingConfiguration(true);

      const responseParams: ResponseCreateParamsNonStreaming = {
        model,
        input: input.researchPrompt,
        instructions: this.deepResearchSystemPrompt(input),
        store: false,
        background: true,
        tool_choice: 'auto',
      };

      if (tooling.tools.length > 0) {
        responseParams.tools = tooling.tools;
      }

      const initial = await client.responses.create(responseParams);
      job.lastResponseId = initial.id;
      this.updateJob(job, {
        message: 'Deep research initiated. Gathering sources…',
      });

      const finalPayload = await this.pollForCompletion(
        client,
        initial.id,
        job
      );
      const summary = this.extractOutput(finalPayload).trim();

      if (!summary) {
        throw new Error('Deep research finished without returning a summary.');
      }

      this.updateJob(job, {
        status: 'completed',
        message: 'Deep research completed. Summary ready.',
        researchSummary: summary,
      });
      this.scheduleCleanup(job.id, JOB_CLEANUP_MS);
    } catch (error: any) {
      const message = error?.message || 'Deep research failed unexpectedly.';
      this.logger.error(`Deep research job ${job.id} failed`, message);
      const refund = await this.userCredits
        .addToMine(job.userId, 1)
        .catch((refundError) => {
          this.logger.error(
            `Failed to refund credits for job ${job.id}`,
            refundError?.message ?? refundError
          );
          return null;
        });
      this.updateJob(job, {
        status: 'failed',
        message,
        error: message,
        credits: refund?.credits ?? job.credits,
      });
      this.scheduleCleanup(job.id, FAILED_JOB_CLEANUP_MS);
    }
  }

  private buildToolingConfiguration(usingDeepResearchModel: boolean): {
    tools: ResponseTool[];
    maxToolCalls?: number;
  } {
    const tools: ResponseTool[] = [];
    if (usingDeepResearchModel) {
      tools.push({
        type: 'web_search_preview',
        search_context_size: this.getWebSearchContextSize(),
      } as ResponseTool);
    }
    return { tools };
  }

  private getWebSearchContextSize(): WebSearchContextSize {
    return this.parseWebSearchContextSize(
      this.config.get<string>('OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE')
    );
  }

  private parseWebSearchContextSize(
    value: string | undefined | null
  ): WebSearchContextSize {
    if (!value) {
      return 'medium';
    }

    const candidate = value.trim().toLowerCase();
    if (candidate === 'small' || candidate === 'large') {
      return candidate;
    }

    return 'medium';
  }

  private scheduleCleanup(jobId: string, delay: number) {
    setTimeout(() => {
      const job = this.jobs.get(jobId);
      if (!job) return;
      if (job.status === 'in_progress') return;
      this.jobs.delete(jobId);
    }, delay).unref?.();
  }

  private updateJob(job: ResearchJobRecord, patch: Partial<ResearchJobRecord>) {
    if (!this.jobs.has(job.id)) return;
    Object.assign(job, patch);
    job.updatedAt = Date.now();
  }

  private async pollForCompletion(
    client: any,
    responseId: string,
    job: ResearchJobRecord
  ) {
    const pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    const terminalStatuses: ResponseStatus[] = [
      'completed',
      'failed',
      'cancelled',
      'incomplete',
    ];
    const start = Date.now();
    const timeoutMs = DEFAULT_TIMEOUT_MS;

    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    let latest = await client.responses.retrieve(responseId);
    while (
      !terminalStatuses.includes((latest as any).status as ResponseStatus)
    ) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          'Deep research timed out before completion. Please try again.'
        );
      }
      await sleep(pollIntervalMs);
      latest = await client.responses.retrieve(responseId);
      this.updateJob(job, {
        message: `Deep research in progress (status: ${latest.status}).`,
      });
    }

    const finalStatus = (latest as any).status as ResponseStatus;
    if (finalStatus !== 'completed') {
      const failureReason =
        (latest as any).error?.message ||
        (latest as any).incomplete_details?.reason ||
        `status: ${finalStatus}`;
      throw new Error(`Deep research request failed (${failureReason}).`);
    }

    return latest;
  }

  private async performLetterComposition(
    body: ComposeLetterDto,
    researchSummary: string,
    tone: string | undefined
  ) {
    const payload = composeLetterRequestSchema.parse({
      jobId: body.jobId,
      issueSummary: body.issueSummary,
      baseAnswers: body.baseAnswers,
      followupAnswers: body.followupAnswers ?? [],
      tone: tone ?? body.tone,
      researchSummary,
      userName: body.userName,
      userAddressHtml: body.userAddressHtml,
      mpName: body.mpName,
      constituency: body.constituency,
    });

    const instructions = this.composeSystemPrompt();
    const input = this.composeUserPrompt(payload);
    const model = this.resolveComposeModel();
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      return composeLetterResponseSchema.parse({
        letter: {
          metadata: {
            generatedAtIso: new Date().toISOString(),
            tone: payload.tone,
            model: 'dev-stub',
            promptHash: undefined,
            jobId: payload.jobId,
          },
          recipient: {
            name: payload.mpName ?? 'Member of Parliament',
            constituency: payload.constituency ?? 'Unknown Constituency',
            role: 'MP',
            addressHtml: '',
          },
          sender: {
            name: payload.userName ?? 'Constituent',
            addressHtml: payload.userAddressHtml ?? '',
          },
          salutationHtml: '<p>Dear MP,</p>',
          body: {
            paragraphs: [
              {
                html: `<p>This is a development stub letter summarising: ${payload.issueSummary}</p>`,
              },
              {
                html: `<p>Research summary:</p><p>${payload.researchSummary.slice(
                  0,
                  400
                )}...</p>`,
              },
            ],
            actions: [
              { label: 'Review constituent concerns', description: undefined },
            ],
          },
          closingHtml: '<p>Yours sincerely,<br/>Constituent</p>',
          references: [],
        },
      }).letter;
    }

    const client = await this.createOpenAiClient(
      apiKey,
      DEFAULT_TIMEOUT_MS + 60000
    );
    const responseText = await this.invokeModel({
      client,
      model,
      instructions,
      input,
      apiKey,
    });

    return this.parseResponse(
      composeLetterResponseSchema.pick({ letter: true }),
      responseText,
      'letter composition'
    ).letter;
  }

  private resolveFollowupModel() {
    return (
      this.config.get<string>('OPENAI_FOLLOWUP_MODEL') || DEFAULT_FOLLOWUP_MODEL
    );
  }

  private resolveResearchPromptModel() {
    return (
      this.config.get<string>('OPENAI_RESEARCH_PROMPT_MODEL') || DEFAULT_FOLLOWUP_MODEL
    );
  }

  private resolveComposeModel() {
    return (
      this.config.get<string>('OPENAI_COMPOSE_MODEL') || DEFAULT_COMPOSE_MODEL
    );
  }

  private resolveComposeReasoningEffort(): ReasoningEffort {
    return (
      (this.config.get<string>('OPENAI_COMPOSE_REASONING') as ReasoningEffort) ||
      DEFAULT_COMPOSE_REASONING
    );
  }

  private composeSystemPrompt() {
    return `You are MP Writer, transforming structured research into validated letters. Follow the provided schema exactly, outputting JSON only with no code fences.`;
  }

  private composeUserPrompt(payload: ComposeLetterRequest) {
    return [
      `Issue summary: ${payload.issueSummary}`,
      `Tone: ${payload.tone ?? 'respectful and persuasive'}`,
      `Research summary:\n${payload.researchSummary}`,
      `Base answers: ${JSON.stringify(payload.baseAnswers)}`,
      `Follow-up answers: ${JSON.stringify(payload.followupAnswers)}`,
      `MP: ${payload.mpName ?? 'Unknown'}`,
      `Constituency: ${payload.constituency ?? 'Unknown'}`,
      `Sender name: ${payload.userName ?? 'Unknown'}`,
      `Sender address HTML: ${payload.userAddressHtml ?? ''}`,
      `Return only JSON matching the provided schema.`,
    ].join('\n\n');
  }

  private buildFollowupPrompt(
    issueSummary: string,
    baseAnswers: GenerateFollowupsDto['baseAnswers']
  ) {
    const answers = baseAnswers
      .map((item) => `- ${item.prompt}: ${item.answer}`)
      .join('\n');
    return `Issue summary:\n${issueSummary}\n\nAnswers:\n${answers}\n\nSuggest up to 5 follow-up questions as JSON.`;
  }

  private buildResearchPrompt(body: ResearchPromptDto) {
    const followups = (body.followupAnswers ?? [])
      .map((item) => `- ${item.questionId}: ${item.answer}`)
      .join('\n');
    const answers = body.baseAnswers
      .map((item) => `- ${item.prompt}: ${item.answer}`)
      .join('\n');

    return [
      `Issue summary:\n${body.issueSummary}`,
      `Tone: ${body.tone ?? 'respectful and persuasive'}`,
      `Initial answers:\n${answers}`,
      `Follow-up answers:\n${followups || 'None'}`,
      `Produce a research plan JSON with objectives, key sources, and evidence requirements.`,
    ].join('\n\n');
  }

  private followupSystemPrompt() {
    return `You are MP Writer. Generate up to 5 clarifying follow-up questions in JSON format {"questions":[{"id":"...","prompt":"..."}, ...]}.`;
  }

  private researchPromptSystemPrompt() {
    return `You are MP Writer. Based on the issue summary, answers, and follow-ups, draft a concise research brief for a deep research model. Respond as {"prompt":"..."}.`;
  }

  private deepResearchSystemPrompt(input: {
    researchPrompt: string;
    tone?: string;
    mpName?: string;
    constituency?: string;
    userName?: string;
    userAddress?: string;
  }) {
    const audienceLine = input.mpName
      ? `Audience: ${input.mpName}${
          input.constituency
            ? `, Member of Parliament for ${input.constituency}`
            : ''
        }.`
      : `Audience: the letter is addressed to the constituent's Member of Parliament.`;

    const senderLineParts: string[] = [];
    if (input.userName) senderLineParts.push(`Name: ${input.userName}`);
    if (input.userAddress)
      senderLineParts.push(`Address: ${input.userAddress}`);
    const senderLine = senderLineParts.length
      ? `Sender context:\n${senderLineParts
          .map((line) => `- ${line}`)
          .join('\n')}`
      : 'Sender context: Leave space for the constituent to add their name and address if missing.';

    const toneInstruction = input.tone
      ? `Requested tone: ${input.tone.toLowerCase()}`
      : 'Requested tone: respectful and persuasive, suitable for contacting an MP.';

    return [
      `You are MP Writer, an assistant performing deep research before letter writing.`,
      audienceLine,
      senderLine,
      toneInstruction,
      `Follow the provided research plan and gather factual evidence. Return a concise research summary with key findings, citations, and actions.`,
    ].join('\n');
  }

  private async createOpenAiClient(apiKey: string, timeout: number) {
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey, timeout });
  }

  private async invokeModel(options: {
    client?: any;
    model: string;
    instructions: string;
    input: string;
    apiKey: string;
    reasoning?: ReasoningEffort;
  }) {
    const client =
      options.client ??
      (await this.createOpenAiClient(
        options.apiKey,
        DEFAULT_TIMEOUT_MS + 60000
      ));
    const basePayload = {
      model: options.model,
      instructions: options.instructions,
      input: options.input,
    } as Record<string, unknown>;

    const optionalParamKeys: string[] = [];

    if (this.supportsMaxTokens(options.model)) {
      basePayload.max_tokens = 2000;
      optionalParamKeys.push('max_tokens');
    }

    if (options.reasoning) {
      basePayload.reasoning = { effort: options.reasoning };
    }

    const response = await this.createResponseWithFallback(
      client,
      basePayload,
      optionalParamKeys
    );

    return this.extractOutput(response);
  }

  private async createResponseWithFallback(
    client: any,
    payload: Record<string, unknown>,
    optionalParamKeys: string[]
  ) {
    try {
      return await client.responses.create(payload);
    } catch (error: any) {
      if (optionalParamKeys.length > 0 && this.isUnsupportedOptionalParamError(error)) {
        this.logger.warn(
          `Model ${payload.model} rejected optional parameters; retrying without ${optionalParamKeys.join(', ')}.`
        );
        const retryPayload = { ...payload };
        for (const key of optionalParamKeys) {
          delete retryPayload[key];
        }
        return client.responses.create(retryPayload);
      }
      throw error;
    }
  }

  private supportsMaxTokens(model: string): boolean {
    const normalised = model.toLowerCase();
    if (normalised.includes('o4-mini-deep-research')) {
      return false;
    }
    if (normalised.includes('gpt-5-mini')) {
      return false;
    }
    if (normalised === 'gpt-5') {
      return false;
    }
    return true;
  }

  private isUnsupportedOptionalParamError(error: any): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const badRequest = (error as any)?.error;
    if ((error as any)?.status !== 400 || badRequest?.type !== 'invalid_request_error') {
      return false;
    }
    if (badRequest?.param === 'max_tokens') {
      return true;
    }
    return false;
  }

  private buildFallbackFollowupQuestions(
    baseAnswers: GenerateFollowupsDto['baseAnswers']
  ): GenerateFollowupsResponse['questions'] {
    return baseAnswers.slice(0, 3).map((item, index) => ({
      id: `stub-${index + 1}`,
      prompt: `Could you expand on “${item.prompt}”?`,
    }));
  }

  private parseResponse<T extends z.ZodTypeAny>(
    schema: T,
    text: string,
    context: string
  ): z.infer<T> {
    const trimmed = text.trim();
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    const candidate =
      jsonStart >= 0 && jsonEnd >= jsonStart
        ? trimmed.slice(jsonStart, jsonEnd + 1)
        : trimmed;

    const attemptParse = (payload: string) => {
      const parsed = JSON.parse(payload);
      return schema.parse(parsed);
    };

    return this.parseWithRepairs(candidate, context, attemptParse);
  }

  private parseWithRepairs<T>(
    payload: string,
    context: string,
    parser: (input: string) => T
  ): T {
    const repairs = [
      (input: string) => input,
      this.repairEscapedCharacters,
      this.repairTrailingCommas,
    ];

    for (const repair of repairs) {
      const candidate = repair.call(this, payload);
      try {
        return parser(candidate);
      } catch (error) {
        this.logger.warn(
          `Failed to parse ${context} response after ${repair.name || 'initial'} repair attempt`,
          error instanceof Error ? error.message : error
        );
      }
    }

    this.logger.error(
      `Failed to parse ${context} response after applying repairs`,
      payload
    );
    throw new SyntaxError(`Unable to parse ${context} response`);
  }

  private repairEscapedCharacters(input: string): string {
    return input.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
  }

  private repairTrailingCommas(input: string): string {
    return input.replace(/,\s*([}\]])/g, '$1');
  }

  private isDeepResearchModel(model: string): boolean {
    return /deep-research/i.test(model);
  }

  private extractOutput(payload: any): string {
    if (
      typeof payload?.output_text === 'string' &&
      payload.output_text.trim()
    ) {
      return payload.output_text;
    }

    if (!Array.isArray(payload?.output)) {
      return '';
    }

    const messageText = payload.output
      .filter((item: any) => item?.type === 'message')
      .flatMap((item: any) =>
        Array.isArray(item?.content)
          ? item.content
              .filter((content: any) => content?.type === 'output_text')
              .map((content: any) => content?.text || '')
          : []
      )
      .join('');

    return typeof messageText === 'string' ? messageText : '';
  }
}
