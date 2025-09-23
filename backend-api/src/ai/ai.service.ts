import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseStatus,
} from 'openai/resources/responses/responses';
import {
  generateFollowupsResponseSchema,
  structuredLetterJsonSchema,
  structuredLetterSchema,
  type GenerateFollowupsResponse,
  type StructuredLetter,
} from '@mp-writer/api-types';
import { FollowUpDetailDto } from './dto/generate.dto';
import { FollowUpContextDto } from './dto/followups.dto';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { UserMpService } from '../user-mp/user-mp.service';
import { UserAddressService } from '../user-address-store/user-address.service';

const DEFAULT_MODEL = 'o4-mini-deep-research';
const DEFAULT_POLL_INTERVAL_MS = 5000;
// Default time budget for a deep research run. Some investigations can take
// longer, so we also support a single automatic extension (see loop below).
const DEFAULT_TIMEOUT_MS = 900000; // 15 minutes
const JOB_CLEANUP_MS = 10 * 60 * 1000;
const FAILED_JOB_CLEANUP_MS = 5 * 60 * 1000;
const DEFAULT_FOLLOWUP_MODEL = 'gpt-5.1-mini';
const DEFAULT_TRANSFORM_MODEL = 'gpt-5.1';

const FOLLOWUP_RESPONSE_SCHEMA = {
  name: 'follow_up_questions',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['followUps'],
    properties: {
      followUps: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'question'],
          properties: {
            id: { type: 'string', minLength: 1 },
            question: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
} as const;

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

type ResponseTool = NonNullable<ResponseCreateParamsNonStreaming['tools']>[number];
type WebSearchContextSize = 'small' | 'medium' | 'large';

interface JobRecord {
  id: string;
  userId: string;
  status: JobStatus;
  message: string;
  createdAt: number;
  updatedAt: number;
  content?: string | null;
  error?: string | null;
  credits?: number;
  lastResponseId?: string;
}

interface GenerateJobRequest {
  userId: string;
  prompt: string;
  model?: string;
  tone?: string;
  details?: FollowUpDetailDto[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
}

type GeneratePayload = {
  prompt: string;
  model?: string;
  tone?: string;
  details?: FollowUpDetailDto[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
};

interface GenerateJobResponse {
  jobId: string;
  status: JobStatus;
  message: string;
  credits: number;
}

interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  message: string;
  credits: number | undefined;
  updatedAt: number;
  content?: string;
  error?: string;
}

interface GenerateFollowupsRequestInternal {
  userId: string;
  issueSummary: string;
  contextAnswers: FollowUpContextDto[];
  mpName?: string;
  constituency?: string;
}

interface TransformLetterRequestInternal {
  userId: string;
  letterContent: string;
  mpName: string;
  constituency?: string;
  senderName: string;
  senderAddressLines: string[];
  tone?: string;
  date?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly jobs = new Map<string, JobRecord>();

  constructor(
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
    private readonly userMp: UserMpService,
    private readonly userAddress: UserAddressService,
  ) {}

  async generateFollowups(request: GenerateFollowupsRequestInternal): Promise<GenerateFollowupsResponse> {
    const issueSummary = (request.issueSummary || '').trim();
    if (!issueSummary) {
      return { followUps: [] };
    }

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY missing; follow-up generation disabled.');
      return { followUps: [] };
    }

    const contextBlock = (request.contextAnswers || [])
      .filter((item) => item && item.prompt && item.answer)
      .map((item, index) => {
        const prompt = item.prompt.trim();
        const answer = item.answer.trim();
        return `Q${index + 1}: ${prompt}\nAnswer: ${answer}`;
      })
      .join('\n\n');

    const mpDescriptor = request.mpName
      ? `${request.mpName}${request.constituency ? `, MP for ${request.constituency}` : ''}`
      : 'the constituent\'s MP';

    const systemPrompt =
      'You are MP Writer, an assistant that drafts clarifying follow-up questions before writing a constituency letter. ' +
      'Review the provided issue summary and background answers. Suggest up to four targeted follow-up questions that will ' +
      'help gather essential missing information. If no follow-up is required, return an empty list. Questions must be ' +
      'concise, avoid duplication, and stay within the constituent\'s scope. Respond only with JSON.';

    const userPrompt = [
      `Issue summary:\n${issueSummary}`,
      contextBlock ? `Background answers:\n${contextBlock}` : 'Background answers: None provided.',
      `Recipient: ${mpDescriptor}.`,
      'Return an object shaped as { "followUps": [{ "id": "unique-id", "question": "text" }] } with at most four items.',
      'Use short, lowercase ids separated by hyphens (e.g. "evidence-needed").',
    ].join('\n\n');

    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, timeout: 30000 });
      const configuredModel = this.config.get<string>('OPENAI_FOLLOWUP_MODEL')?.trim();
      const model = configuredModel && configuredModel.length > 0 ? configuredModel : DEFAULT_FOLLOWUP_MODEL;

      const response = await client.responses.create({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_schema', json_schema: FOLLOWUP_RESPONSE_SCHEMA },
        max_output_tokens: 800,
        temperature: 0.4,
      } as any);

      const raw = this.extractOutput(response);
      if (!raw.trim()) {
        return { followUps: [] };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        this.logger.error(`Follow-up response parse failed for user ${request.userId}`, error);
        throw new Error('Unable to generate follow-up questions. Please try again.');
      }

      const validation = generateFollowupsResponseSchema.safeParse(parsed);
      if (!validation.success) {
        this.logger.error(
          `Follow-up response validation failed for user ${request.userId}`,
          JSON.stringify(validation.error.format()),
        );
        throw new Error('Unable to generate follow-up questions. Please try again.');
      }

      return { followUps: this.normaliseFollowUps(validation.data.followUps) };
    } catch (error: any) {
      const message = error?.message || 'Unable to generate follow-up questions. Please try again.';
      this.logger.error(`Follow-up generation failed for user ${request.userId}`, message);
      throw new Error('Unable to generate follow-up questions. Please try again.');
    }
  }

  async transformLetterToJson(request: TransformLetterRequestInternal): Promise<{ letter: StructuredLetter }> {
    const letterContent = (request.letterContent || '').trim();
    if (!letterContent) {
      throw new Error('Letter content is required for transformation.');
    }

    const senderAddressLines = this.normaliseAddressLines(request.senderAddressLines);
    const targetDate = (request.date || '').trim() || new Date().toISOString().slice(0, 10);
    const tone = (request.tone || '').trim();

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      const fallbackBody = letterContent
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);

      const fallback = structuredLetterSchema.parse({
        recipient: {
          name: request.mpName,
          constituency: request.constituency || undefined,
          addressLines: [],
        },
        sender: {
          name: request.senderName,
          addressLines: senderAddressLines.length ? senderAddressLines : ['[Add constituent address]'],
        },
        date: targetDate,
        tone: tone || undefined,
        salutation: `Dear ${request.mpName},`,
        body: fallbackBody.length ? fallbackBody : ['Letter content unavailable in development mode.'],
        actions: [],
        conclusion: 'Thank you for your time and attention to this matter.',
        closing: {
          signOff: 'Yours sincerely',
          signature: request.senderName,
        },
        references: [],
      });
      return { letter: fallback };
    }

    const systemPrompt = [
      'You are MP Writer, an assistant that converts fact-checked constituency letters into structured JSON.',
      'Read the plain-text letter, identify each logical section, and populate the schema provided.',
      'Remove inline citation markers such as [1] from the body text but keep the supporting sentences intact.',
      'Capture at most three references using the information in the References section, preserving the original URLs.',
      'Return strictly valid JSON without code fences or commentary.',
    ].join(' ');

    const addressBlock = senderAddressLines.length
      ? senderAddressLines.map((line) => `- ${line}`).join('\n')
      : '- Address not supplied; leave placeholder in JSON.';

    const userPrompt = [
      `Plain-text letter:\n${letterContent}`,
      `Recipient: ${request.mpName}${request.constituency ? ` (${request.constituency})` : ''}`,
      `Sender name: ${request.senderName}`,
      `Sender address lines:\n${addressBlock}`,
      `Preferred tone: ${tone || 'not specified'}`,
      `Use this letter date: ${targetDate}`,
      'Review the letter, interpret any action or reference sections, and output JSON matching the schema exactly.',
    ].join('\n\n');

    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, timeout: 60000 });
      const configuredModel = this.config.get<string>('OPENAI_TRANSFORM_MODEL')?.trim();
      const model = configuredModel && configuredModel.length > 0 ? configuredModel : DEFAULT_TRANSFORM_MODEL;

      const response = await client.responses.create({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_schema', json_schema: structuredLetterJsonSchema },
        max_output_tokens: 1400,
        temperature: 0.1,
      } as any);

      const raw = this.extractOutput(response);
      if (!raw.trim()) {
        throw new Error('Letter transformation produced an empty response. Please retry.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        this.logger.error(`Structured letter parse failed for user ${request.userId}`, error);
        throw new Error('Unable to parse structured letter output. Please try again.');
      }

      const validation = structuredLetterSchema.safeParse(parsed);
      if (!validation.success) {
        this.logger.error(
          `Structured letter validation failed for user ${request.userId}`,
          JSON.stringify(validation.error.format()),
        );
        throw new Error('The structured letter did not match the expected schema. Please try again.');
      }

      const letter = validation.data;
      if (tone) {
        letter.tone = tone;
      }
      return { letter };
    } catch (error: any) {
      const message = error?.message || 'Letter transformation failed unexpectedly. Please try again.';
      this.logger.error(`Letter transformation failed for user ${request.userId}`, message);
      throw new Error(message.includes('Please try again') ? message : 'Letter transformation failed unexpectedly.');
    }
  }

  async enqueueGenerate(request: GenerateJobRequest): Promise<GenerateJobResponse> {
    const userId = request.userId;
    this.logger.log(`Received deep research request for user ${userId}`);
    const [mpDoc, addressDoc] = await Promise.all([
      this.userMp.getMine(userId).catch(() => null),
      this.userAddress.getMine(userId).catch(() => null),
    ]);

    const mpName =
      request.mpName ||
      mpDoc?.mp?.name ||
      mpDoc?.mp?.fullName ||
      mpDoc?.mp?.displayName ||
      '';

    const constituency = request.constituency || mpDoc?.constituency || '';
    const address = addressDoc?.address;
    const addressLine =
      request.userAddressLine ||
      (address
        ? [address.line1, address.line2, address.city, address.county, address.postcode]
            .map((part: string | undefined) => (part || '').trim())
            .filter((part: string) => Boolean(part))
            .join(', ')
        : '');

    let deduction;
    try {
      deduction = await this.userCredits.deductFromMine(userId, 1);
    } catch (error: any) {
      this.logger.error(`Failed to deduct credit for user ${userId}`, error?.message || error);
      throw error;
    }

    const jobId = randomUUID();
    const job: JobRecord = {
      id: jobId,
      userId,
      status: 'in_progress',
      message: 'Starting deep research…',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      credits: deduction.credits,
    };

    this.jobs.set(jobId, job);

    const generateInput: GeneratePayload = {
      prompt: request.prompt,
      model: request.model,
      tone: request.tone,
      details: request.details,
      mpName,
      constituency,
      userName: request.userName || '',
      userAddressLine: addressLine,
    };

    void this.executeJob(job, generateInput).catch((error) => {
      this.logger.error(`Deep research job ${job.id} execution failed`, error.stack || error.message);
    });

    const response = {
      jobId,
      status: job.status,
      message: job.message,
      credits: job.credits ?? deduction.credits,
    };
    this.logger.log(`Deep research job ${jobId} queued for user ${userId}`);
    return response;
  }

  async getJob(jobId: string, userId: string): Promise<JobStatusResponse> {
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
      content: job.status === 'completed' ? job.content ?? undefined : undefined,
      error: job.status === 'failed' ? job.error ?? 'Deep research failed.' : undefined,
    };
  }

  private async executeJob(job: JobRecord, input: GeneratePayload) {
    try {
      const content = await this.performDeepResearch(job, input);
      this.updateJob(job, {
        status: 'completed',
        message: 'Deep research completed. Draft ready.',
        content,
      });
      this.scheduleCleanup(job.id, JOB_CLEANUP_MS);
    } catch (error: any) {
      const message = error?.message || 'Deep research failed unexpectedly.';
      this.logger.error(`Deep research job ${job.id} failed`, message);
      const refund = await this.userCredits.addToMine(job.userId, 1).catch((refundError) => {
        this.logger.error(`Failed to refund credits for job ${job.id}`, refundError?.message ?? refundError);
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

  private scheduleCleanup(jobId: string, delay: number) {
    setTimeout(() => {
      const job = this.jobs.get(jobId);
      if (!job) return;
      if (job.status === 'in_progress') return;
      this.jobs.delete(jobId);
    }, delay).unref?.();
  }

  private updateJob(job: JobRecord, patch: Partial<JobRecord>) {
    if (!this.jobs.has(job.id)) return;
    Object.assign(job, patch);
    job.updatedAt = Date.now();
  }

  private async performDeepResearch(
    job: JobRecord,
    input: GeneratePayload,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const configuredModel = input.model || this.config.get<string>('OPENAI_MODEL') || '';
    const model = this.isDeepResearchModel(configuredModel) ? configuredModel : DEFAULT_MODEL;
    const usingDeepResearchModel = this.isDeepResearchModel(model);
    const tone = (input.tone || '').trim();
    const mpName = (input.mpName || '').trim();
    const constituency = (input.constituency || '').trim();
    const userName = (input.userName || '').trim();
    const userAddressLine = (input.userAddressLine || '').trim();

    const detailLines = (input.details || [])
      .filter((item) => item && item.question && item.answer)
      .map((item) => `- ${item.question.trim()}: ${item.answer.trim()}`)
      .join('\n');

    const audienceLine = mpName
      ? `Audience: ${mpName}${constituency ? `, Member of Parliament for ${constituency}` : ''}.`
      : `Audience: The letter is addressed to the constituent's Member of Parliament.`;

    const senderLineParts: string[] = [];
    if (userName) senderLineParts.push(`Name: ${userName}`);
    if (userAddressLine) senderLineParts.push(`Address: ${userAddressLine}`);
    const senderLine = senderLineParts.length
      ? `Sender context:\n${senderLineParts.map((line) => `- ${line}`).join('\n')}`
      : 'Sender context: Leave space for the constituent to add their name and address if missing.';

    const toneInstruction = tone
      ? `Requested tone: ${tone.toLowerCase()}`
      : 'Requested tone: respectful and persuasive, suitable for contacting an MP.';

    const supportingDetailBlock = detailLines
      ? `Additional background details provided by the user:\n${detailLines}`
      : 'No additional background details were provided beyond the issue summary.';

    const systemInstructions = `You are MP Writer, an assistant who performs multi-step deep research to draft fact-checked constituency letters for UK residents.\nOperating Principles:\n- Run thorough research before writing. Prioritise recent information (ideally within the last 3 years) from official UK government, Parliament, reputable NGOs, or mainstream journalism with transparent sourcing.\n- Never invent facts. If information cannot be found, state the limitation briefly rather than speculating.\n- When citing statistics or statements, capture the publication date or most recent datapoint in the reference list.\n- Provide inline citations using numbered markers like [1], [2] that map to a reference section.\n- References must include: title, source/organisation, year (if available), and a direct URL the constituent can share.\n- Keep the final letter under 500 words, written in clear UK English, respectful yet persuasive.\n- Include a short action list within the letter outlining concrete requests for the MP.\n- Return plain text only (no HTML, Markdown, or code fences).`;

    const researchExpectations = `Research objectives:\n1. Understand the constituent's issue and the outcomes they want.\n2. Identify relevant UK policies, legislation, votes, or programmes the MP can influence.\n3. Gather recent statistics, official statements, or expert findings that strengthen the case.\n4. Surface any timelines, upcoming debates, or consultations the MP should note.`;

    const outputExpectations = `Output requirements:\n- Compose the complete letter within 500 words.\n- Keep the tone ${tone ? tone.toLowerCase() : 'respectful and persuasive'}.\n- Weave evidence-backed arguments that align with the constituent's goals.\n- Present an "Actions:" section with bullet points introduced using "-" before the closing paragraph.\n- End with a "References:" section listing each source on its own line using the format "1. Title — Source (Year). URL".\n- Do not include HTML tags or inline hyperlinks; keep everything as plain text.`;

    const userPrompt = `${audienceLine}\n${senderLine}\n${toneInstruction}\n\n${researchExpectations}\n\nIssue summary from the constituent:\n${input.prompt.trim()}\n\n${supportingDetailBlock}\n\n${outputExpectations}\n\nUsing the guidance above, research thoroughly and draft the full letter with inline citations and the required reference list.`;

    if (!apiKey) {
      const preview = `${systemInstructions}\n\n${userPrompt}`;
      return `DEV-STUB LETTER\n\n${preview.slice(0, 400)}...`;
    }

    const pollIntervalInput = this.config.get<string>('OPENAI_DEEP_RESEARCH_POLL_INTERVAL_MS');
    const timeoutInput = this.config.get<string>('OPENAI_DEEP_RESEARCH_TIMEOUT_MS');
    const timeoutExtensionInput = this.config.get<string>(
      'OPENAI_DEEP_RESEARCH_TIMEOUT_EXTENSION_MS',
    );

    const pollIntervalCandidate = Number(pollIntervalInput ?? DEFAULT_POLL_INTERVAL_MS);
    const timeoutCandidate = Number(timeoutInput ?? DEFAULT_TIMEOUT_MS);

    const pollIntervalMs = Number.isFinite(pollIntervalCandidate) && pollIntervalCandidate > 0
      ? pollIntervalCandidate
      : DEFAULT_POLL_INTERVAL_MS;
    let timeBudgetMs = Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? timeoutCandidate
      : DEFAULT_TIMEOUT_MS;
    const extensionCandidate = Number(timeoutExtensionInput ?? 300000);
    const extensionMs =
      Number.isFinite(extensionCandidate) && extensionCandidate > 0 ? extensionCandidate : 300000; // +5 min default
    let extendedOnce = false;

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey, timeout: timeBudgetMs + 60000 });

    const tooling = this.buildToolingConfiguration(usingDeepResearchModel);

    const responseParams: ResponseCreateParamsNonStreaming = {
      model,
      input: userPrompt,
      instructions: systemInstructions,
      store: false,
      background: usingDeepResearchModel,
      tool_choice: 'auto',
      reasoning: {
        summary: 'auto',
      },
    };

    if (tooling.tools.length > 0) {
      responseParams.tools = tooling.tools;
    }

    if (typeof tooling.maxToolCalls === 'number') {
      (responseParams as ResponseCreateParamsNonStreaming & { max_tool_calls?: number }).max_tool_calls =
        tooling.maxToolCalls;
    }

    if (!usingDeepResearchModel) {
      responseParams.max_output_tokens = 3000;
      responseParams.temperature = 0.6;
    }

    this.updateJob(job, {
      message: 'Submitting deep research request…',
    });

    const initial = await client.responses.create(responseParams);
    job.lastResponseId = initial.id;
    this.updateJob(job, {
      message: 'Deep research initiated. Gathering sources…',
    });

    const responseId = initial.id;
    let latest = initial;
    const start = Date.now();
    const terminalStatuses: ResponseStatus[] = ['completed', 'failed', 'cancelled', 'incomplete'];

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    while (!terminalStatuses.includes((latest as any).status as ResponseStatus)) {
      if (Date.now() - start > timeBudgetMs) {
        if (!extendedOnce) {
          extendedOnce = true;
          timeBudgetMs += extensionMs;
          this.updateJob(job, {
            message: 'Still researching… taking longer than usual. Extending time limit.',
          });
          continue;
        }
        throw new Error('Deep research timed out before completion. Please try again.');
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

    const outputText = this.extractOutput(latest);
    if (!outputText.trim()) {
      throw new Error('Deep research finished without returning a draft.');
    }

    const hadResearchCalls = Array.isArray((latest as any).output)
      ? (latest as any).output.some((item: any) =>
          ['web_search_call', 'file_search_call', 'mcp_tool_call'].includes(item?.type),
        )
      : false;

    if (!hadResearchCalls) {
      this.logger.warn(
        `Deep research response ${responseId} completed without explicit tool call records. Check model access or tooling configuration if citations are missing.`,
      );
    }

    return outputText.trim();
  }

  private normaliseFollowUps(
    followUps: GenerateFollowupsResponse['followUps'],
  ): GenerateFollowupsResponse['followUps'] {
    const result: GenerateFollowupsResponse['followUps'] = [];
    const seen = new Set<string>();

    followUps.forEach((item) => {
      if (!item || result.length >= 4) {
        return;
      }
      const question = (item.question || '').trim();
      if (!question) {
        return;
      }

      const preferred = this.slugify((item.id || '').trim()) || this.slugify(question).slice(0, 60);
      const base = preferred || `follow-up-${result.length + 1}`;
      let candidate = base;
      let counter = 1;
      while (seen.has(candidate) && counter < 10) {
        candidate = `${base}-${counter}`;
        counter += 1;
      }
      seen.add(candidate);
      result.push({ id: candidate, question });
    });

    return result;
  }

  private normaliseAddressLines(lines: string[]): string[] {
    return (lines || [])
      .map((line) => (line || '').trim())
      .filter((line) => Boolean(line))
      .slice(0, 5);
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private buildToolingConfiguration(usingDeepResearchModel: boolean): {
    tools: ResponseTool[];
    maxToolCalls?: number;
  } {
    const tools: ResponseTool[] = [];

    const maxToolCallsCandidate = Number(
      this.config.get<string>('OPENAI_DEEP_RESEARCH_MAX_TOOL_CALLS') ?? '',
    );
    const maxToolCalls =
      Number.isFinite(maxToolCallsCandidate) && maxToolCallsCandidate > 0
        ? maxToolCallsCandidate
        : undefined;

    const contextSize = this.parseWebSearchContextSize(
      this.config.get<string>('OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE'),
    );

    if (usingDeepResearchModel) {
      const includeWebSearch = this.parseBooleanFlag(
        this.config.get<string>('OPENAI_DEEP_RESEARCH_ENABLE_WEB_SEARCH'),
        true,
      );
      const vectorStoreIds = this.parseVectorStoreIds(
        this.config.get<string>('OPENAI_DEEP_RESEARCH_VECTOR_STORE_IDS'),
      );
      const enableCodeInterpreter = this.parseBooleanFlag(
        this.config.get<string>('OPENAI_DEEP_RESEARCH_ENABLE_CODE_INTERPRETER'),
        false,
      );

      if (includeWebSearch) {
        tools.push({
          type: 'web_search_preview',
          search_context_size: contextSize,
        } as ResponseTool);
      }

      if (vectorStoreIds.length > 0) {
        tools.push({
          type: 'file_search',
          vector_store_ids: vectorStoreIds,
        } as ResponseTool);
      }

      if (enableCodeInterpreter) {
        tools.push({
          type: 'code_interpreter',
          container: { type: 'auto' },
        } as ResponseTool);
      }

      if (!tools.some((tool) => this.isDataSourceTool(tool))) {
        tools.push({
          type: 'web_search_preview',
          search_context_size: contextSize,
        } as ResponseTool);
      }
    }

    return { tools, maxToolCalls };
  }

  private parseBooleanFlag(value: string | undefined | null, defaultValue: boolean): boolean {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    const normalised = value.trim().toLowerCase();
    if (!normalised) {
      return defaultValue;
    }

    if (['true', '1', 'yes', 'y', 'on', 'enabled'].includes(normalised)) {
      return true;
    }

    if (['false', '0', 'no', 'n', 'off', 'disabled'].includes(normalised)) {
      return false;
    }

    return defaultValue;
  }

  private parseVectorStoreIds(value: string | undefined | null): string[] {
    if (!value) {
      return [];
    }

    const ids = value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => Boolean(id));

    if (ids.length <= 2) {
      return ids;
    }

    this.logger.warn(
      `Received ${ids.length} vector store IDs but deep research currently supports at most 2. Using the first two IDs.`,
    );

    return ids.slice(0, 2);
  }

  private parseWebSearchContextSize(value: string | undefined | null): WebSearchContextSize {
    if (!value) {
      return 'medium';
    }

    const candidate = value.trim().toLowerCase();
    if (candidate === 'small' || candidate === 'large') {
      return candidate;
    }

    return 'medium';
  }

  private isDataSourceTool(tool: ResponseTool): boolean {
    return tool.type === 'web_search_preview' || tool.type === 'file_search' || tool.type === 'mcp';
  }

  private isDeepResearchModel(model: string): boolean {
    return /deep-research/i.test(model);
  }

  private extractOutput(payload: any): string {
    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
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
          : [],
      )
      .join('');

    return typeof messageText === 'string' ? messageText : '';
  }
}
