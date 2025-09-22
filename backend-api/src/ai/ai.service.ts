import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseStatus,
} from 'openai/resources/responses/responses';
import { FollowUpDetailDto } from './dto/generate.dto';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { UserMpService } from '../user-mp/user-mp.service';
import { UserAddressService } from '../user-address-store/user-address.service';
import { AiJobRepository, AiJobLean } from './ai-job.repository';
import { AiJobCompletedRepository, AiJobCompletedLean } from './ai-job-completed.repository';
import { AiJob, AiJobDetail } from './schemas/ai-job.schema';

const DEFAULT_MODEL = 'o4-mini-deep-research';
const DEFAULT_POLL_INTERVAL_MS = 5000;
// Default time budget for a deep research run. Some investigations can take
// longer, so we also support a single automatic extension (see loop below).
const DEFAULT_TIMEOUT_MS = 900000; // 15 minutes

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

type ResponseTool = NonNullable<ResponseCreateParamsNonStreaming['tools']>[number];
type WebSearchContextSize = 'small' | 'medium' | 'large';

interface JobRecord {
  id: string;
  userId: string;
  status: JobStatus;
  message: string;
  createdAt: Date;
  updatedAt: Date;
  content: string | null;
  error: string | null;
  credits: number | null;
  lastResponseId: string | null;
  prompt: string;
  model?: string | null;
  tone?: string | null;
  details: FollowUpDetailDto[];
  mpName?: string | null;
  constituency?: string | null;
  userName?: string | null;
  userAddressLine?: string | null;
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

interface JobPayloadSnapshot {
  prompt: string;
  model?: string;
  tone?: string;
  details?: FollowUpDetailDto[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
}

interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  message: string;
  credits: number | undefined;
  updatedAt: number;
  content?: string;
  error?: string;
  payload?: JobPayloadSnapshot;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
    private readonly userMp: UserMpService,
    private readonly userAddress: UserAddressService,
    private readonly jobRepository: AiJobRepository,
    private readonly completedJobRepository: AiJobCompletedRepository,
  ) {}

