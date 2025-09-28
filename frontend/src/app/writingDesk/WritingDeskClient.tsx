"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ActiveJobResumeModal from '../../features/writing-desk/components/ActiveJobResumeModal';
import EditIntakeConfirmModal from '../../features/writing-desk/components/EditIntakeConfirmModal';
import StartOverConfirmModal from '../../features/writing-desk/components/StartOverConfirmModal';
import { useActiveWritingDeskJob } from '../../features/writing-desk/hooks/useActiveWritingDeskJob';
import { ActiveWritingDeskJob, UpsertActiveWritingDeskJobPayload } from '../../features/writing-desk/types';

type StepKey = 'issueDetail' | 'affectedDetail' | 'backgroundDetail' | 'desiredOutcome';

type FormState = Record<StepKey, string>;

const steps: Array<{
  key: StepKey;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: 'issueDetail',
    title: 'Describe the issue in detail',
    description: 'Explain the situation as clearly as you can so the letter can state the facts.',
    placeholder: 'E.g. The heating in my flat has been broken since December and…',
  },
  {
    key: 'affectedDetail',
    title: 'Tell me who is affected and how',
    description: 'Share who is impacted – you, your family, neighbours, or the wider community.',
    placeholder: 'E.g. My young children are getting ill from the cold and elderly neighbours are…',
  },
  {
    key: 'backgroundDetail',
    title: 'Other supporting background',
    description: 'Mention any history, evidence, or previous actions taken so far.',
    placeholder: 'E.g. I have reported this to the council twice (ref 12345) and attached photos…',
  },
  {
    key: 'desiredOutcome',
    title: 'What do you want to happen?',
    description: 'State the outcome you hope to achieve so the MP knows what to push for.',
    placeholder: 'E.g. I want the housing association to replace the boiler within two weeks…',
  },
];

const initialFormState: FormState = {
  issueDetail: '',
  affectedDetail: '',
  backgroundDetail: '',
  desiredOutcome: '',
};

type ResearchStatus = 'idle' | 'running' | 'completed' | 'error';

type DeepResearchStreamMessage =
  | { type: 'status'; status: string; remainingCredits?: number | null }
  | { type: 'delta'; text: string }
  | {
      type: 'complete';
      content: string;
      responseId: string | null;
      remainingCredits: number | null;
      usage?: Record<string, unknown> | null;
    }
  | { type: 'event'; event: { type?: string; [key: string]: any } }
  | { type: 'error'; message: string; remainingCredits?: number | null };

type DeepResearchHandshakeResponse = {
  jobId?: string | null;
  streamPath?: string | null;
};

const MAX_RESEARCH_ACTIVITY_ITEMS = 10;

type ResearchActivityDescriptor = {
  text: string;
  options?: {
    mergeKey?: string;
    strategy?: 'replace' | 'append';
  };
};

const extractReasoningSummary = (event: Record<string, any>): string | null => {
  if (!event) return null;
  const direct = typeof event.reasoning === 'string' ? event.reasoning : null;
  if (direct && direct.trim().length > 0) return direct.trim();
  const nestedSummary = typeof event?.reasoning?.summary === 'string' ? event.reasoning.summary : null;
  if (nestedSummary && nestedSummary.trim().length > 0) return nestedSummary.trim();
  const summary = typeof event.summary === 'string' ? event.summary : null;
  if (summary && summary.trim().length > 0) return summary.trim();
  return null;
};

const describeResearchEvent = (event: { type?: string; [key: string]: any }): ResearchActivityDescriptor | null => {
  if (!event || typeof event.type !== 'string') return null;
  switch (event.type) {
    case 'response.web_search_call.searching':
      return { text: 'Searching the web for relevant sources…' };
    case 'response.web_search_call.in_progress':
      return { text: 'Reviewing a web result…' };
    case 'response.web_search_call.completed':
      return { text: 'Finished reviewing a web result.' };
    case 'response.file_search_call.searching':
      return { text: 'Searching private documents for supporting evidence…' };
    case 'response.file_search_call.completed':
      return { text: 'Finished reviewing private documents.' };
    case 'response.code_interpreter_call.in_progress':
      return { text: 'Analysing data with the code interpreter…' };
    case 'response.code_interpreter_call.completed':
      return { text: 'Completed data analysis via code interpreter.' };
    case 'response.reasoning.delta': {
      const summary = typeof event.delta === 'string' ? event.delta.trim() : '';
      return summary.length > 0
        ? { text: summary, options: { mergeKey: 'reasoning', strategy: 'append' } }
        : null;
    }
    case 'response.reasoning.done': {
      const summary = extractReasoningSummary(event);
      return {
        text: summary ?? 'Reasoning summary updated.',
        options: { mergeKey: 'reasoning', strategy: summary ? 'replace' : 'append' },
      };
    }
    default:
      return null;
  }
};

