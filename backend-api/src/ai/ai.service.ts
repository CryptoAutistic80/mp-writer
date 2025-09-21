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

const DEFAULT_MODEL = 'o4-mini-deep-research';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 420000; // 7 minutes to allow multi-step research
const JOB_CLEANUP_MS = 10 * 60 * 1000;
const FAILED_JOB_CLEANUP_MS = 5 * 60 * 1000;

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

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
    const model = /deep-research/i.test(configuredModel) ? configuredModel : DEFAULT_MODEL;
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

    const systemInstructions = `You are MP Writer, an assistant that drafts fact-checked constituency letters with citations for UK residents.\nFollow these rules:\n- Produce a concise, well-structured letter ready to send.\n- Ground every substantive claim in reputable evidence. Use numbered citations referencing trustworthy UK sources where possible.\n- Prefer recent government, parliamentary, or leading NGO sources.\n- Suggest specific, actionable steps for the MP to take on behalf of the constituent.\n- Close with an appreciative sign-off.\n- Keep the entire response under 500 words.\n- Return the output as markdown paragraphs with numbered references like [1], [2], etc.\n- After the signature, list the references with their source name and URL.`;

    const userPrompt = `${audienceLine}\n${senderLine}\n${toneInstruction}\n\nIssue summary from the constituent:\n${input.prompt.trim()}\n\n${supportingDetailBlock}\n\nUsing the guidance above, draft the full letter and include the reference list.`;

    if (!apiKey) {
      const preview = `${systemInstructions}\n\n${userPrompt}`;
      return `DEV-STUB LETTER\n\n${preview.slice(0, 400)}...`;
    }

    const pollIntervalInput = this.config.get<string>('OPENAI_DEEP_RESEARCH_POLL_INTERVAL_MS');
    const timeoutInput = this.config.get<string>('OPENAI_DEEP_RESEARCH_TIMEOUT_MS');

    const pollIntervalCandidate = Number(pollIntervalInput ?? DEFAULT_POLL_INTERVAL_MS);
    const timeoutCandidate = Number(timeoutInput ?? DEFAULT_TIMEOUT_MS);

    const pollIntervalMs = Number.isFinite(pollIntervalCandidate) && pollIntervalCandidate > 0
      ? pollIntervalCandidate
      : DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? timeoutCandidate
      : DEFAULT_TIMEOUT_MS;

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey, timeout: timeoutMs + 60000 });

    const responseParams: ResponseCreateParamsNonStreaming = {
      model,
      input: userPrompt,
      instructions: systemInstructions,
      store: false,
      background: true,
      tool_choice: 'auto',
      tools: [
        {
          type: 'web_search_preview',
          search_context_size: 'medium',
        },
      ],
      reasoning: {
        summary: 'auto',
      },
    };

    if (!/deep-research/i.test(model)) {
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
      if (Date.now() - start > timeoutMs) {
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
          ['web_search_call', 'file_search_call', 'mcp_call'].includes(item?.type),
        )
      : false;

    if (!hadResearchCalls) {
      this.logger.warn(
        `Deep research response ${responseId} completed without explicit tool call records. Check model access or tooling configuration if citations are missing.`,
      );
    }

    return outputText.trim();
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
