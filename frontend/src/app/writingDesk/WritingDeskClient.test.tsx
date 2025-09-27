import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WritingDeskClient from './WritingDeskClient';
import { useActiveWritingDeskJob } from '../../features/writing-desk/hooks/useActiveWritingDeskJob';

jest.mock('../../features/writing-desk/hooks/useActiveWritingDeskJob');

type FollowUpResponse = {
  followUpQuestions?: string[];
  notes?: string | null;
  responseId?: string | null;
  remainingCredits?: number;
};

type FetchArgs = Parameters<typeof fetch>;

type ResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
};

const mockUseActiveWritingDeskJob = useActiveWritingDeskJob as jest.MockedFunction<
  typeof useActiveWritingDeskJob
>;

const createJsonResponse = (payload: any): ResponseLike => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

describe('WritingDeskClient', () => {
  const originalFetch = global.fetch;
  const saveJobMock = jest.fn();
  const clearJobMock = jest.fn();
  const refetchMock = jest.fn();
  const followUpQueue: FollowUpResponse[] = [];
  let fetchMock: jest.Mock<Promise<ResponseLike>, FetchArgs>;

  const setupFetchMock = () => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/me') {
        return createJsonResponse({ credits: 1 });
      }
      if (url === '/api/ai/writing-desk/follow-up') {
        const response = followUpQueue.shift();
        if (!response) {
          throw new Error('No queued follow-up response');
        }
        return createJsonResponse({
          followUpQuestions: response.followUpQuestions ?? [],
          notes: response.notes ?? null,
          responseId: response.responseId ?? null,
          remainingCredits: response.remainingCredits ?? 0.9,
        });
      }
      if (url === '/api/ai/writing-desk/follow-up/answers') {
        return createJsonResponse({ status: 'ok' });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    }) as unknown as jest.Mock<Promise<ResponseLike>, FetchArgs>;
    global.fetch = fetchMock as unknown as typeof fetch;
  };

  const renderComponent = () => {
    render(<WritingDeskClient />);
  };

  const answerInitialQuestions = async () => {
    const steps = [
      { label: 'Describe the issue in detail', answer: 'Issue description' },
      { label: 'Tell me who is affected and how', answer: 'Everyone is affected' },
      { label: 'Other supporting background', answer: 'Background context' },
      { label: 'What do you want to happen?', answer: 'Desired outcome' },
    ];

    for (let idx = 0; idx < steps.length; idx += 1) {
      const step = steps[idx];
      const textarea = await screen.findByLabelText(step.label);
      fireEvent.change(textarea, { target: { value: step.answer } });
      const buttonLabel = idx === steps.length - 1 ? 'Generate follow-up questions' : 'Next';
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: buttonLabel }));
      });
    }
  };

  const answerFollowUpQuestions = async (answers: string[]) => {
    for (let idx = 0; idx < answers.length; idx += 1) {
      const label = new RegExp(`Follow-up question ${idx + 1}`);
      const textarea = await screen.findByLabelText(label);
      fireEvent.change(textarea, { target: { value: answers[idx] } });
      const buttonLabel = idx === answers.length - 1 ? 'Save answers' : 'Next';
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: buttonLabel }));
      });
    }
  };

  beforeEach(() => {
    saveJobMock.mockResolvedValue({ jobId: 'job-123' });
    clearJobMock.mockResolvedValue(undefined);
    refetchMock.mockResolvedValue({ data: null } as any);
    followUpQueue.length = 0;
    setupFetchMock();
    mockUseActiveWritingDeskJob.mockReturnValue({
      activeJob: null,
      isLoading: false,
      refetch: refetchMock as any,
      saveJob: saveJobMock,
      isSaving: false,
      clearJob: clearJobMock,
      isClearing: false,
      error: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('persists summary state after submitting follow-up answers', async () => {
    followUpQueue.push({
      followUpQuestions: ['Question one?', 'Question two?'],
      notes: 'Helpful note',
      responseId: 'resp-1',
      remainingCredits: 0.8,
    });

    renderComponent();
    await answerInitialQuestions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ai/writing-desk/follow-up', expect.any(Object)));
    await answerFollowUpQuestions(['First answer', 'Second answer']);

    await screen.findByText('Initial summary captured');

    const summaryCall = saveJobMock.mock.calls.find(([payload]) => payload.phase === 'summary');
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.[0]).toMatchObject({
      phase: 'summary',
      followUpQuestions: ['Question one?', 'Question two?'],
      followUpAnswers: ['First answer', 'Second answer'],
      notes: 'Helpful note',
      responseId: 'resp-1',
    });
    expect(clearJobMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review follow-up answers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit intake answers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask for new follow-up questions (costs 0.1 credits)' })).toBeInTheDocument();
  });

  it('prompts before editing intake answers and regenerates follow-ups after confirmation', async () => {
    followUpQueue.push({
      followUpQuestions: ['Question one?', 'Question two?'],
      notes: 'Helpful note',
      responseId: 'resp-1',
      remainingCredits: 0.8,
    });
    followUpQueue.push({
      followUpQuestions: ['Regenerated follow-up question'],
      notes: 'Fresh note',
      responseId: 'resp-2',
      remainingCredits: 0.7,
    });

    renderComponent();
    await answerInitialQuestions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ai/writing-desk/follow-up', expect.any(Object)));
    await answerFollowUpQuestions(['First answer', 'Second answer']);
    await screen.findByText('Initial summary captured');

    const countFollowUpRequests = () =>
      fetchMock.mock.calls.filter(([url]) => {
        const requestUrl = typeof url === 'string' ? url : url.toString();
        return requestUrl === '/api/ai/writing-desk/follow-up';
      }).length;

    const followUpCallsBefore = countFollowUpRequests();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit intake answers' }));
    });

    const dialog = await screen.findByRole('dialog', { name: 'Edit intake answers?' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/will clear your existing follow-up questions/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No, keep current answers' }));
    });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit intake answers?' })).not.toBeInTheDocument(),
    );
    expect(countFollowUpRequests()).toBe(followUpCallsBefore);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit intake answers' }));
    });

    await screen.findByRole('dialog', { name: 'Edit intake answers?' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, edit intake' }));
    });

    await screen.findByLabelText('Describe the issue in detail');

    await answerInitialQuestions();

    await waitFor(() => expect(countFollowUpRequests()).toBe(followUpCallsBefore + 1));

    const followUpTextarea = await screen.findByLabelText(/Follow-up question 1 of 1/);
    expect(followUpTextarea).toHaveValue('');
    expect(screen.getByText('Regenerated follow-up question')).toBeInTheDocument();
    expect(countFollowUpRequests()).toBe(followUpCallsBefore + 1);
  });

  it('regenerates follow-up questions when requested from the summary view', async () => {
    followUpQueue.push({
      followUpQuestions: ['Question one?', 'Question two?'],
      notes: 'Helpful note',
      responseId: 'resp-1',
      remainingCredits: 0.8,
    });
    followUpQueue.push({
      followUpQuestions: ['New follow-up question'],
      notes: 'Fresh note',
      responseId: 'resp-2',
      remainingCredits: 0.7,
    });

    renderComponent();
    await answerInitialQuestions();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ai/writing-desk/follow-up', expect.any(Object)));
    await answerFollowUpQuestions(['First answer', 'Second answer']);
    await screen.findByText('Initial summary captured');

    const followUpCallsBefore = fetchMock.mock.calls.filter(([url]) => {
      const requestUrl = typeof url === 'string' ? url : url.toString();
      return requestUrl === '/api/ai/writing-desk/follow-up';
    }).length;

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Ask for new follow-up questions (costs 0.1 credits)' }),
      );
    });

    await screen.findByLabelText(/Follow-up question 1 of 1/);
    expect(screen.getByText('New follow-up question')).toBeInTheDocument();

    const followUpCallsAfter = fetchMock.mock.calls.filter(([url]) => {
      const requestUrl = typeof url === 'string' ? url : url.toString();
      return requestUrl === '/api/ai/writing-desk/follow-up';
    }).length;
    expect(followUpCallsAfter).toBe(followUpCallsBefore + 1);
  });
});
