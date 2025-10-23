import { AiService } from './ai.service';
import { WritingDeskJobsService } from '../writing-desk-jobs/writing-desk-jobs.service';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { ConfigService } from '@nestjs/config';
import { UserMpService } from '../user-mp/user-mp.service';
import { UsersService } from '../users/users.service';
import { UserAddressService } from '../user-address-store/user-address.service';
import { ActiveWritingDeskJobResource } from '../writing-desk-jobs/writing-desk-jobs.types';
import { AiRunStore } from './ai-run.store';

type CreateServiceOptions = {
  configGet: (key: string) => string | null | undefined;
  userCredits?: Partial<UserCreditsService>;
  writingDeskJobs?: Partial<WritingDeskJobsService>;
  userMp?: Partial<UserMpService>;
  users?: Partial<UsersService>;
  userAddress?: Partial<UserAddressService>;
  runStore?: Partial<AiRunStore>;
};

describe('AiService', () => {
  const createService = ({
    configGet,
    userCredits,
    writingDeskJobs,
    userMp,
    users,
    userAddress,
    runStore,
  }: CreateServiceOptions) => {
    const config = { get: jest.fn((key: string) => configGet(key)) } as unknown as ConfigService;
    const credits = {
      deductFromMine: jest.fn().mockResolvedValue({ credits: 10 }),
      addToMine: jest.fn().mockResolvedValue({}),
      ...userCredits,
    } as unknown as UserCreditsService;
    const jobs = {
      getActiveJobForUser: jest.fn(),
      upsertActiveJob: jest.fn(),
      ...writingDeskJobs,
    } as unknown as WritingDeskJobsService;
    const mp = { ...userMp } as unknown as UserMpService;
    const usersService = { ...users } as unknown as UsersService;
    const address = { ...userAddress } as unknown as UserAddressService;
    const store = {
      acquireRunLock: jest.fn().mockResolvedValue(null),
      clearRun: jest.fn().mockResolvedValue(undefined),
      setMetadata: jest.fn().mockResolvedValue(undefined),
      appendStreamEvent: jest.fn().mockResolvedValue('0-0'),
      refreshRunLock: jest.fn().mockResolvedValue(undefined),
      getMetadata: jest.fn().mockResolvedValue(null),
      getStreamEntries: jest.fn().mockResolvedValue([]),
      applyTtl: jest.fn().mockResolvedValue(undefined),
      readStreamFrom: jest.fn().mockResolvedValue([]),
      releaseRunLock: jest.fn().mockResolvedValue(undefined),
      ...runStore,
    } as unknown as AiRunStore;

    return {
      service: new AiService(config, credits, jobs, mp, usersService, address, store),
      dependencies: { config, credits, jobs, mp, usersService, address, store },
    };
  };

  describe('buildLetterResponseSchema', () => {
    it('does not enforce const values for context-derived fields', () => {
      const { service } = createService({
        configGet: () => null,
      });

      const schema = (service as any).buildLetterResponseSchema({
        mpName: 'Canonical MP',
        mpAddress1: 'Line 1',
        mpAddress2: 'Line 2',
        mpCity: 'Town',
        mpCounty: 'County',
        mpPostcode: 'AB1 2CD',
        constituency: 'Somewhere',
        senderName: 'Constituent',
        senderAddress1: 'Sender Line 1',
        senderAddress2: 'Sender Line 2',
        senderAddress3: 'Sender Line 3',
        senderCity: 'Sender Town',
        senderCounty: 'Sender County',
        senderPostcode: 'ZX9 9XZ',
        senderTelephone: '020 7946 0123',
        today: '2025-01-15',
      });

      const fields = [
        'mp_name',
        'mp_address_1',
        'mp_address_2',
        'mp_city',
        'mp_county',
        'mp_postcode',
        'date',
        'sender_name',
        'sender_address_1',
        'sender_address_2',
        'sender_address_3',
        'sender_city',
        'sender_county',
        'sender_postcode',
        'sender_phone',
      ];

      for (const field of fields) {
        expect(schema.properties[field].const).toBeUndefined();
        expect(schema.properties[field].default).toEqual(expect.any(String));
      }
    });
  });

  describe('streamWritingDeskLetter', () => {
    const createActiveJob = (overrides: Partial<ActiveWritingDeskJobResource> = {}): ActiveWritingDeskJobResource => ({
      jobId: 'job-123',
      phase: 'generating',
      stepIndex: 0,
      followUpIndex: 0,
      form: { issueDescription: 'Issue details' },
      followUpQuestions: [],
      followUpAnswers: [],
      notes: null,
      responseId: null,
      researchContent: 'Research summary',
      researchResponseId: null,
      researchStatus: 'completed',
      letterStatus: 'idle',
      letterTone: null,
      letterResponseId: null,
      letterContent: null,
      letterReferences: [],
      letterJson: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    it('completes without streaming an error when model output uses non-canonical context values', async () => {
      const activeJob = createActiveJob();
      const capturedSchemas: any[] = [];

      const { service, dependencies } = createService({
        configGet: (key) => {
          switch (key) {
            case 'OPENAI_API_KEY':
              return 'test-key';
            case 'OPENAI_LETTER_MODEL':
              return 'gpt-5-mini';
            case 'OPENAI_LETTER_VERBOSITY':
              return 'medium';
            case 'OPENAI_LETTER_REASONING_EFFORT':
              return 'medium';
            default:
              return null;
          }
        },
        userCredits: {
          deductFromMine: jest.fn().mockResolvedValue({ credits: 9.5 }),
          addToMine: jest.fn().mockResolvedValue(undefined),
        },
        writingDeskJobs: {
          getActiveJobForUser: jest.fn().mockResolvedValue(activeJob),
          upsertActiveJob: jest.fn().mockResolvedValue(activeJob),
        },
      });

      const letterJson = JSON.stringify({
        mp_name: 'Different MP Name',
        mp_address_1: 'Alt Line 1',
        mp_address_2: 'Alt Line 2',
        mp_city: 'Alt City',
        mp_county: 'Alt County',
        mp_postcode: 'ZZ1 1ZZ',
        date: '2025-02-02',
        subject_line_html: '<p><strong>Subject:</strong> Alternate Subject</p>',
        letter_content: '<p>Body content</p>',
        sender_name: 'Alt Sender',
        sender_address_1: 'Alt Sender Line 1',
        sender_address_2: 'Alt Sender Line 2',
        sender_address_3: 'Alt Sender Line 3',
        sender_city: 'Alt Sender City',
        sender_county: 'Alt Sender County',
        sender_postcode: 'AA1 1AA',
        sender_phone: '555-0000',
        references: ['https://example.com/resource'],
      });

      const context = {
        mpName: 'Canonical MP',
        mpAddress1: 'Line 1',
        mpAddress2: 'Line 2',
        mpCity: 'Town',
        mpCounty: 'County',
        mpPostcode: 'AB1 2CD',
        constituency: 'Somewhere',
        senderName: 'Constituent',
        senderAddress1: 'Sender Line 1',
        senderAddress2: 'Sender Line 2',
        senderAddress3: 'Sender Line 3',
        senderCity: 'Sender Town',
        senderCounty: 'Sender County',
        senderPostcode: 'ZX9 9XZ',
        senderTelephone: '020 7946 0123',
        today: '2025-01-15',
      };

      (service as any).resolveLetterContext = jest.fn().mockResolvedValue(context);

      const persistLetterState = jest.fn().mockResolvedValue(undefined);
      const persistLetterResult = jest.fn().mockResolvedValue(undefined);
      (service as any).persistLetterState = persistLetterState;
      (service as any).persistLetterResult = persistLetterResult;

      const clientMock = {
        responses: {
          stream: jest.fn(() => ({
            controller: { abort: jest.fn() },
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: 'response.completed',
                response: {
                  id: 'resp-123',
                  output: [
                    {
                      content: [
                        {
                          type: 'output_text',
                          text: letterJson,
                        },
                      ],
                    },
                  ],
                },
              };
            },
          })),
        },
      };

      (service as any).getOpenAiClient = jest.fn().mockResolvedValue(clientMock);

      // Capture schema passed to OpenAI to confirm lack of const constraints
      (clientMock.responses.stream as jest.Mock).mockImplementation((params: any) => {
        capturedSchemas.push(params?.text?.format?.schema);
        return {
          controller: { abort: jest.fn() },
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'response.completed',
              response: {
                id: 'resp-123',
                output: [
                  {
                    content: [
                      {
                        type: 'output_text',
                        text: letterJson,
                      },
                    ],
                  },
                ],
              },
            };
          },
        };
      });

      const subjectMessages: Array<Record<string, any>> = [];

      const messageStream = service.streamWritingDeskLetter('user-1', {
        jobId: activeJob.jobId,
        tone: 'formal',
        resume: false,
      });

      await new Promise<void>((resolve, reject) => {
        const subscription = messageStream.subscribe({
          next: (event) => {
            const payload = JSON.parse(String(event.data));
            subjectMessages.push(payload);
            if (payload.type === 'complete') {
              subscription.unsubscribe();
              resolve();
            }
          },
          error: (error) => {
            reject(error);
          },
          complete: () => {
            resolve();
          },
        });
      });

      const runKey = `user-1::${activeJob.jobId}`;
      const run = ((service as any).letterRuns as Map<string, any>).get(runKey);
      if (run?.promise) {
        await run.promise;
      }

      expect(subjectMessages.some((message) => message.type === 'error')).toBe(false);

      const completePayload = subjectMessages.find((message) => message.type === 'complete');
      expect(completePayload).toBeDefined();
      expect(completePayload.letter.senderTelephone).toBe(context.senderTelephone);

      expect(persistLetterResult).toHaveBeenCalledWith(
        'user-1',
        activeJob,
        expect.objectContaining({
          status: 'completed',
          tone: 'formal',
          content: expect.stringContaining(`Tel: ${context.senderTelephone}`),
          json: letterJson,
        }),
      );

      expect(capturedSchemas).toHaveLength(1);
      const schema = capturedSchemas[0];
      expect(schema.properties.sender_phone.const).toBeUndefined();
      expect(schema.properties.sender_phone.default).toBe(context.senderTelephone);

      expect(dependencies.credits.deductFromMine).toHaveBeenCalledWith('user-1', expect.any(Number));
    });

    it('replays cached events when reconnecting to an existing letter run', async () => {
      const activeJob = createActiveJob({ letterTone: 'formal' });
      const completePayload = {
        type: 'complete' as const,
        letter: {
          mpName: 'Canonical MP',
          mpAddress1: 'Line 1',
          mpAddress2: 'Line 2',
          mpCity: 'Town',
          mpCounty: 'County',
          mpPostcode: 'AB1 2CD',
          date: '2025-01-15',
          subjectLineHtml: '<p>Subject</p>',
          letterContent: '<p>Body</p>',
          senderName: 'Constituent',
          senderAddress1: 'Sender Line 1',
          senderAddress2: 'Sender Line 2',
          senderAddress3: 'Sender Line 3',
          senderCity: 'Sender Town',
          senderCounty: 'Sender County',
          senderPostcode: 'ZX9 9XZ',
          senderTelephone: '020 7946 0123',
          references: [],
          responseId: 'resp-1',
          tone: 'formal',
          rawJson: '{}',
        },
        remainingCredits: 2,
      };

      const storedEntries = [
        { id: '0-1', payload: { type: 'status' as const, status: 'running', remainingCredits: 3 } },
        { id: '0-2', payload: { type: 'delta' as const, text: 'First chunk' } },
        { id: '0-3', payload: completePayload },
      ];

      const { service, dependencies } = createService({
        configGet: () => null,
        writingDeskJobs: {
          getActiveJobForUser: jest.fn().mockResolvedValue(activeJob),
        },
        runStore: {
          acquireRunLock: jest.fn().mockResolvedValue(null),
          getMetadata: jest
            .fn()
            .mockResolvedValue({ status: 'completed', responseId: 'resp-1', remainingCredits: 2, updatedAt: Date.now() }),
          getStreamEntries: jest.fn().mockResolvedValue(storedEntries),
          applyTtl: jest.fn().mockResolvedValue(undefined),
        },
      });

      const messageStream = service.streamWritingDeskLetter('user-1', {
        jobId: activeJob.jobId,
        resume: true,
      });

      const received: Array<Record<string, unknown>> = [];

      await new Promise<void>((resolve, reject) => {
        const subscription = messageStream.subscribe({
          next: (event) => {
            received.push(JSON.parse(String(event.data)));
          },
          error: (error) => {
            reject(error);
          },
          complete: () => {
            subscription.unsubscribe();
            resolve();
          },
        });
      });

      expect(received).toEqual(storedEntries.map((entry) => entry.payload));
      expect(dependencies.runStore.getMetadata).toHaveBeenCalledWith('letter', 'user-1::job-123');
      expect(dependencies.runStore.getStreamEntries).toHaveBeenCalledWith('letter', 'user-1::job-123');
      expect(dependencies.runStore.applyTtl).toHaveBeenCalledWith('letter', 'user-1::job-123', 5 * 60 * 1000);
    });

    it('releases the run lock once a leader completes the letter run', async () => {
      const activeJob = createActiveJob({ letterTone: 'formal' });
      const completePayload = {
        type: 'complete' as const,
        letter: {
          mpName: 'Canonical MP',
          mpAddress1: 'Line 1',
          mpAddress2: 'Line 2',
          mpCity: 'Town',
          mpCounty: 'County',
          mpPostcode: 'AB1 2CD',
          date: '2025-01-15',
          subjectLineHtml: '<p>Subject</p>',
          letterContent: '<p>Body</p>',
          senderName: 'Constituent',
          senderAddress1: 'Sender Line 1',
          senderAddress2: 'Sender Line 2',
          senderAddress3: 'Sender Line 3',
          senderCity: 'Sender Town',
          senderCounty: 'Sender County',
          senderPostcode: 'ZX9 9XZ',
          senderTelephone: '020 7946 0123',
          references: [],
          responseId: 'resp-1',
          tone: 'formal',
          rawJson: '{}',
        },
        remainingCredits: 2,
      };

      const { service, dependencies } = createService({
        configGet: () => null,
        writingDeskJobs: {
          getActiveJobForUser: jest.fn().mockResolvedValue(activeJob),
          upsertActiveJob: jest.fn().mockResolvedValue(activeJob),
        },
        runStore: {
          acquireRunLock: jest.fn().mockResolvedValue('leader-token'),
          clearRun: jest.fn().mockResolvedValue(undefined),
          setMetadata: jest.fn().mockResolvedValue(undefined),
          appendStreamEvent: jest.fn().mockResolvedValue('0-1'),
          refreshRunLock: jest.fn().mockResolvedValue(undefined),
          releaseRunLock: jest.fn().mockResolvedValue(undefined),
          applyTtl: jest.fn().mockResolvedValue(undefined),
        },
      });

      const executeSpy = jest
        .spyOn(service as any, 'executeLetterRun')
        .mockImplementation(async ({ run }: { run: any }) => {
          await (service as any).publishLetterRunPayload(run, completePayload);
        });

      const run = await (service as any).beginLetterRun('user-1', activeJob.jobId, { tone: 'formal', createIfMissing: true });
      await run.promise;

      executeSpy.mockRestore();

      expect(dependencies.runStore.appendStreamEvent).toHaveBeenCalledWith(
        'letter',
        'user-1::job-123',
        completePayload,
        5 * 60 * 1000,
      );
      expect(dependencies.runStore.refreshRunLock).toHaveBeenCalledWith(
        'letter',
        'user-1::job-123',
        'leader-token',
        5 * 60 * 1000,
      );
      expect(dependencies.runStore.releaseRunLock).toHaveBeenCalledWith('letter', 'user-1::job-123', 'leader-token');
      expect(dependencies.runStore.applyTtl).toHaveBeenCalledWith('letter', 'user-1::job-123', 5 * 60 * 1000);
      expect(run.status).toBe('completed');
    });
  });

  describe('error logging', () => {
    const createActiveJob = (overrides: Partial<ActiveWritingDeskJobResource> = {}): ActiveWritingDeskJobResource => ({
      jobId: 'job-123',
      phase: 'generating',
      stepIndex: 0,
      followUpIndex: 0,
      form: { issueDescription: 'Issue details' },
      followUpQuestions: [],
      followUpAnswers: [],
      notes: null,
      responseId: null,
      researchContent: 'Research summary',
      researchResponseId: null,
      researchStatus: 'completed',
      letterStatus: 'idle',
      letterTone: null,
      letterResponseId: null,
      letterContent: null,
      letterReferences: [],
      letterJson: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    it('logs comprehensive error details when letter composition fails', async () => {
      const activeJob = createActiveJob();
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
      };

      const { service, dependencies } = createService({
        configGet: (key) => {
          switch (key) {
            case 'OPENAI_API_KEY':
              return 'test-key';
            case 'OPENAI_LETTER_MODEL':
              return 'gpt-5-mini';
            default:
              return null;
          }
        },
        userCredits: {
          deductFromMine: jest.fn().mockResolvedValue({ credits: 9.5 }),
          addToMine: jest.fn().mockResolvedValue(undefined),
        },
        writingDeskJobs: {
          getActiveJobForUser: jest.fn().mockResolvedValue(activeJob),
          upsertActiveJob: jest.fn().mockResolvedValue(activeJob),
        },
      });

      // Mock the logger
      (service as any).logger = mockLogger;

      const clientMock = {
        responses: {
          stream: jest.fn(() => ({
            controller: { abort: jest.fn() },
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: 'response.error',
                error: {
                  message: 'Test error message',
                  code: 'TEST_ERROR_CODE',
                },
              };
            },
          })),
        },
      };

      (service as any).getOpenAiClient = jest.fn().mockResolvedValue(clientMock);
      (service as any).resolveLetterContext = jest.fn().mockResolvedValue({});
      (service as any).persistLetterState = jest.fn().mockResolvedValue(undefined);

      const messageStream = service.streamWritingDeskLetter('user-1', {
        jobId: activeJob.jobId,
        tone: 'formal',
        resume: false,
      });

      const errorMessages: Array<Record<string, any>> = [];

      await new Promise<void>((resolve, reject) => {
        const subscription = messageStream.subscribe({
          next: (event) => {
            const payload = JSON.parse(String(event.data));
            if (payload.type === 'error') {
              errorMessages.push(payload);
              subscription.unsubscribe();
              resolve();
            }
          },
          error: (error) => {
            reject(error);
          },
          complete: () => {
            resolve();
          },
        });
      });

      // Verify error logging was called with comprehensive context
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('LETTER_COMPOSITION_RESPONSE_ERROR: Test error message'),
        expect.objectContaining({
          errorType: 'LETTER_COMPOSITION_RESPONSE_ERROR',
          userId: 'user-1',
          jobId: activeJob.jobId,
          tone: 'formal',
          eventType: 'response.error',
          errorDetails: expect.objectContaining({
            message: 'Test error message',
            code: 'TEST_ERROR_CODE',
          }),
          timestamp: expect.any(String),
          service: 'writing-desk-letter-composition',
        })
      );

      // Verify error message was sent to client
      expect(errorMessages).toHaveLength(1);
      expect(errorMessages[0].type).toBe('error');
      expect(errorMessages[0].message).toBe('Letter composition failed. Please try again in a few moments.');
    });
  });
});
