import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { WritingDeskJobsService } from '../writing-desk-jobs/writing-desk-jobs.service';

describe('AiService.startWritingDeskResearch', () => {
  const buildInput = () => ({
    jobId: '0e984725-c51c-4bf4-9960-e1c80e27aba0',
    issueDetail: 'Issue details',
    affectedDetail: 'Affected details',
    backgroundDetail: 'Background context',
    desiredOutcome: 'Desired outcome',
    followUpQuestions: ['What is the timeline?'],
    followUpAnswers: ['The decision is due next month.'],
    notes: 'Additional notes',
    responseId: 'resp_prev',
  });

  const setup = (contextSize?: string) => {
    const responsesCreate = jest
      .fn()
      .mockResolvedValue({ status: 'queued', id: 'resp_123', output: [] });

    const config: Partial<ConfigService> = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'OPENAI_API_KEY':
            return 'test-key';
          case 'OPENAI_DEEP_RESEARCH_MODEL':
            return 'o4-mini-deep-research';
          case 'OPENAI_DEEP_RESEARCH_VECTOR_STORE_IDS':
            return '';
          case 'OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE':
            return contextSize;
          default:
            return undefined;
        }
      }),
    };

    const credits: Partial<UserCreditsService> = {
      deductFromMine: jest.fn().mockResolvedValue({ credits: 4 }),
    };

    const jobs: Partial<WritingDeskJobsService> = {
      getActiveJobForUser: jest.fn().mockResolvedValue(null),
      upsertActiveJob: jest.fn().mockImplementation(async (_userId, payload) => ({
        ...payload,
        jobId: payload.jobId ?? 'job-generated',
        research: payload.research,
      })),
    };

    const service = new AiService(
      config as ConfigService,
      credits as UserCreditsService,
      jobs as WritingDeskJobsService,
    );
    (service as any).openaiClient = { responses: { create: responsesCreate } };

    return { service, responsesCreate };
  };

  it('includes the configured web search context size when valid', async () => {
    const { service, responsesCreate } = setup(' Medium ');

    await service.startWritingDeskResearch('user-123', buildInput());

    expect(responsesCreate).toHaveBeenCalledTimes(1);
    const request = responsesCreate.mock.calls[0][0];
    expect(request.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'web_search_preview',
          web_search_context_size: 'medium',
        }),
      ]),
    );
  });

  it('omits the web search context size when the value is invalid', async () => {
    const { service, responsesCreate } = setup('invalid');

    await service.startWritingDeskResearch('user-123', buildInput());

    expect(responsesCreate).toHaveBeenCalledTimes(1);
    const request = responsesCreate.mock.calls[0][0];
    const webSearchTool = request.tools.find((tool: any) => tool.type === 'web_search_preview');
    expect(webSearchTool).toEqual({ type: 'web_search_preview' });
  });
});