export default function WritingDeskClient() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [phase, setPhase] = useState<'initial' | 'generating' | 'followup' | 'summary'>('initial');
  const [stepIndex, setStepIndex] = useState(0);
  const [followUpIndex, setFollowUpIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [ellipsisCount, setEllipsisCount] = useState(0);
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const {
    activeJob,
    isLoading: isActiveJobLoading,
    saveJob,
    isSaving: isSavingJob,
    clearJob,
    isClearing: isClearingJob,
    error: activeJobError,
  } = useActiveWritingDeskJob();
  const [jobId, setJobId] = useState<string | null>(null);
  const [hasHandledInitialJob, setHasHandledInitialJob] = useState(false);
  const [pendingJob, setPendingJob] = useState<ActiveWritingDeskJob | null>(null);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const lastPersistedRef = useRef<string | null>(null);
  const [jobSaveError, setJobSaveError] = useState<string | null>(null);
  const [editIntakeModalOpen, setEditIntakeModalOpen] = useState(false);
  const [startOverConfirmOpen, setStartOverConfirmOpen] = useState(false);
  const [researchContent, setResearchContent] = useState<string>('');
  const [researchResponseId, setResearchResponseId] = useState<string | null>(null);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus>('idle');
  const [researchActivities, setResearchActivities] = useState<Array<{ id: string; text: string; mergeKey?: string }>>([]);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [pendingAutoResume, setPendingAutoResume] = useState(false);
  const researchSourceRef = useRef<EventSource | null>(null);
  const previousPhaseRef = useRef<'initial' | 'generating' | 'followup' | 'summary'>();

  const currentStep = phase === 'initial' ? steps[stepIndex] ?? null : null;
  const followUpCreditCost = 0.1;
  const deepResearchCreditCost = 0.7;
  const formatCredits = (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    return rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  };
  const refreshCredits = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data?.credits === 'number') {
        return Math.round(data.credits * 100) / 100;
      }
    } catch {
      // Ignore transient failures, caller can decide how to handle null
    }
    return null;
  }, []);

  const closeResearchStream = useCallback(() => {
    if (researchSourceRef.current) {
      researchSourceRef.current.close();
      researchSourceRef.current = null;
    }
  }, []);

  const resetResearch = useCallback(() => {
    closeResearchStream();
    setResearchContent('');
    setResearchResponseId(null);
    setResearchStatus('idle');
    setResearchActivities([]);
    setResearchError(null);
    setPendingAutoResume(false);
  }, [closeResearchStream]);

  const appendResearchActivity = useCallback(
    (text: string, options?: { mergeKey?: string; strategy?: 'replace' | 'append' }) => {
      setResearchActivities((prev) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          return prev;
        }

        const mergeKey = options?.mergeKey;
        const strategy = options?.strategy ?? 'replace';

        if (mergeKey) {
          const existingIndex = prev.findIndex((item) => item.mergeKey === mergeKey);
          if (existingIndex >= 0) {
            const existing = prev[existingIndex];
            const nextText =
              strategy === 'append' && existing.text.length > 0
                ? `${existing.text}${existing.text.endsWith(' ') ? '' : ' '}${trimmed}`.trim()
                : trimmed;
            const updated = { ...existing, text: nextText };
            const next = [updated, ...prev.filter((_, idx) => idx !== existingIndex)];
            return next.slice(0, MAX_RESEARCH_ACTIVITY_ITEMS);
          }
        }

        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: trimmed,
          mergeKey,
        };
        const next = [entry, ...prev];
        return next.slice(0, MAX_RESEARCH_ACTIVITY_ITEMS);
      });
    },
    [],
  );

  const updateCreditsFromStream = useCallback((value: number | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      setAvailableCredits(Math.round(value * 100) / 100);
    }
  }, []);

  const totalFollowUpSteps = followUps.length > 0 ? followUps.length : 1;
  const totalSteps = steps.length + totalFollowUpSteps;
  const currentStepNumber = useMemo(() => {
    if (phase === 'initial') return stepIndex + 1;
    if (phase === 'generating') return steps.length;
    if (phase === 'followup') return steps.length + followUpIndex + 1;
    return steps.length + totalFollowUpSteps;
  }, [phase, stepIndex, followUpIndex, totalFollowUpSteps]);
  const completedSteps = useMemo(() => {
    if (phase === 'initial') return stepIndex;
    if (phase === 'generating') return steps.length;
    if (phase === 'followup') return steps.length + followUpIndex;
    return steps.length + totalFollowUpSteps;
  }, [phase, stepIndex, followUpIndex, totalFollowUpSteps]);
  const progress = useMemo(() => (completedSteps / totalSteps) * 100, [completedSteps, totalSteps]);
  const isGeneratingFollowUps = phase === 'generating';
  const creditState = useMemo<'loading' | 'low' | 'ok'>(() => {
    if (availableCredits === null) return 'loading';
    return availableCredits < followUpCreditCost ? 'low' : 'ok';
  }, [availableCredits, followUpCreditCost]);
  const creditClassName = useMemo(() => {
    const classes = ['credit-balance'];
    if (creditState === 'low') classes.push('credit-balance--low');
    if (creditState === 'loading') classes.push('credit-balance--loading');
    return classes.join(' ');
  }, [creditState]);
  const creditDisplayValue = availableCredits === null ? 'Checking…' : formatCredits(availableCredits);
  const creditAriaLabel =
    availableCredits === null
      ? 'Checking available credits'
      : `You have ${formatCredits(availableCredits)} credits available`;

  const researchCreditState = useMemo<'loading' | 'low' | 'ok'>(() => {
    if (availableCredits === null) return 'loading';
    return availableCredits < deepResearchCreditCost ? 'low' : 'ok';
  }, [availableCredits, deepResearchCreditCost]);
  const hasResearchContent = researchContent.trim().length > 0;
  const researchButtonDisabled =
    researchStatus === 'running' || researchCreditState === 'loading' || researchCreditState === 'low';
  const researchButtonLabel =
    researchStatus === 'running'
      ? 'Deep research in progress…'
      : `${hasResearchContent ? 'Run deep research again' : 'Start deep research'} (costs ${formatCredits(
          deepResearchCreditCost,
        )} credits)`;

  useEffect(() => {
    if (!isGeneratingFollowUps) {
      setEllipsisCount(0);
      return;
    }
    // Animate the status text while we wait for follow-up questions to arrive.
    const interval = window.setInterval(() => {
      setEllipsisCount((prev) => (prev + 1) % 5);
    }, 400);
    return () => {
      window.clearInterval(interval);
    };
  }, [isGeneratingFollowUps]);

  useEffect(() => {
    if (phase === 'summary' && previousPhaseRef.current !== 'summary') {
      setShowSummaryDetails(false);
    }
    previousPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const latest = await refreshCredits();
      if (!cancelled && typeof latest === 'number') {
        setAvailableCredits(latest);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCredits]);

  useEffect(() => {
    return () => {
      closeResearchStream();
    };
  }, [closeResearchStream]);

  const generatingMessage = `Generating follow-up questions${'.'.repeat((ellipsisCount % 5) + 1)}`;

  const resetFollowUps = useCallback(() => {
    setFollowUps([]);
    setFollowUpAnswers([]);
    setFollowUpIndex(0);
    setNotes(null);
    setResponseId(null);
    resetResearch();
  }, [resetResearch]);

  const resetLocalState = useCallback(() => {
    setForm({ ...initialFormState });
    setPhase('initial');
    setStepIndex(0);
    setFollowUpIndex(0);
    setError(null);
    setServerError(null);
    setLoading(false);
    setShowSummaryDetails(false);
    resetFollowUps();
  }, [resetFollowUps]);

  const startDeepResearch = useCallback(
    async (options?: { resume?: boolean }) => {
      const resume = options?.resume === true;
      if (!resume && researchStatus === 'running') return;

      closeResearchStream();
      setPendingAutoResume(false);
      setResearchStatus('running');
      setResearchContent('');
      setResearchResponseId(null);
      setResearchError(null);
      setResearchActivities([]);

      try {
        const payload: Record<string, unknown> = {};
        if (jobId) payload.jobId = jobId;
        if (resume) payload.resume = true;

        const response = await fetch('/api/writing-desk/jobs/active/research/start', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const rawBody = await response.text();
        if (!response.ok) {
          let message = 'We could not start deep research. Please try again.';
          if (rawBody) {
            try {
              const parsed = JSON.parse(rawBody) as { message?: string };
              if (parsed && typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
                message = parsed.message.trim();
              }
            } catch {
              const trimmed = rawBody.trim();
              if (trimmed.length > 0) {
                message = trimmed;
              }
            }
          }
          throw new Error(message);
        }

        let handshake: DeepResearchHandshakeResponse | null = null;
        if (rawBody) {
          try {
            handshake = JSON.parse(rawBody) as DeepResearchHandshakeResponse;
          } catch {
            // If parsing fails, fall back to defaults below.
          }
        }

        const streamPath =
          handshake && typeof handshake.streamPath === 'string' && handshake.streamPath.trim().length > 0
            ? handshake.streamPath.trim()
            : '/api/ai/writing-desk/deep-research';
        const endpoint = new URL(streamPath, window.location.origin);
        const resolvedJobId =
          handshake && typeof handshake.jobId === 'string' && handshake.jobId.trim().length > 0
            ? handshake.jobId.trim()
            : jobId;
        if (resolvedJobId && !endpoint.searchParams.has('jobId')) {
          endpoint.searchParams.set('jobId', resolvedJobId);
        }

        if (resolvedJobId && resolvedJobId !== jobId) {
          setJobId(resolvedJobId);
        }

        const source = new EventSource(endpoint.toString(), { withCredentials: true });
        researchSourceRef.current = source;

        source.onmessage = (event) => {
          let payload: DeepResearchStreamMessage | null = null;
          try {
            payload = JSON.parse(event.data) as DeepResearchStreamMessage;
          } catch {
            return;
          }
          if (!payload) return;

          if (payload.type === 'status') {
            updateCreditsFromStream(payload.remainingCredits);
            const statusMessage: Record<string, string> = {
              starting: 'Preparing the research brief…',
              charged: 'Credits deducted. Research is starting…',
              queued: 'Deep research queued…',
              in_progress: 'Gathering evidence…',
            };
            const descriptor = typeof payload.status === 'string' ? statusMessage[payload.status] : undefined;
            if (descriptor) appendResearchActivity(descriptor);
          } else if (payload.type === 'delta') {
            if (typeof payload.text === 'string') {
              setResearchContent((prev) => prev + payload.text);
            }
          } else if (payload.type === 'event') {
            const descriptor = describeResearchEvent(payload.event);
            if (descriptor) {
              appendResearchActivity(descriptor.text, descriptor.options);
            }
          } else if (payload.type === 'complete') {
            closeResearchStream();
            setResearchStatus('completed');
            setResearchContent(payload.content ?? '');
            setResearchResponseId(payload.responseId ?? null);
            updateCreditsFromStream(payload.remainingCredits);
            appendResearchActivity('Deep research completed.');
            setPendingAutoResume(false);
          } else if (payload.type === 'error') {
            closeResearchStream();
            setResearchStatus('error');
            setResearchError(payload.message || 'Deep research failed. Please try again.');
            updateCreditsFromStream(payload.remainingCredits);
            appendResearchActivity('Deep research encountered an error.');
            setPendingAutoResume(false);
          }
        };

        source.onerror = () => {
          closeResearchStream();
          setResearchStatus('error');
          setResearchError('The research stream was interrupted. Please try again.');
          appendResearchActivity('Connection lost during deep research.');
          setPendingAutoResume(false);
        };
      } catch (err) {
        closeResearchStream();
        setResearchStatus('error');
        const message =
          err instanceof Error && err.message ? err.message : 'We could not start deep research. Please try again.';
        setResearchError(message);
        appendResearchActivity('Unable to start deep research.');
        setPendingAutoResume(false);
      }
    },
    [appendResearchActivity, closeResearchStream, jobId, researchStatus, updateCreditsFromStream],
  );

  useEffect(() => {
    if (!pendingAutoResume) return;
    if (!hasHandledInitialJob) return;
    if (researchSourceRef.current) {
      setPendingAutoResume(false);
      return;
    }
    setPendingAutoResume(false);
    void startDeepResearch({ resume: true });
  }, [hasHandledInitialJob, pendingAutoResume, startDeepResearch]);

  const applySnapshot = useCallback(
    (job: ActiveWritingDeskJob) => {
      closeResearchStream();
      setForm({
        issueDetail: job.form?.issueDetail ?? '',
        affectedDetail: job.form?.affectedDetail ?? '',
        backgroundDetail: job.form?.backgroundDetail ?? '',
        desiredOutcome: job.form?.desiredOutcome ?? '',
      });
      setPhase(job.phase);
      setStepIndex(Math.max(0, job.stepIndex ?? 0));
      const questions = Array.isArray(job.followUpQuestions) ? [...job.followUpQuestions] : [];
      setFollowUps(questions);
      const answers = questions.map((_, idx) => job.followUpAnswers?.[idx] ?? '');
      setFollowUpAnswers(answers);
      const maxFollowUpIndex = questions.length > 0 ? questions.length - 1 : 0;
      const nextFollowUpIndex = Math.max(0, Math.min(job.followUpIndex ?? 0, maxFollowUpIndex));
      setFollowUpIndex(nextFollowUpIndex);
      setNotes(job.notes ?? null);
      setResponseId(job.responseId ?? null);
      const existingResearch = job.researchContent ?? '';
      setResearchContent(existingResearch);
      setResearchResponseId(job.researchResponseId ?? null);
      const nextStatus = job.researchStatus ?? (existingResearch.trim().length > 0 ? 'completed' : 'idle');
      setResearchStatus(nextStatus === 'running' ? 'running' : nextStatus);
      setPendingAutoResume(nextStatus === 'running');
      setResearchActivities([]);
      setResearchError(null);
      setError(null);
      setServerError(null);
      setShowSummaryDetails(false);
      setLoading(false);
      setJobSaveError(null);
    },
    [closeResearchStream, resetFollowUps],
  );

  const resourceToPayload = useCallback(
    (job: ActiveWritingDeskJob): UpsertActiveWritingDeskJobPayload => ({
      jobId: job.jobId,
      phase: job.phase,
      stepIndex: job.stepIndex,
      followUpIndex: job.followUpIndex,
      form: {
        issueDetail: job.form?.issueDetail ?? '',
        affectedDetail: job.form?.affectedDetail ?? '',
        backgroundDetail: job.form?.backgroundDetail ?? '',
        desiredOutcome: job.form?.desiredOutcome ?? '',
      },
      followUpQuestions: Array.isArray(job.followUpQuestions) ? [...job.followUpQuestions] : [],
      followUpAnswers: Array.isArray(job.followUpAnswers) ? [...job.followUpAnswers] : [],
      notes: job.notes ?? null,
      responseId: job.responseId ?? null,
      researchContent: job.researchContent ?? null,
      researchResponseId: job.researchResponseId ?? null,
      researchStatus: job.researchStatus ?? 'idle',
    }),
    [],
  );

  const buildSnapshotPayload = useCallback(
    (): UpsertActiveWritingDeskJobPayload => ({
      jobId: jobId ?? undefined,
      phase,
      stepIndex,
      followUpIndex,
      form: { ...form },
      followUpQuestions: [...followUps],
      followUpAnswers: [...followUpAnswers],
      notes: notes ?? null,
      responseId: responseId ?? null,
      researchContent,
      researchResponseId: researchResponseId ?? null,
      researchStatus,
    }),
    [
      followUpAnswers,
      followUpIndex,
      followUps,
      form,
      jobId,
      notes,
      phase,
      researchContent,
      researchResponseId,
      researchStatus,
      responseId,
      stepIndex,
    ],
  );

  const signatureForPayload = useCallback(
    (payload: UpsertActiveWritingDeskJobPayload, resolvedJobId?: string | null) =>
      JSON.stringify({
        ...payload,
        jobId: resolvedJobId ?? payload.jobId ?? null,
      }),
    [],
  );

  useEffect(() => {
    if (hasHandledInitialJob || isActiveJobLoading) return;
    if (activeJob) {
      setPendingJob(activeJob);
      setResumeModalOpen(true);
    } else {
      resetLocalState();
      setHasHandledInitialJob(true);
      setJobId(null);
      lastPersistedRef.current = null;
    }
  }, [activeJob, hasHandledInitialJob, isActiveJobLoading, resetLocalState]);

  useEffect(() => {
    if (!activeJobError) return;
    setJobSaveError('We could not load your saved letter. You can start a new one.');
    resetLocalState();
    setHasHandledInitialJob(true);
    setJobId(null);
    lastPersistedRef.current = null;
    setPendingJob(null);
    setResumeModalOpen(false);
  }, [activeJobError, resetLocalState]);

  const handleResumeExistingJob = useCallback(() => {
    if (!pendingJob) return;
    applySnapshot(pendingJob);
    setJobId(pendingJob.jobId);
    const payload = resourceToPayload(pendingJob);
    lastPersistedRef.current = signatureForPayload(payload, pendingJob.jobId);
    setResumeModalOpen(false);
    setPendingJob(null);
    setHasHandledInitialJob(true);
    setPersistenceEnabled(true);
    setJobSaveError(null);
  }, [applySnapshot, pendingJob, resourceToPayload, signatureForPayload]);

  const handleDiscardExistingJob = useCallback(async () => {
    setJobSaveError(null);
    setPersistenceEnabled(false);
    lastPersistedRef.current = null;
    setJobId(null);
    try {
      await clearJob();
      resetLocalState();
      setPendingJob(null);
      setResumeModalOpen(false);
      setHasHandledInitialJob(true);
    } catch {
      setJobSaveError('We could not clear your saved letter. Please try again.');
    }
  }, [clearJob, resetLocalState]);

  const currentSnapshot = useMemo(() => buildSnapshotPayload(), [buildSnapshotPayload]);

  useEffect(() => {
    if (!persistenceEnabled) return;
    if (isSavingJob) return;
    const signature = signatureForPayload(currentSnapshot, jobId);
    if (lastPersistedRef.current === signature) return;

    const timeout = window.setTimeout(() => {
      saveJob(currentSnapshot)
        .then((job) => {
          setJobId(job.jobId);
          lastPersistedRef.current = signatureForPayload(currentSnapshot, job.jobId);
          setJobSaveError(null);
        })
        .catch(() => {
          setJobSaveError('We could not save your progress. We will keep trying automatically.');
        });
    }, 500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [currentSnapshot, isSavingJob, jobId, persistenceEnabled, saveJob, signatureForPayload]);

  const handleInitialChange = (value: string) => {
    if (!currentStep) return;
    if (!persistenceEnabled) setPersistenceEnabled(true);
    setForm((prev) => ({ ...prev, [currentStep.key]: value }));
  };

  const handleInitialBack = () => {
    setServerError(null);
    setError(null);
    if (stepIndex === 0) return;
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const submitBundle = async (
    questions: string[],
    answers: string[],
    context?: { notes: string | null; responseId: string | null },
  ) => {
    setLoading(true);
    setServerError(null);
    try {
      const res = await fetch('/api/ai/writing-desk/follow-up/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          issueDetail: form.issueDetail.trim(),
          affectedDetail: form.affectedDetail.trim(),
          backgroundDetail: form.backgroundDetail.trim(),
          desiredOutcome: form.desiredOutcome.trim(),
          followUpQuestions: questions,
          followUpAnswers: answers.map((answer) => answer.trim()),
          notes: (context?.notes ?? notes) ?? undefined,
          responseId: (context?.responseId ?? responseId) ?? undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed (${res.status})`);
      }
      const trimmedAnswers = answers.map((answer) => answer.trim());
      const resolvedNotes = (context?.notes ?? notes) ?? null;
      const resolvedResponseId = (context?.responseId ?? responseId) ?? null;

      setFollowUpAnswers(trimmedAnswers);
      setNotes(resolvedNotes);
      setResponseId(resolvedResponseId);
      setPhase('summary');
      setPersistenceEnabled(true);

      const payload: UpsertActiveWritingDeskJobPayload = {
        jobId: jobId ?? undefined,
        phase: 'summary',
        stepIndex,
        followUpIndex,
        form: { ...form },
        followUpQuestions: [...questions],
        followUpAnswers: trimmedAnswers,
        notes: resolvedNotes,
        responseId: resolvedResponseId,
      };

      try {
        const savedJob = await saveJob(payload);
        setJobId(savedJob.jobId);
        lastPersistedRef.current = signatureForPayload(payload, savedJob.jobId);
        setJobSaveError(null);
      } catch {
        setJobSaveError('We could not save your progress. We will keep trying automatically.');
      }
    } catch (err: any) {
      setServerError(err?.message || 'Something went wrong. Please try again.');
      setPhase(followUps.length > 0 ? 'followup' : 'initial');
    } finally {
      setLoading(false);
    }
  };

  const generateFollowUps = useCallback(
    async (origin: 'initial' | 'summary') => {
      setError(null);
      setServerError(null);
      setLoading(true);

      let currentCredits = availableCredits;
      const refreshedCredits = await refreshCredits();
      if (typeof refreshedCredits === 'number') {
        currentCredits = refreshedCredits;
        setAvailableCredits(refreshedCredits);
      }

      if (currentCredits !== null && currentCredits < followUpCreditCost) {
        const message = `You need at least ${formatCredits(followUpCreditCost)} credits to generate follow-up questions.`;
        if (origin === 'initial') {
          setError(message);
        } else {
          setServerError(message);
        }
        setLoading(false);
        return;
      }

      setPhase('generating');

      const previousCredits = currentCredits;
      if (currentCredits !== null) {
        const optimisticCredits = Math.max(0, Math.round((currentCredits - followUpCreditCost) * 100) / 100);
        setAvailableCredits(optimisticCredits);
      }

      try {
        const res = await fetch('/api/ai/writing-desk/follow-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            issueDetail: form.issueDetail.trim(),
            affectedDetail: form.affectedDetail.trim(),
            backgroundDetail: form.backgroundDetail.trim(),
            desiredOutcome: form.desiredOutcome.trim(),
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Request failed (${res.status})`);
        }
        const json = await res.json();
        const questions: string[] = Array.isArray(json?.followUpQuestions)
          ? json.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim().length > 0)
          : [];
        setFollowUps(questions);
        setNotes(json?.notes ?? null);
        setResponseId(json?.responseId ?? null);
        if (typeof json?.remainingCredits === 'number') {
          setAvailableCredits(Math.round(json.remainingCredits * 100) / 100);
        } else {
          const latestCredits = await refreshCredits();
          if (typeof latestCredits === 'number') {
            setAvailableCredits(latestCredits);
          }
        }

        if (questions.length === 0) {
          setFollowUpAnswers([]);
          setFollowUpIndex(0);
          await submitBundle([], [], { notes: json?.notes ?? null, responseId: json?.responseId ?? null });
        } else {
          setFollowUpAnswers(questions.map(() => ''));
          setFollowUpIndex(0);
          setPhase('followup');
        }
      } catch (err: any) {
        const message = err?.message || 'Something went wrong. Please try again.';
        setServerError(message);
        if (origin === 'initial') {
          setPhase('initial');
          setStepIndex(steps.length - 1);
        } else {
          setPhase('summary');
        }
        const latestCredits = await refreshCredits();
        if (typeof latestCredits === 'number') {
          setAvailableCredits(latestCredits);
        } else if (previousCredits !== null) {
          setAvailableCredits(previousCredits);
        }
      } finally {
        setLoading(false);
      }
    },
    [availableCredits, followUpCreditCost, form, refreshCredits, submitBundle],
  );

  const handleInitialNext = async () => {
    if (!currentStep) return;
    const value = form[currentStep.key].trim();
    if (!value) {
      setError('Please provide an answer before continuing.');
      return;
    }
    setError(null);

    const isLastStep = stepIndex === steps.length - 1;
    if (!isLastStep) {
      setStepIndex((prev) => prev + 1);
      return;
    }

    if (followUps.length > 0) {
      setPhase('followup');
      setFollowUpIndex(Math.max(0, Math.min(followUpIndex, followUps.length - 1)));
      return;
    }

    await generateFollowUps('initial');
  };

  const handleFollowUpChange = (value: string) => {
    if (!persistenceEnabled) setPersistenceEnabled(true);
    setFollowUpAnswers((prev) => {
      const next = [...prev];
      next[followUpIndex] = value;
      return next;
    });
  };

  const handleFollowUpBack = () => {
    setServerError(null);
    setError(null);
    if (followUpIndex === 0) {
      setPhase('initial');
      setStepIndex(steps.length - 1);
      return;
    }
    setFollowUpIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleFollowUpNext = async () => {
    const answer = followUpAnswers[followUpIndex]?.trim?.() ?? '';
    if (!answer) {
      setError('Please answer this question before continuing.');
      return;
    }
    setError(null);

    const nextAnswers = followUpAnswers.map((value, idx) => (idx === followUpIndex ? answer : value));
    setFollowUpAnswers(nextAnswers);

    const isLastFollowUp = followUpIndex === followUps.length - 1;
    if (!isLastFollowUp) {
      setFollowUpIndex((prev) => prev + 1);
      return;
    }

    await submitBundle(followUps, nextAnswers);
  };

  const handleStartOver = useCallback(async () => {
    setJobSaveError(null);
    setPersistenceEnabled(false);
    lastPersistedRef.current = null;
    setJobId(null);
    setHasHandledInitialJob(true);
    setPendingJob(null);
    setResumeModalOpen(false);
    resetLocalState();
    try {
      await clearJob();
    } catch {
      setJobSaveError('We could not clear your saved letter. Please try again.');
    }
  }, [clearJob, resetLocalState]);

  const handleConfirmStartOver = useCallback(() => {
    setStartOverConfirmOpen(false);
    void handleStartOver();
  }, [handleStartOver]);

  const handleCancelStartOver = useCallback(() => {
    setStartOverConfirmOpen(false);
  }, []);

  const handleEditInitialStep = useCallback(
    (stepKey: StepKey) => {
      const targetIndex = steps.findIndex((step) => step.key === stepKey);
      if (targetIndex === -1) return;
      setServerError(null);
      setError(null);
      setPhase('initial');
      setStepIndex(targetIndex);
    },
    [],
  );

  const handleConfirmEditIntake = useCallback(() => {
    resetFollowUps();
    setEditIntakeModalOpen(false);
    handleEditInitialStep('issueDetail');
  }, [handleEditInitialStep, resetFollowUps]);

  const handleCancelEditIntake = useCallback(() => {
    setEditIntakeModalOpen(false);
  }, []);

  const handleEditFollowUpQuestion = useCallback((index: number) => {
    if (index < 0 || index >= followUps.length) return;
    setServerError(null);
    setError(null);
    setPhase('followup');
    setFollowUpIndex(index);
  }, [followUps.length]);

  const handleRegenerateFollowUps = useCallback(() => {
    void generateFollowUps('summary');
  }, [generateFollowUps]);

  return (
    <>
      <StartOverConfirmModal
        open={startOverConfirmOpen}
        onConfirm={handleConfirmStartOver}
        onCancel={handleCancelStartOver}
      />
      <EditIntakeConfirmModal
        open={editIntakeModalOpen}
        creditCost={formatCredits(followUpCreditCost)}
        onConfirm={handleConfirmEditIntake}
        onCancel={handleCancelEditIntake}
      />
      <ActiveJobResumeModal
        open={resumeModalOpen}
        job={pendingJob}
        onContinue={handleResumeExistingJob}
        onDiscard={() => {
          void handleDiscardExistingJob();
        }}
        isDiscarding={isClearingJob}
      />
      <section className="card" style={{ marginTop: 16 }} aria-hidden={resumeModalOpen}>
        <div className="container">
        <header style={{ marginBottom: 16 }}>
          <div className="section-header">
            <div>
              <h2 className="section-title">Tell us about the issue</h2>
              <p className="section-sub">We’ll use your answers to draft clarifying questions before the deep research step.</p>
            </div>
            <div className="header-actions">
              <span className="badge">Step {Math.min(currentStepNumber, totalSteps)} of {totalSteps}</span>
              <div className={creditClassName} role="status" aria-live="polite" aria-label={creditAriaLabel}>
                <svg
                  className="credit-balance__icon"
                  viewBox="0 0 24 24"
                  aria-hidden
                  focusable="false"
                >
                  <path
                    d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z"
                    fill="currentColor"
                    opacity="0.25"
                  />
                  <path
                    d="M12 6v12m0-6h2.25a1.5 1.5 0 100-3H9.75a1.5 1.5 0 110-3H15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="credit-balance__content">
                  <span className="credit-balance__label">Credits</span>
                  <span className="credit-balance__value">{creditDisplayValue}</span>
                </div>
              </div>
            </div>
          </div>
          <div aria-hidden style={{ marginTop: 8, height: 6, background: '#e5e7eb', borderRadius: 999 }}>
            <div style={{ width: `${Math.min(progress, 100)}%`, height: '100%', background: '#2563eb', borderRadius: 999 }} />
          </div>
        </header>

        {jobSaveError && (
          <div className="status" aria-live="polite" style={{ marginBottom: 16 }}>
            <p style={{ color: '#b45309' }}>{jobSaveError}</p>
          </div>
        )}

        {phase === 'initial' && currentStep && (
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void handleInitialNext(); }}>
            <div className="field">
              <label htmlFor={`writing-step-${currentStep.key}`} className="label">{currentStep.title}</label>
              <p className="label-sub">{currentStep.description}</p>
              <textarea
                id={`writing-step-${currentStep.key}`}
                className="input"
                rows={6}
                value={form[currentStep.key]}
                onChange={(e) => handleInitialChange(e.target.value)}
                placeholder={currentStep.placeholder}
                aria-invalid={!!error && !form[currentStep.key].trim()}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="status" aria-live="assertive">
                <p style={{ color: '#b91c1c' }}>{error}</p>
              </div>
            )}

            {serverError && (
              <div className="status" aria-live="assertive">
                <p style={{ color: '#b91c1c' }}>{serverError}</p>
              </div>
            )}

            <div
              className="actions"
              style={{
                marginTop: 12,
                display: 'flex',
                gap: 12,
                justifyContent: stepIndex === 0 ? 'flex-end' : undefined,
              }}
            >
              {stepIndex > 0 && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={handleInitialBack}
                  disabled={loading}
                >
                  Back
                </button>
              )}
              <button
                type="submit"
                className="btn-primary"
                disabled={
                  loading
                  ||
                  (stepIndex === steps.length - 1
                    && followUps.length === 0
                    && availableCredits !== null
                    && availableCredits < followUpCreditCost)
                }
              >
                {loading
                  ? 'Thinking…'
                  : stepIndex === steps.length - 1
                    ? followUps.length > 0
                      ? 'Next'
                      : 'Generate follow-up questions'
                    : 'Next'}
              </button>
            </div>
            {stepIndex === steps.length - 1
              && followUps.length === 0
              && availableCredits !== null
              && availableCredits < followUpCreditCost && (
              <div className="status" aria-live="polite" style={{ marginTop: 8 }}>
                <p style={{ color: '#2563eb' }}>
                  Generating follow-up questions costs {formatCredits(followUpCreditCost)} credits. Please top up to continue.
                </p>
              </div>
            )}
          </form>
        )}

        {phase === 'generating' && (
          <div
            className="status"
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 0',
              textAlign: 'center',
              minHeight: 280,
            }}
          >
            <p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: '#2563eb' }}>{generatingMessage}</p>
          </div>
        )}

        {phase === 'followup' && followUps.length > 0 && (
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void handleFollowUpNext(); }}>
            <div className="field">
              <label htmlFor={`followup-${followUpIndex}`} className="label">Follow-up question {followUpIndex + 1} of {followUps.length}</label>
              <p className="label-sub">{followUps[followUpIndex]}</p>
              <textarea
                id={`followup-${followUpIndex}`}
                className="input"
                rows={5}
                value={followUpAnswers[followUpIndex] ?? ''}
                onChange={(e) => handleFollowUpChange(e.target.value)}
                placeholder="Type your answer here"
                aria-invalid={!!error && !(followUpAnswers[followUpIndex]?.trim?.())}
                disabled={loading}
              />
            </div>

            {notes && followUpIndex === 0 && (
              <div className="status" aria-live="polite">
                <p style={{ color: '#2563eb', fontStyle: 'italic' }}>{notes}</p>
              </div>
            )}

            {error && (
              <div className="status" aria-live="assertive">
                <p style={{ color: '#b91c1c' }}>{error}</p>
              </div>
            )}

            {serverError && (
              <div className="status" aria-live="assertive">
                <p style={{ color: '#b91c1c' }}>{serverError}</p>
              </div>
            )}

            <div className="actions" style={{ marginTop: 12, display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="btn-link"
                onClick={handleFollowUpBack}
                disabled={loading}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
                {loading ? 'Saving…' : followUpIndex === followUps.length - 1 ? 'Save answers' : 'Next'}
              </button>
            </div>
          </form>
        )}

        {phase === 'summary' && (
          <div className="result" aria-live="polite">
            <h3 className="section-title" style={{ fontSize: '1.25rem' }}>Initial summary captured</h3>
            <p className="section-sub">Thanks for all the information. When you’re ready, start the deep research and I’ll dig into the evidence.</p>

            {serverError && (
              <div className="status" aria-live="assertive" style={{ marginTop: 12 }}>
                <p style={{ color: '#b91c1c' }}>{serverError}</p>
              </div>
            )}

            <div className="card" style={{ padding: 16, marginTop: 16 }}>
              <h4 className="section-title" style={{ fontSize: '1rem' }}>Deep research evidence pack</h4>
              {!hasResearchContent && researchStatus !== 'running' && (
                <p style={{ marginTop: 8 }}>
                  Run deep research to gather cited evidence that supports your letter. We&apos;ll provide a structured
                  summary with sources you can reference directly.
                </p>
              )}
              {researchStatus === 'error' && researchError && (
                <div className="status" aria-live="assertive" style={{ marginTop: 12 }}>
                  <p style={{ color: '#b91c1c' }}>{researchError}</p>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startDeepResearch}
                  disabled={researchButtonDisabled}
                >
                  {researchButtonLabel}
                </button>
                {researchCreditState === 'low' && (
                  <p style={{ marginTop: 8, color: '#b91c1c' }}>
                    You need at least {formatCredits(deepResearchCreditCost)} credits to run deep research.
                  </p>
                )}
                {researchCreditState === 'loading' && (
                  <p style={{ marginTop: 8, color: '#2563eb' }}>Checking your available credits…</p>
                )}
              </div>
              {researchStatus === 'running' && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ color: '#2563eb', fontStyle: 'italic' }}>
                    Gathering evidence — this may take a couple of minutes.
                  </p>
                </div>
              )}
              {researchActivities.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h5 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>Latest activity</h5>
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    {researchActivities.map((activity) => (
                      <li key={activity.id} style={{ marginBottom: 4 }}>
                        {activity.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(hasResearchContent || researchStatus === 'running') && (
                <div style={{ marginTop: 12 }}>
                  <h5 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>Research notes</h5>
                  <div className="research-notes">
                    {researchContent ? (
                      <ReactMarkdown
                        skipHtml
                        components={{
                          a: ({ node, ...props }) => (
                            <a {...props} target="_blank" rel="noreferrer noopener" />
                          ),
                        }}
                      >
                        {researchContent}
                      </ReactMarkdown>
                    ) : (
                      <p className="research-notes__placeholder">Collecting evidence…</p>
                    )}
                  </div>
                </div>
              )}
              {researchResponseId && (
                <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#6b7280' }}>
                  Research reference ID: {researchResponseId}
                </p>
              )}
            </div>

            <div
              style={{
                marginTop: 12,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <button
                type="button"
                className="btn-link"
                onClick={() => setShowSummaryDetails((prev) => !prev)}
                disabled={loading}
              >
                {showSummaryDetails ? 'Hide previous steps' : 'Show previous steps'}
              </button>
              {responseId && !showSummaryDetails && (
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Reference ID: {responseId}</span>
              )}
            </div>

            {showSummaryDetails && (
              <>
                <div className="card" style={{ padding: 16, marginTop: 16 }}>
                  <h4 className="section-title" style={{ fontSize: '1rem' }}>What you told us</h4>
                  <div className="stack" style={{ marginTop: 12 }}>
                    {steps.map((step) => (
                      <div key={step.key} style={{ marginBottom: 16 }}>
                        <div>
                          <h5 style={{ margin: 0, fontWeight: 600, fontSize: '1rem' }}>{step.title}</h5>
                        </div>
                        <p style={{ margin: '6px 0 0 0' }}>{form[step.key]}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card" style={{ padding: 16, marginTop: 16 }}>
                  <h4 className="section-title" style={{ fontSize: '1rem' }}>Follow-up questions</h4>
                  {followUps.length > 0 ? (
                    <ol style={{ marginTop: 8, paddingLeft: 20 }}>
                      {followUps.map((q, idx) => (
                        <li key={idx} style={{ marginBottom: 12 }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: 12,
                            }}
                          >
                            <p style={{ marginBottom: 4 }}>{q}</p>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => handleEditFollowUpQuestion(idx)}
                              aria-label={`Edit answer for follow-up question ${idx + 1}`}
                              disabled={loading}
                            >
                              Edit answer
                            </button>
                          </div>
                          <p style={{ margin: 0, fontWeight: 600 }}>Your answer:</p>
                          <p style={{ margin: '4px 0 0 0' }}>{followUpAnswers[idx]}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p style={{ marginTop: 8 }}>No additional questions needed — we have enough detail for the next step.</p>
                  )}
                  {followUps.length > 0 && (
                    <div className="actions" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn-link"
                        onClick={handleRegenerateFollowUps}
                        disabled={loading}
                      >
                        Ask for new follow-up questions (costs {formatCredits(followUpCreditCost)} credits)
                      </button>
                    </div>
                  )}
                  {notes && <p style={{ marginTop: 8, fontStyle: 'italic' }}>{notes}</p>}
                  {responseId && (
                    <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#6b7280' }}>Reference ID: {responseId}</p>
                  )}
                </div>
              </>
            )}

            <div
              className="actions"
              style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setStartOverConfirmOpen(true)}
                disabled={loading}
              >
                Start again
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditIntakeModalOpen(true)}
                disabled={loading}
              >
                Edit intake answers
              </button>
              {followUps.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleEditFollowUpQuestion(0)}
                  disabled={loading}
                >
                  Review follow-up answers
                </button>
              )}
              <button type="button" className="btn-primary" disabled={loading}>
                Create my letter
              </button>
            </div>
          </div>
        )}
      </div>
      </section>
    </>
  );
}