  async enqueueGenerate(request: GenerateJobRequest): Promise<GenerateJobResponse> {
    const userId = request.userId;
    this.logger.log(`Received deep research request for user ${userId}`);

    const existing = await this.jobRepository.findByUser(userId);
    if (existing && (existing.status === 'queued' || existing.status === 'in_progress')) {
      const existingJob = this.toJobRecord(existing);
      this.logger.log(`User ${userId} already has an active deep research job ${existingJob.id}`);
      return {
        jobId: existingJob.id,
        status: existingJob.status,
        message: existingJob.message,
        credits: existingJob.credits ?? 0,
      };
    }

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

    const prompt = request.prompt.trim();
    const tone = (request.tone || '').trim() || undefined;
    const model = (request.model || '').trim() || undefined;
    const userName = (request.userName || '').trim();
    const constituencyName = constituency.trim();
    const mpNameValue = mpName.trim();
    const addressLineValue = addressLine.trim();
    const details: AiJobDetail[] = (request.details || [])
      .filter((item) => item && item.question && item.answer)
      .map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
      }));

    let deduction;
    try {
      deduction = await this.userCredits.deductFromMine(userId, 1);
    } catch (error: any) {
      this.logger.error(`Failed to deduct credit for user ${userId}`, error?.message || error);
      throw error;
    }

    const jobId = randomUUID();
    const generateInput: GeneratePayload = {
      prompt,
      model,
      tone,
      details,
      mpName: mpNameValue,
      constituency: constituencyName,
      userName,
      userAddressLine: addressLineValue,
    };

    const jobDoc = await this.jobRepository.createOrReplace(userId, jobId, {
      status: 'in_progress',
      message: 'Starting deep research…',
      credits: deduction.credits,
      prompt,
      model,
      tone,
      details,
      mpName: mpNameValue,
      constituency: constituencyName,
      userName,
      userAddressLine: addressLineValue,
    });

    const job = this.toJobRecord(jobDoc);

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

  async getActiveJob(userId: string): Promise<JobStatusResponse | null> {
    const active = await this.jobRepository.findByUser(userId);
    if (!active) {
      return null;
    }

    const job = this.toJobRecord(active);
    if (job.userId !== userId) {
      return null;
    }

    return this.buildStatusResponse(job);
  }

  async getJob(jobId: string, userId: string): Promise<JobStatusResponse> {
    const active = await this.jobRepository.findByJobId(jobId);
    if (active) {
      const job = this.toJobRecord(active);
      if (job.userId !== userId) {
        throw new NotFoundException('Deep research request not found');
      }
      return this.buildStatusResponse(job);
    }

    const completed = await this.completedJobRepository.findByJobId(jobId);
    if (completed) {
      const owner = this.extractId(completed.user);
      if (owner !== userId) {
        throw new NotFoundException('Deep research request not found');
      }
      return this.buildCompletedStatus(completed);
    }

    throw new NotFoundException('Deep research request not found');
  }

  private async executeJob(job: JobRecord, input: GeneratePayload) {
    try {
      const content = await this.performDeepResearch(job, input);
      await this.updateJob(job, {
        status: 'completed',
        message: 'Deep research completed. Draft ready.',
        content,
        error: null,
      });
      await this.persistCompletion(job, 'completed', {
        content,
        error: null,
        message: job.message,
        credits: job.credits,
      });
    } catch (error: any) {
      const message = error?.message || 'Deep research failed unexpectedly.';
      this.logger.error(`Deep research job ${job.id} failed`, message);
      const refund = await this.userCredits.addToMine(job.userId, 1).catch((refundError) => {
        this.logger.error(`Failed to refund credits for job ${job.id}`, refundError?.message ?? refundError);
        return null;
      });
      const credits = refund?.credits ?? job.credits ?? null;
      await this.updateJob(job, {
        status: 'failed',
        message,
        error: message,
        credits,
      });
      await this.persistCompletion(job, 'failed', {
        content: null,
        error: message,
        message,
        credits,
      });
    }
  }

  private async updateJob(job: JobRecord, patch: Partial<JobRecord>) {
    const update: Partial<AiJob> = {};
    if (patch.status) update.status = patch.status;
    if (patch.message !== undefined) update.message = patch.message;
    if (patch.content !== undefined) update.content = patch.content ?? null;
    if (patch.error !== undefined) update.error = patch.error ?? null;
    if (patch.credits !== undefined) update.credits = patch.credits ?? null;
    if (patch.lastResponseId !== undefined) update.lastResponseId = patch.lastResponseId ?? null;

    if (Object.keys(update).length === 0) {
      return;
    }

    const updated = await this.jobRepository.updateJob(job.id, update);
    if (!updated) {
      return;
    }

    if (patch.status) job.status = patch.status;
    if (patch.message !== undefined) job.message = patch.message;
    if (patch.content !== undefined) job.content = patch.content ?? null;
    if (patch.error !== undefined) job.error = patch.error ?? null;
    if (patch.credits !== undefined) job.credits = patch.credits ?? null;
    if (patch.lastResponseId !== undefined) job.lastResponseId = patch.lastResponseId ?? null;
    job.updatedAt = updated.updatedAt;
  }

  private async persistCompletion(
    job: JobRecord,
    status: 'completed' | 'failed',
    options: { content: string | null; error: string | null; message: string; credits: number | null },
  ) {
    try {
      await this.completedJobRepository.recordCompletion({
        jobId: job.id,
        userId: job.userId,
        status,
        message: options.message,
        credits: options.credits,
        prompt: job.prompt,
        model: job.model ?? null,
        tone: job.tone ?? null,
        details: job.details.map((detail) => ({ question: detail.question, answer: detail.answer })),
        mpName: job.mpName ?? null,
        constituency: job.constituency ?? null,
        userName: job.userName ?? null,
        userAddressLine: job.userAddressLine ?? null,
        content: options.content,
        error: options.error,
        completedAt: new Date(),
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to persist completion for job ${job.id}`,
        error?.stack || error?.message || error,
      );
    }
  }

  private buildStatusResponse(job: JobRecord): JobStatusResponse {
    const payload = this.buildPayloadSnapshot({
      prompt: job.prompt,
      model: job.model ?? undefined,
      tone: job.tone ?? undefined,
      details: job.details,
      mpName: job.mpName ?? undefined,
      constituency: job.constituency ?? undefined,
      userName: job.userName ?? undefined,
      userAddressLine: job.userAddressLine ?? undefined,
    });

    return {
      jobId: job.id,
      status: job.status,
      message: job.message,
      credits: typeof job.credits === 'number' ? job.credits : undefined,
      updatedAt: job.updatedAt.getTime(),
      content: job.status === 'completed' ? job.content ?? undefined : undefined,
      error: job.status === 'failed' ? job.error ?? 'Deep research failed.' : undefined,
      payload,
    };
  }

  private buildCompletedStatus(completed: AiJobCompletedLean): JobStatusResponse {
    const payload = this.buildPayloadSnapshot({
      prompt: completed.prompt ?? '',
      model: completed.model ?? undefined,
      tone: completed.tone ?? undefined,
      details: completed.details ?? [],
      mpName: completed.mpName ?? undefined,
      constituency: completed.constituency ?? undefined,
      userName: completed.userName ?? undefined,
      userAddressLine: completed.userAddressLine ?? undefined,
    });

    const updatedAt = (completed.completedAt || completed.updatedAt || completed.createdAt).getTime();

    return {
      jobId: completed.jobId,
      status: completed.status,
      message: completed.message,
      credits: typeof completed.credits === 'number' ? completed.credits : undefined,
      updatedAt,
      content: completed.status === 'completed' ? completed.content ?? undefined : undefined,
      error: completed.status === 'failed' ? completed.error ?? 'Deep research failed.' : undefined,
      payload,
    };
  }

  private buildPayloadSnapshot(source: {
    prompt: string;
    model?: string;
    tone?: string;
    details?: FollowUpDetailDto[];
    mpName?: string;
    constituency?: string;
    userName?: string;
    userAddressLine?: string;
  }): JobPayloadSnapshot {
    const details = (source.details || [])
      .filter((detail) => detail && detail.question && detail.answer)
      .map((detail) => ({ question: detail.question, answer: detail.answer }));

    const payload: JobPayloadSnapshot = {
      prompt: source.prompt || '',
    };

    if (source.model) payload.model = source.model;
    if (source.tone) payload.tone = source.tone;
    if (details.length > 0) payload.details = details;
    if (source.mpName) payload.mpName = source.mpName;
    if (source.constituency) payload.constituency = source.constituency;
    if (source.userName) payload.userName = source.userName;
    if (source.userAddressLine) payload.userAddressLine = source.userAddressLine;

    return payload;
  }

  private toJobRecord(doc: AiJobLean): JobRecord {
    const details: FollowUpDetailDto[] = (doc.details || []).map((detail) => ({
      question: detail.question,
      answer: detail.answer,
    }));

    return {
      id: doc.jobId,
      userId: this.extractId(doc.user),
      status: doc.status,
      message: doc.message,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      content: doc.content ?? null,
      error: doc.error ?? null,
      credits: doc.credits ?? null,
      lastResponseId: doc.lastResponseId ?? null,
      prompt: doc.prompt ?? '',
      model: doc.model ?? null,
      tone: doc.tone ?? null,
      details,
      mpName: doc.mpName ?? null,
      constituency: doc.constituency ?? null,
      userName: doc.userName ?? null,
      userAddressLine: doc.userAddressLine ?? null,
    };
  }

  private extractId(value: unknown): string {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && typeof (value as { toString?: () => string }).toString === 'function') {
      return (value as { toString: () => string }).toString();
    }
    return '';
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

    const systemInstructions = `You are MP Writer, an assistant who performs multi-step deep research to draft fact-checked constituency letters for UK residents.\nOperating Principles:\n- Run thorough research before writing. Prioritise recent information (ideally within the last 3 years) from official UK government, Parliament, reputable NGOs, or mainstream journalism with transparent sourcing.\n- Never invent facts. If information cannot be found, state the limitation briefly rather than speculating.\n- When citing statistics or statements, capture the publication date or most recent datapoint in the reference list.\n- Provide inline citations using numbered markers like [1], [2] that map to a reference section.\n- References must include: title, source/organisation, year (if available), and a direct URL the constituent can share.\n- Keep the final letter under 500 words, written in clear UK English, respectful yet persuasive.\n- Include a short bulleted action list inside the letter outlining concrete requests for the MP.\n- Output format MUST be HTML (no Markdown, no code fences).`;

    const researchExpectations = `Research objectives:\n1. Understand the constituent's issue and the outcomes they want.\n2. Identify relevant UK policies, legislation, votes, or programmes the MP can influence.\n3. Gather recent statistics, official statements, or expert findings that strengthen the case.\n4. Surface any timelines, upcoming debates, or consultations the MP should note.`;

    const outputExpectations = `Output requirements:\n- Compose the complete letter within 500 words.\n- Keep the tone ${tone ? tone.toLowerCase() : 'respectful and persuasive'}.\n- Weave evidence-backed arguments that align with the constituent's goals.\n- Present a bulleted list of specific actions for the MP.\n- Return valid HTML only, with semantic tags and no surrounding <html> or <body>.\n- Structure:\n  <div class="letter">\n    <p>Sender address</p>\n    <p>MP greeting</p>\n    <p>Letter body with inline citation numbers like [1]</p>\n    <ul>Bullet actions for the MP</ul>\n    <p>Closing and signature</p>\n    <h3>References</h3>\n    <ol>\n      <li><a href="URL" rel="noopener noreferrer">Title — Source (Year)</a></li>\n    </ol>\n  </div>`;

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

    await this.updateJob(job, {
      message: 'Submitting deep research request…',
    });

    const initial = await client.responses.create(responseParams);
    job.lastResponseId = initial.id;
    await this.updateJob(job, {
      message: 'Deep research initiated. Gathering sources…',
      lastResponseId: initial.id,
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
          await this.updateJob(job, {
            message: 'Still researching… taking longer than usual. Extending time limit.',
          });
          continue;
        }
        throw new Error('Deep research timed out before completion. Please try again.');
      }
      await sleep(pollIntervalMs);
      latest = await client.responses.retrieve(responseId);
      await this.updateJob(job, {
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
