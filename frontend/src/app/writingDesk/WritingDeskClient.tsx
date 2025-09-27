"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ActiveJobResumeModal from '../../features/writing-desk/components/ActiveJobResumeModal';
import EditIntakeConfirmModal from '../../features/writing-desk/components/EditIntakeConfirmModal';
import StartOverConfirmModal from '../../features/writing-desk/components/StartOverConfirmModal';
import { useActiveWritingDeskJob } from '../../features/writing-desk/hooks/useActiveWritingDeskJob';
import {
  ActiveWritingDeskJob,
  UpsertActiveWritingDeskJobPayload,
  WritingDeskResearchState,
  WritingDeskResearchActivity,
} from '../../features/writing-desk/types';

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

export default function WritingDeskClient() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [phase, setPhase] = useState<'initial' | 'generating' | 'followup' | 'summary' | 'research'>('initial');
  const [stepIndex, setStepIndex] = useState(0);
  const [followUpIndex, setFollowUpIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [research, setResearch] = useState<WritingDeskResearchState | null>(null);
  const [researchPolling, setResearchPolling] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
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

  const currentStep = phase === 'initial' ? steps[stepIndex] ?? null : null;
  const followUpCreditCost = 0.1;
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

  const totalFollowUpSteps = followUps.length > 0 ? followUps.length : 1;
  const includeResearchStep = useMemo(() => research !== null || phase === 'research', [research, phase]);
  const researchStepCompleted = useMemo(() => {
    if (!research) return false;
    return ['completed'].includes(research.status);
  }, [research]);
  const totalSteps = steps.length + totalFollowUpSteps + (includeResearchStep ? 1 : 0);
  const currentStepNumber = useMemo(() => {
    if (phase === 'initial') return stepIndex + 1;
    if (phase === 'generating') return steps.length;
    if (phase === 'followup') return steps.length + followUpIndex + 1;
    if (phase === 'research') {
      return steps.length + totalFollowUpSteps + 1;
    }
    return steps.length + totalFollowUpSteps + (includeResearchStep && researchStepCompleted ? 1 : 0);
  }, [phase, stepIndex, followUpIndex, totalFollowUpSteps, includeResearchStep, researchStepCompleted]);
  const completedSteps = useMemo(() => {
    if (phase === 'initial') return stepIndex;
    if (phase === 'generating') return steps.length;
    if (phase === 'followup') return steps.length + followUpIndex;
    if (phase === 'research') {
      return steps.length + totalFollowUpSteps + (researchStepCompleted ? 1 : 0);
    }
    return steps.length + totalFollowUpSteps + (includeResearchStep && researchStepCompleted ? 1 : 0);
  }, [phase, stepIndex, followUpIndex, totalFollowUpSteps, includeResearchStep, researchStepCompleted]);
  const progress = useMemo(() => {
    if (totalSteps === 0) return 0;
    if (phase === 'research' && research?.progress !== null && typeof research?.progress === 'number') {
      const base = (steps.length + totalFollowUpSteps) / totalSteps;
      const researchFraction = 1 / totalSteps;
      return Math.min(100, Math.max(0, (completedSteps / totalSteps) * 100 + research.progress * researchFraction));
    }
    return (completedSteps / totalSteps) * 100;
  }, [completedSteps, totalSteps, phase, research?.progress, steps.length, totalFollowUpSteps]);
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

  const generatingMessage = `Generating follow-up questions${'.'.repeat((ellipsisCount % 5) + 1)}`;

  const resetFollowUps = useCallback(() => {
    setFollowUps([]);
    setFollowUpAnswers([]);
    setFollowUpIndex(0);
    setNotes(null);
    setResponseId(null);
  }, []);

  const resetLocalState = useCallback(() => {
    setForm({ ...initialFormState });
    setPhase('initial');
    setStepIndex(0);
    setFollowUpIndex(0);
    setError(null);
    setServerError(null);
    setLoading(false);
    resetFollowUps();
    setResearch(null);
    setResearchError(null);
    setResearchPolling(false);
  }, [resetFollowUps]);

  const applySnapshot = useCallback(
    (job: ActiveWritingDeskJob) => {
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
      setResearch(job.research ?? null);
      setResearchError(null);
      setResearchPolling(false);
      setError(null);
      setServerError(null);
      setLoading(false);
      setJobSaveError(null);
    },
    [resetFollowUps],
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
      research: job.research ?? null,
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
      research: research ?? null,
    }),
    [followUpAnswers, followUpIndex, followUps, form, jobId, notes, phase, research, responseId, stepIndex],
  );

  const signatureForPayload = useCallback(
    (payload: UpsertActiveWritingDeskJobPayload, resolvedJobId?: string | null) =>
      JSON.stringify({
        ...payload,
        jobId: resolvedJobId ?? payload.jobId ?? null,
      }),
    [],
  );

  const updateFromJob = useCallback(
    (job: ActiveWritingDeskJob) => {
      applySnapshot(job);
      setJobId(job.jobId);
      const payload = resourceToPayload(job);
      lastPersistedRef.current = signatureForPayload(payload, job.jobId);
      setPersistenceEnabled(true);
      setJobSaveError(null);
    },
    [applySnapshot, resourceToPayload, signatureForPayload],
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
    updateFromJob(pendingJob);
    setResumeModalOpen(false);
    setPendingJob(null);
    setHasHandledInitialJob(true);
  }, [pendingJob, updateFromJob]);

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

  useEffect(() => {
    if (phase !== 'research') return;
    if (!jobId) return;
    if (!research || !research.responseId) return;
    if (['completed', 'failed', 'cancelled'].includes(research.status)) return;

    let cancelled = false;
    let timeout: ReturnType<typeof window.setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      setResearchPolling(true);
      try {
        const res = await fetch(`/api/ai/writing-desk/research/${jobId}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Request failed (${res.status})`);
        }
        const json = await res.json();
        const candidate = (json?.job ?? json) as Partial<ActiveWritingDeskJob> | null;
        const hasValidJobId =
          candidate && typeof candidate === 'object' && typeof candidate.jobId === 'string' && candidate.jobId.length > 0;
        if (hasValidJobId) {
          updateFromJob(candidate as ActiveWritingDeskJob);
        }
        const nextStatus =
          (hasValidJobId && candidate?.research?.status ? candidate.research.status : research.status) ?? research.status;
        if (!cancelled && !['completed', 'failed', 'cancelled'].includes(nextStatus ?? '')) {
          timeout = window.setTimeout(poll, 5000);
        }
        if (hasValidJobId && candidate?.research?.error) {
          setResearchError(candidate.research.error);
        }
      } catch (err: any) {
        if (!cancelled) {
          setResearchError(err?.message || 'Unable to refresh research status.');
        }
      } finally {
        if (!cancelled) {
          setResearchPolling(false);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, [jobId, phase, research, updateFromJob]);

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
      setResearch(null);
      setResearchError(null);
      setResearchPolling(false);

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
        research: null,
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
      setResearch(null);
      setResearchError(null);
      setResearchPolling(false);

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

  const handleStartResearch = useCallback(async () => {
    if (loading) return;
    const unanswered = followUps.some((_, idx) => !(followUpAnswers[idx]?.trim?.()));
    if (unanswered) {
      setServerError('Please answer all follow-up questions before continuing.');
      return;
    }

    setServerError(null);
    setResearchError(null);
    setResearchPolling(false);
    setLoading(true);

    try {
      const payload = {
        jobId: jobId ?? undefined,
        issueDetail: form.issueDetail.trim(),
        affectedDetail: form.affectedDetail.trim(),
        backgroundDetail: form.backgroundDetail.trim(),
        desiredOutcome: form.desiredOutcome.trim(),
        followUpQuestions: followUps.map((value) => value?.toString?.().trim?.() ?? ''),
        followUpAnswers: followUpAnswers.map((value) => value?.toString?.().trim?.() ?? ''),
        notes: notes ?? undefined,
        responseId: responseId ?? undefined,
      };

      const res = await fetch('/api/ai/writing-desk/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (json?.job) {
        updateFromJob(json.job as ActiveWritingDeskJob);
      }
      if (typeof json?.remainingCredits === 'number') {
        setAvailableCredits(Math.round(json.remainingCredits * 100) / 100);
      } else {
        const latestCredits = await refreshCredits();
        if (typeof latestCredits === 'number') {
          setAvailableCredits(latestCredits);
        }
      }
      setPhase('research');
    } catch (err: any) {
      setServerError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [followUpAnswers, followUps, form, jobId, loading, notes, refreshCredits, responseId, updateFromJob]);

  const summaryCards = (
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
  );

  const researchProgressValue = useMemo(() => {
    if (typeof research?.progress === 'number' && !Number.isNaN(research.progress)) {
      return Math.max(0, Math.min(100, research.progress));
    }
    if (research && ['completed'].includes(research.status)) return 100;
    return research ? 0 : null;
  }, [research]);

  const researchStatusLabel = useMemo(() => {
    if (!research) return 'Preparing research…';
    if (research.status === 'completed') return 'Research ready';
    if (research.status === 'failed') return 'Research failed';
    if (research.status === 'cancelled') return 'Research cancelled';
    if (research.status === 'cancelling') return 'Research cancelling…';
    if (research.status === 'requires_action') return 'Research needs attention';
    return researchPolling ? 'Research in progress (updating…)' : 'Research in progress';
  }, [research, researchPolling]);

  const sortedResearchActivities = useMemo(() => {
    if (!research?.activities) return [] as WritingDeskResearchActivity[];
    return [...research.activities].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return aTime - bTime;
    });
  }, [research?.activities]);

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
            <p className="section-sub">We’ve generated some clarifying questions before moving on to research.</p>

            {serverError && (
              <div className="status" aria-live="assertive" style={{ marginTop: 12 }}>
                <p style={{ color: '#b91c1c' }}>{serverError}</p>
              </div>
            )}

            {summaryCards}

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleStartResearch}
                  disabled={loading}
                >
                  Create my letter
                </button>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
                  We’ll run deep research next (costs 0.7 credits).
                </p>
              </div>
            </div>
          </div>
        )}

        {phase === 'research' && (
          <div className="result" aria-live="polite">
            <h3 className="section-title" style={{ fontSize: '1.25rem' }}>{researchStatusLabel}</h3>
            <p className="section-sub">
              We’re gathering evidence and citations to help you draft a fully referenced letter.
            </p>

            {serverError && (
              <div className="status" aria-live="assertive" style={{ marginTop: 12 }}>
                <p style={{ color: '#b91c1c' }}>{serverError}</p>
              </div>
            )}

            {researchError && (
              <div className="status" aria-live="polite" style={{ marginTop: 12 }}>
                <p style={{ color: '#b45309' }}>{researchError}</p>
              </div>
            )}

            <div className="card" style={{ padding: 16, marginTop: 16 }}>
              <h4 className="section-title" style={{ fontSize: '1rem', marginBottom: 8 }}>Progress</h4>
              <div style={{ height: 12, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(Math.max(researchProgressValue ?? 0, 0), 100)}%`,
                    height: '100%',
                    background: '#2563eb',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <p style={{ marginTop: 12, marginBottom: 0 }}>
                {researchProgressValue === null ? 'Waiting for updates…' : `${Math.round(researchProgressValue)}% complete`}
              </p>
            </div>

            <div className="card" style={{ padding: 16, marginTop: 16 }}>
              <h4 className="section-title" style={{ fontSize: '1rem' }}>Activity feed</h4>
              {sortedResearchActivities.length > 0 ? (
                <ol style={{ marginTop: 12, paddingLeft: 20 }}>
                  {sortedResearchActivities.map((activity) => {
                    const timestamp = new Date(activity.createdAt);
                    const label = activity.label || activity.type;
                    return (
                      <li key={activity.id} style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                          {Number.isNaN(timestamp.getTime())
                            ? activity.status
                            : `${timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${activity.status}`}
                        </div>
                        {activity.url && (
                          <div>
                            <a href={activity.url} target="_blank" rel="noreferrer" className="btn-link">
                              View source
                            </a>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p style={{ marginTop: 8 }}>We’ll list each web search and analysis step here as it happens.</p>
              )}
            </div>

            {research?.status === 'completed' && (
              <div className="card" style={{ padding: 16, marginTop: 16 }}>
                <h4 className="section-title" style={{ fontSize: '1rem' }}>Raw research findings</h4>
                <div style={{ marginTop: 12, maxHeight: 360, overflow: 'auto', background: '#f9fafb', padding: 12, borderRadius: 8 }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.95rem' }}>
                    {research.outputText || 'Research completed but no content was returned.'}
                  </pre>
                </div>
              </div>
            )}

            {(research?.status === 'failed' || research?.status === 'cancelled') && (
              <div className="status" aria-live="assertive" style={{ marginTop: 16 }}>
                <p style={{ color: '#b91c1c' }}>
                  {research?.error || 'The research run did not complete. You can try again when you’re ready.'}
                </p>
              </div>
            )}

            {summaryCards}

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleStartResearch}
                  disabled={loading}
                >
                  {research?.status === 'completed' ? 'Run research again' : 'Restart research'}
                </button>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
                  Each run costs 0.7 credits.
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
      </section>
    </>
  );
}
