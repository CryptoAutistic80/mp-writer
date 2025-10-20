"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import ActiveJobResumeModal from '../../features/writing-desk/components/ActiveJobResumeModal';
import EditIntakeConfirmModal from '../../features/writing-desk/components/EditIntakeConfirmModal';
import StartOverConfirmModal from '../../features/writing-desk/components/StartOverConfirmModal';
import RecomposeConfirmModal from '../../features/writing-desk/components/RecomposeConfirmModal';
import ResearchConfirmModal from '../../features/writing-desk/components/ResearchConfirmModal';
import FollowUpsConfirmModal from '../../features/writing-desk/components/FollowUpsConfirmModal';
import ExitWritingDeskModal from '../../features/writing-desk/components/ExitWritingDeskModal';
import { useActiveWritingDeskJob } from '../../features/writing-desk/hooks/useActiveWritingDeskJob';
import {
  ActiveWritingDeskJob,
  UpsertActiveWritingDeskJobPayload,
  WritingDeskLetterPayload,
  WritingDeskLetterStatus,
  WritingDeskLetterTone,
  WRITING_DESK_LETTER_TONES,
} from '../../features/writing-desk/types';
import { fetchSavedLetters, saveLetter, startLetterComposition } from '../../features/writing-desk/api/letter';
import { composeLetterHtml, letterHtmlToPlainText } from '../../features/writing-desk/utils/composeLetterHtml';
import { MicButton } from '../../components/audio/MicButton';
import { Toast } from '../../components/Toast';

type StepKey = 'issueDescription';

type FormState = Record<StepKey, string>;

const steps: Array<{
  key: StepKey;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: 'issueDescription',
    title: 'Describe your issue in as much detail as you can',
    description:
      'Share the full story, including who is affected, what has happened so far, and what you hope your MP can help achieve.',
    placeholder:
      'E.g. The heating in my flat has been broken since December. My children are getting sick, I have reported it twice, and I need the housing association to replace the boiler within two weeks…',
  },
];

const initialFormState: FormState = {
  issueDescription: '',
};

const LETTER_TONE_LABELS: Record<
  WritingDeskLetterTone,
  { label: string; description: string; icon: string }
> = {
  formal: {
    label: 'Formal',
    description: 'Traditional parliamentary tone: respectful, precise, and structured.',
    icon: '🏛️',
  },
  polite_but_firm: {
    label: 'Polite but firm',
    description: 'Courteous but clear about expectations and urgency.',
    icon: '🤝',
  },
  empathetic: {
    label: 'Empathetic',
    description: 'Centres the human impact with warmth and compassion.',
    icon: '💗',
  },
  urgent: {
    label: 'Urgent',
    description: 'Direct and time-sensitive while remaining respectful.',
    icon: '⏰',
  },
  neutral: {
    label: 'Neutral',
    description: 'Calm, factual tone that lets the evidence speak for itself.',
    icon: '📄',
  },
  highly_persuasive: {
    label: 'Highly persuasive',
    description: 'Confident, evidence-led case designed to motivate decisive action.',
    icon: '🎯',
  },
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
const MAX_LETTER_REASONING_ITEMS = 3;

type LetterStreamMessage =
  | { type: 'status'; status: string; remainingCredits?: number | null }
  | { type: 'event'; event: { type?: string; [key: string]: any } }
  | { type: 'delta'; text: string }
  | { type: 'letter_delta'; html: string }
  | { type: 'complete'; letter: WritingDeskLetterPayload; remainingCredits: number | null }
  | { type: 'error'; message: string; remainingCredits?: number | null };

const LETTER_DOCUMENT_CSS = `
  @page {
    margin: 15mm;
  }

  body {
    font-family: "Times New Roman", serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #111827;
    margin: 0;
    background: #ffffff;
  }

  .letter-document {
    box-sizing: border-box;
    max-width: 180mm;
    margin: 0 auto;
    padding: 15mm;
  }

  .letter-document p {
    margin: 0 0 12pt 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .letter-document ul,
  .letter-document ol {
    margin: 0 0 12pt 20pt;
    padding: 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .letter-document li {
    margin: 0 0 6pt 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .letter-document a {
    color: #1d4ed8;
    text-decoration: underline;
    word-break: break-word;
  }
`;

const createLetterRunId = () => {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const extractReasoningSummary = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const summary = extractReasoningSummary(item);
      if (summary) return summary;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      'summary',
      'text',
      'message',
      'content',
      'output_text',
      'value',
      'delta',
    ];

    for (const key of preferredKeys) {
      if (key in record) {
        const summary = extractReasoningSummary(record[key]);
        if (summary) return summary;
      }
    }

    for (const item of Object.values(record)) {
      const summary = extractReasoningSummary(item);
      if (summary) return summary;
    }
  }

  return null;
};

const describeResearchEvent = (event: { type?: string; [key: string]: any }): string | null => {
  if (!event || typeof event.type !== 'string') return null;
  switch (event.type) {
    case 'response.web_search_call.searching':
      return 'Searching the web for relevant sources…';
    case 'response.web_search_call.in_progress':
      return 'Reviewing a web result…';
    case 'response.web_search_call.completed':
      return 'Finished reviewing a web result.';
    case 'response.file_search_call.searching':
      return 'Searching private documents for supporting evidence…';
    case 'response.file_search_call.completed':
      return 'Finished reviewing private documents.';
    case 'response.code_interpreter_call.in_progress':
      return 'Analysing data with the code interpreter…';
    case 'response.code_interpreter_call.completed':
      return 'Completed data analysis via code interpreter.';
    case 'response.reasoning.delta': {
      const summary = extractReasoningSummary(event.delta ?? event);
      return summary ?? null;
    }
    case 'response.reasoning.done': {
      const summary = extractReasoningSummary(event.reasoning ?? event.delta ?? event);
      return summary ?? 'Reasoning summary updated.';
    }
    case 'response.reasoning_summary.delta':
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_summary_part.added':
      return null;
    case 'response.reasoning_summary.done':
    case 'response.reasoning_summary_text.done': {
      const summary = extractReasoningSummary(event.text ?? event.summary ?? event.delta ?? event);
      if (!summary) return null;
      const trimmed = summary.trim();
      return trimmed.length > 3 ? trimmed : null;
    }
    case 'response.reasoning_summary_part.done': {
      const summary = extractReasoningSummary(event.part ?? event);
      if (!summary) return null;
      const trimmed = summary.trim();
      return trimmed.length > 3 ? trimmed : null;
    }
    case 'resume_attempt': {
      // Handle our humorous resume attempt messages
      const message = event.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim();
      }
      return null;
    }
    case 'quiet_period': {
      // Handle quiet period status messages
      const message = event.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim();
      }
      return null;
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
  const router = useRouter();
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
  const [researchActivities, setResearchActivities] = useState<Array<{ id: string; text: string }>>([]);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [pendingAutoResume, setPendingAutoResume] = useState(false);
  const researchSourceRef = useRef<EventSource | null>(null);
  const previousPhaseRef = useRef<'initial' | 'generating' | 'followup' | 'summary' | null>(null);
  const lastResearchEventRef = useRef<number>(0);
  const lastResearchResumeAttemptRef = useRef<number>(0);
  const [letterStatus, setLetterStatus] = useState<WritingDeskLetterStatus>('idle');
  const [letterPhase, setLetterPhase] = useState<'idle' | 'tone' | 'streaming' | 'completed' | 'error'>('idle');
  const [selectedTone, setSelectedTone] = useState<WritingDeskLetterTone | null>(null);
  const [letterContentHtml, setLetterContentHtml] = useState<string>('');
  const [letterReferences, setLetterReferences] = useState<string[]>([]);
  const [letterResponseId, setLetterResponseId] = useState<string | null>(null);
  const [letterRawJson, setLetterRawJson] = useState<string | null>(null);
  const [letterError, setLetterError] = useState<string | null>(null);
  const [letterEvents, setLetterEvents] = useState<Array<{ id: string; text: string }>>([]);
  const [letterStatusMessage, setLetterStatusMessage] = useState<string | null>(null);
  const [letterCopyState, setLetterCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [letterRemainingCredits, setLetterRemainingCredits] = useState<number | null>(null);
  const [letterReasoningVisible, setLetterReasoningVisible] = useState(true);
  const [letterMetadata, setLetterMetadata] = useState<WritingDeskLetterPayload | null>(null);
  const [letterPendingAutoResume, setLetterPendingAutoResume] = useState(false);
  const [isSavingLetter, setIsSavingLetter] = useState(false);
  const [letterSaveError, setLetterSaveError] = useState<string | null>(null);
  const [savedLetterResponseId, setSavedLetterResponseId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [recomposeConfirmOpen, setRecomposeConfirmOpen] = useState(false);
  const [researchConfirmOpen, setResearchConfirmOpen] = useState(false);
  const [followUpsConfirmOpen, setFollowUpsConfirmOpen] = useState(false);
  const [initialFollowUpsConfirmOpen, setInitialFollowUpsConfirmOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const letterSourceRef = useRef<EventSource | null>(null);
  const letterJsonBufferRef = useRef<string>('');
  const lastLetterEventRef = useRef<number>(0);
  const lastLetterResumeAttemptRef = useRef<number>(0);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setToastMessage(null);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  const letterIsSaved = useMemo(
    () => !!(letterResponseId && savedLetterResponseId === letterResponseId),
    [letterResponseId, savedLetterResponseId],
  );

  useEffect(() => () => {
    clearToast();
  }, [clearToast]);

  useEffect(() => {
    const responseIds = [letterResponseId, letterMetadata?.responseId].filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    );
    if (!hasHandledInitialJob) return;
    if (!Array.isArray(responseIds) || responseIds.length === 0) return;
    const uniqueIds = Array.from(new Set(responseIds));

    let cancelled = false;

    (async () => {
      try {
        const existing = await fetchSavedLetters(uniqueIds);
        if (cancelled) return;
        const matched = existing.some((letter) => uniqueIds.includes(letter.responseId));
        if (matched) {
          setSavedLetterResponseId(letterResponseId ?? letterMetadata?.responseId ?? null);
        }
      } catch (error) {
        console.warn('Failed to verify saved letter state', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasHandledInitialJob, letterMetadata?.responseId, letterResponseId]);

  const letterHtmlForExport = useMemo(() => {
    if (typeof letterContentHtml !== 'string' || letterContentHtml.trim().length === 0) {
      return '<p>No content available.</p>';
    }
    return letterContentHtml;
  }, [letterContentHtml]);

  const letterDocumentBodyHtml = useMemo(
    () => `<div class="letter-document">${letterHtmlForExport}</div>`,
    [letterHtmlForExport],
  );

  const letterDocxHtml = useMemo(
    () =>
      `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
${LETTER_DOCUMENT_CSS}
</style>
</head>
<body>
${letterDocumentBodyHtml}
</body>
</html>`,
    [letterDocumentBodyHtml],
  );

  const resolveDownloadFilename = useCallback(
    (extension: 'pdf' | 'docx') => {
      const mpName =
        typeof letterMetadata?.mpName === 'string' ? letterMetadata.mpName.trim() : '';
      const dateValue =
        typeof letterMetadata?.date === 'string' && letterMetadata.date.trim().length > 0
          ? letterMetadata.date.trim()
          : new Date().toISOString().slice(0, 10);
      const baseParts = [mpName, dateValue].filter((part) => part.length > 0);
      const baseRaw = baseParts.join('-') || 'mp-letter';
      const slug = baseRaw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const safeBase = slug.length > 0 ? slug : 'mp-letter';
      return `${safeBase}.${extension}`;
    },
    [letterMetadata],
  );

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    if (typeof window === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }, []);

  const currentStep = phase === 'initial' ? steps[stepIndex] ?? null : null;
  const followUpCreditCost = 0.1;
  const deepResearchCreditCost = 0.7;
  const letterCreditCost = 0.2;
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

  const reportRefundedFailure = useCallback(
    async (context: string) => {
      const message = `Sorry, ${context}. If we spent any credits, we've already refunded them.`;
      showToast(message);
      const latest = await refreshCredits();
      if (typeof latest === 'number') {
        setAvailableCredits(latest);
        return latest;
      }
      return null;
    },
    [refreshCredits, showToast],
  );

  const closeResearchStream = useCallback(() => {
    if (researchSourceRef.current) {
      researchSourceRef.current.close();
      researchSourceRef.current = null;
    }
  }, []);

  const closeLetterStream = useCallback(() => {
    if (letterSourceRef.current) {
      letterSourceRef.current.close();
      letterSourceRef.current = null;
    }
  }, []);

  const resetLetter = useCallback(() => {
    closeLetterStream();
    setLetterStatus('idle');
    setLetterPhase('idle');
    setSelectedTone(null);
    setLetterContentHtml('');
    setLetterReferences([]);
    setLetterResponseId(null);
    setLetterRawJson(null);
    setLetterError(null);
    setLetterEvents([]);
    setLetterStatusMessage(null);
    setLetterCopyState('idle');
    setLetterRemainingCredits(null);
    setLetterReasoningVisible(true);
    setLetterMetadata(null);
    setLetterSaveError(null);
    setSavedLetterResponseId(null);
    setIsSavingLetter(false);
    clearToast();
    setRecomposeConfirmOpen(false);
    letterJsonBufferRef.current = '';
    setLetterPendingAutoResume(false);
  }, [clearToast, closeLetterStream]);

  const resetResearch = useCallback(() => {
    closeResearchStream();
    setResearchContent('');
    setResearchResponseId(null);
    setResearchStatus('idle');
    setResearchActivities([]);
    setResearchError(null);
    setPendingAutoResume(false);
  }, [closeResearchStream]);

  const appendResearchActivity = useCallback((text: string) => {
    setResearchActivities((prev) => {
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text };
      const next = [entry, ...prev];
      return next.slice(0, MAX_RESEARCH_ACTIVITY_ITEMS);
    });
  }, []);

  const appendLetterEvent = useCallback((text: string) => {
    setLetterEvents((prev) => {
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text };
      const next = [entry, ...prev];
      return next.slice(0, MAX_RESEARCH_ACTIVITY_ITEMS);
    });
  }, []);

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

  const visibleLetterEvents = useMemo(
    () => letterEvents.slice(0, MAX_LETTER_REASONING_ITEMS),
    [letterEvents],
  );

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
      : hasResearchContent 
      ? 'Run deep research again' 
      : 'Start deep research';

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

  useEffect(() => {
    return () => {
      closeLetterStream();
    };
  }, [closeLetterStream]);

  useEffect(() => {
    setLetterCopyState('idle');
  }, [letterContentHtml]);

  const generatingMessage = `Generating follow-up questions${'.'.repeat((ellipsisCount % 5) + 1)}`;

  const resetFollowUps = useCallback(() => {
    setFollowUps([]);
    setFollowUpAnswers([]);
    setFollowUpIndex(0);
    setNotes(null);
    setResponseId(null);
    resetResearch();
    resetLetter();
  }, [resetLetter, resetResearch]);

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
    resetLetter();
  }, [resetFollowUps, resetLetter]);

  const startDeepResearch = useCallback(
    async (options?: { resume?: boolean }) => {
      const resume = options?.resume === true;
      if (!resume && researchStatus === 'running') return;

      closeResearchStream();
      setPendingAutoResume(false);
      setResearchStatus('running');
      setResearchError(null);
      if (!resume) {
        setResearchContent('');
        setResearchResponseId(null);
        setResearchActivities([]);
      }

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

        const markResearchActivity = () => {
          lastResearchEventRef.current = Date.now();
        };

        source.onmessage = (event) => {
          let payload: DeepResearchStreamMessage | null = null;
          try {
            payload = JSON.parse(event.data) as DeepResearchStreamMessage;
          } catch {
            return;
          }
          if (!payload) return;

          markResearchActivity();

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
              setResearchContent((prev) => {
                // Clear activity feed when content starts streaming
                if (prev.length === 0) {
                  setResearchActivities([]);
                }
                return prev + payload.text;
              });
            }
          } else if (payload.type === 'event') {
            const descriptor = describeResearchEvent(payload.event);
            if (descriptor) appendResearchActivity(descriptor);
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
          void reportRefundedFailure('deep research ran into a problem');
        }
      };

      source.onerror = () => {
        closeResearchStream();
        setResearchStatus('error');
        setResearchError('The research stream was interrupted. Please try again.');
        appendResearchActivity('Connection lost during deep research.');
        setPendingAutoResume(false);
        void reportRefundedFailure('deep research connection dropped');
      };

        lastResearchEventRef.current = Date.now();
      } catch (err) {
        closeResearchStream();
        setResearchStatus('error');
      const message =
        err instanceof Error && err.message ? err.message : 'We could not start deep research. Please try again.';
      setResearchError(message);
      appendResearchActivity('Unable to start deep research.');
      setPendingAutoResume(false);
      void reportRefundedFailure('deep research could not start');
    }
  },
    [appendResearchActivity, closeResearchStream, jobId, reportRefundedFailure, researchStatus, updateCreditsFromStream],
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

  useEffect(() => {
    if (researchStatus !== 'running') return undefined;

    const interval = window.setInterval(() => {
      const source = researchSourceRef.current;
      if (!source) return;

      const now = Date.now();
      const lastEventAt = lastResearchEventRef.current || 0;
      if (now - lastEventAt < 45000) return;

      const lastAttemptAt = lastResearchResumeAttemptRef.current || 0;
      if (now - lastAttemptAt < 15000) return;

      lastResearchResumeAttemptRef.current = now;
      appendResearchActivity('Connection quiet — attempting to resume the research stream…');
      closeResearchStream();
      void startDeepResearch({ resume: true });
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [appendResearchActivity, closeResearchStream, researchStatus, startDeepResearch]);

  const openLetterStream = useCallback(
    (streamPath: string) => {
      closeLetterStream();
      setLetterStatus('generating');
      setLetterPhase('streaming');
      setLetterStatusMessage('Composing your letter…');
      setLetterError(null);
      setLetterContentHtml('');
      setLetterReferences([]);
      setLetterResponseId(null);
      setLetterRawJson(null);
      setLetterRemainingCredits(null);
      setLetterCopyState('idle');
      setLetterReasoningVisible(true);
      setLetterMetadata(null);
      setLetterSaveError(null);
      setIsSavingLetter(false);
      clearToast();
      letterJsonBufferRef.current = '';
      setLetterPendingAutoResume(false);
      let resolvedPath = streamPath;
      if (typeof window !== 'undefined') {
        try {
          const url = new URL(streamPath, window.location.origin);
          url.searchParams.set('runId', createLetterRunId());
          resolvedPath = url.toString();
        } catch {
          // ignore malformed paths and fall back to the provided value
        }
      }
      const source = new EventSource(resolvedPath, { withCredentials: true });
      letterSourceRef.current = source;

      const markLetterActivity = () => {
        lastLetterEventRef.current = Date.now();
      };

      source.onmessage = (event) => {
        markLetterActivity();
        let payload: LetterStreamMessage | null = null;
        try {
          payload = JSON.parse(event.data) as LetterStreamMessage;
        } catch {
          return;
        }
        if (!payload) return;

        if (payload.type === 'status') {
          setLetterStatusMessage(payload.status);
          updateCreditsFromStream(payload.remainingCredits);
          if (typeof payload.remainingCredits === 'number') {
            setLetterRemainingCredits(Math.round(payload.remainingCredits * 100) / 100);
          }
          return;
        }

        if (payload.type === 'event') {
          const summary = describeResearchEvent(payload.event);
          if (summary) {
            appendLetterEvent(summary);
          }
          return;
        }

        if (payload.type === 'delta') {
          if (typeof payload.text === 'string') {
            letterJsonBufferRef.current += payload.text;
            setLetterRawJson(letterJsonBufferRef.current);
          }
          return;
        }

        if (payload.type === 'letter_delta') {
          if (typeof payload.html === 'string') {
            setLetterContentHtml(payload.html);
            setLetterReasoningVisible(false);
          }
          return;
        }

        if (payload.type === 'complete') {
          updateCreditsFromStream(payload.remainingCredits);
          if (typeof payload.remainingCredits === 'number') {
            setLetterRemainingCredits(Math.round(payload.remainingCredits * 100) / 100);
          }
          setLetterReasoningVisible(false);
          setLetterStatus('completed');
          setLetterPhase('completed');
          setLetterStatusMessage('Letter ready');
          setIsSavingLetter(false);
          setLetterSaveError(null);
          clearToast();
          if (
            savedLetterResponseId &&
            payload.letter.responseId &&
            payload.letter.responseId !== savedLetterResponseId
          ) {
            setSavedLetterResponseId(null);
          }
          // Don't overwrite letterContentHtml - it should already contain the final HTML from letter_delta events
          setLetterReferences(payload.letter.references ?? []);
          setLetterResponseId(payload.letter.responseId ?? null);
          setLetterRawJson(payload.letter.rawJson ?? null);
          setSelectedTone(payload.letter.tone ?? null);
          setLetterMetadata(payload.letter);
          letterJsonBufferRef.current = payload.letter.rawJson ?? '';
          setLetterError(null);
          closeLetterStream();
          return;
        }

        if (payload.type === 'error') {
          updateCreditsFromStream(payload.remainingCredits);
          if (typeof payload.remainingCredits === 'number') {
            setLetterRemainingCredits(Math.round(payload.remainingCredits * 100) / 100);
          }
          setLetterStatus('error');
          setLetterPhase('error');
          setLetterError(payload.message);
          setLetterStatusMessage(null);
          setLetterMetadata(null);
          setIsSavingLetter(false);
          setLetterSaveError(null);
          clearToast();
          closeLetterStream();
          void reportRefundedFailure('letter composition ran into a problem').then((latest) => {
            if (typeof latest === 'number') {
              setLetterRemainingCredits(Math.round(latest * 100) / 100);
            }
          });
        }
      };

      source.onerror = () => {
        closeLetterStream();
        setLetterStatus('error');
        setLetterPhase('error');
        setLetterError('The letter stream disconnected. Please try again.');
        setLetterStatusMessage(null);
        setIsSavingLetter(false);
        setLetterSaveError(null);
        clearToast();
        void reportRefundedFailure('letter composition connection dropped').then((latest) => {
          if (typeof latest === 'number') {
            setLetterRemainingCredits(Math.round(latest * 100) / 100);
          }
        });
      };

      lastLetterEventRef.current = Date.now();
  },
    [
      appendLetterEvent,
      clearToast,
      closeLetterStream,
      reportRefundedFailure,
      savedLetterResponseId,
      setLetterMetadata,
      setLetterSaveError,
      setSavedLetterResponseId,
      updateCreditsFromStream,
    ],
  );

  const beginLetterComposition = useCallback(
    async (tone: WritingDeskLetterTone) => {
      setLetterStatus('generating');
      setLetterPhase('streaming');
      setLetterStatusMessage('Preparing your letter request…');
      setLetterError(null);
      setSelectedTone(tone);
      setLetterEvents([]);
      setLetterCopyState('idle');
      setLetterRemainingCredits(null);
      setLetterReasoningVisible(true);
      letterJsonBufferRef.current = '';
      setSavedLetterResponseId(null);
      setLetterSaveError(null);
      setIsSavingLetter(false);
      clearToast();

      try {
        const handshake = await startLetterComposition({ jobId: jobId ?? undefined, tone });
        if (handshake?.jobId) {
          setJobId(handshake.jobId);
        }
        const url = new URL(handshake.streamPath, window.location.origin);
        if (!url.searchParams.has('jobId') && (jobId ?? handshake?.jobId)) {
          url.searchParams.set('jobId', (jobId ?? handshake.jobId) as string);
        }
        openLetterStream(url.toString());
      } catch (error: any) {
        setLetterStatus('error');
        setLetterPhase('error');
        setLetterError(error?.message || 'We could not start letter composition. Please try again.');
        setLetterStatusMessage(null);
        void reportRefundedFailure('letter composition could not start').then((latest) => {
          if (typeof latest === 'number') {
            setLetterRemainingCredits(Math.round(latest * 100) / 100);
          }
        });
      }
    },
    [clearToast, jobId, openLetterStream, reportRefundedFailure, setJobId],
  );

  const resumeLetterComposition = useCallback(async () => {
    setLetterPendingAutoResume(false);
    if (!selectedTone) {
      setLetterStatus('error');
      setLetterPhase('error');
      setLetterError('We could not resume letter composition. Start again when ready.');
      setLetterStatusMessage(null);
      return;
    }

    setLetterStatus('generating');
    setLetterPhase('streaming');
    setLetterStatusMessage('Reconnecting to your letter…');
    setLetterError(null);
    setLetterEvents([]);
    setLetterCopyState('idle');
    setLetterRemainingCredits(null);
    setLetterReasoningVisible(true);
    letterJsonBufferRef.current = '';
    setLetterSaveError(null);
    setIsSavingLetter(false);
    clearToast();

    try {
      const handshake = await startLetterComposition({
        jobId: jobId ?? undefined,
        tone: selectedTone,
        resume: true,
      });
      if (handshake?.jobId) {
        setJobId(handshake.jobId);
      }
      const url = new URL(handshake.streamPath, window.location.origin);
      if (!url.searchParams.has('jobId') && (jobId ?? handshake.jobId)) {
        url.searchParams.set('jobId', (jobId ?? handshake.jobId) as string);
      }
      openLetterStream(url.toString());
    } catch (error: any) {
      setLetterStatus('error');
      setLetterPhase('error');
      const message =
        error?.message && typeof error.message === 'string'
          ? error.message
          : 'We could not resume letter composition. Start again when ready.';
      setLetterError(message);
      setLetterStatusMessage(null);
      void reportRefundedFailure('letter composition could not resume').then((latest) => {
        if (typeof latest === 'number') {
          setLetterRemainingCredits(Math.round(latest * 100) / 100);
        }
      });
    }
  }, [clearToast, jobId, openLetterStream, reportRefundedFailure, selectedTone, setJobId]);

  useEffect(() => {
    if (!letterPendingAutoResume) return;
    if (!hasHandledInitialJob) return;
    if (letterSourceRef.current) {
      setLetterPendingAutoResume(false);
      return;
    }
    void resumeLetterComposition();
  }, [hasHandledInitialJob, letterPendingAutoResume, resumeLetterComposition]);

  useEffect(() => {
    if (letterStatus !== 'generating') return undefined;

    const interval = window.setInterval(() => {
      const source = letterSourceRef.current;
      if (!source) return;

      const now = Date.now();
      const lastEventAt = lastLetterEventRef.current || 0;
      if (now - lastEventAt < 45000) return;

      const lastAttemptAt = lastLetterResumeAttemptRef.current || 0;
      if (now - lastAttemptAt < 15000) return;

      lastLetterResumeAttemptRef.current = now;
      appendLetterEvent('Connection quiet — attempting to resume letter composition…');
      closeLetterStream();
      void resumeLetterComposition();
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [appendLetterEvent, closeLetterStream, letterStatus, resumeLetterComposition]);

  const applySnapshot = useCallback(
    (job: ActiveWritingDeskJob) => {
      closeResearchStream();
      setSavedLetterResponseId(null);
      setLetterSaveError(null);
      setIsSavingLetter(false);
      clearToast();
      setForm({
        issueDescription: job.form?.issueDescription ?? '',
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
      const nextLetterStatus = job.letterStatus ?? 'idle';
      setLetterStatus(nextLetterStatus);
      setSelectedTone(job.letterTone ?? null);
      setLetterReferences(Array.isArray(job.letterReferences) ? [...job.letterReferences] : []);
      setLetterResponseId(job.letterResponseId ?? null);
      setLetterRawJson(job.letterJson ?? null);
      letterJsonBufferRef.current = '';
      let resumeLetterHtml: string | null = null;
      if (job.letterJson) {
        try {
          const parsed = JSON.parse(job.letterJson) as Record<string, any>;
          const parsedReferences = Array.isArray(parsed.references) ? parsed.references : [];
          resumeLetterHtml = composeLetterHtml({
            mpName: parsed.mp_name ?? '',
            mpAddress1: parsed.mp_address_1 ?? '',
            mpAddress2: parsed.mp_address_2 ?? '',
            mpCity: parsed.mp_city ?? '',
            mpCounty: parsed.mp_county ?? '',
            mpPostcode: parsed.mp_postcode ?? '',
            date: parsed.date ?? '',
            letterContentHtml: parsed.letter_content ?? '',
            senderName: parsed.sender_name ?? '',
            senderAddress1: parsed.sender_address_1 ?? '',
            senderAddress2: parsed.sender_address_2 ?? '',
            senderAddress3: parsed.sender_address_3 ?? '',
            senderCity: parsed.sender_city ?? '',
            senderCounty: parsed.sender_county ?? '',
            senderPostcode: parsed.sender_postcode ?? '',
            senderTelephone: parsed.sender_phone ?? '',
            references: parsedReferences,
          });
          setLetterMetadata({
            mpName: parsed.mp_name ?? '',
            mpAddress1: parsed.mp_address_1 ?? '',
            mpAddress2: parsed.mp_address_2 ?? '',
            mpCity: parsed.mp_city ?? '',
            mpCounty: parsed.mp_county ?? '',
            mpPostcode: parsed.mp_postcode ?? '',
            date: parsed.date ?? '',
            letterContent: resumeLetterHtml ?? parsed.letter_content ?? '',
            senderName: parsed.sender_name ?? '',
            senderAddress1: parsed.sender_address_1 ?? '',
            senderAddress2: parsed.sender_address_2 ?? '',
            senderAddress3: parsed.sender_address_3 ?? '',
            senderCity: parsed.sender_city ?? '',
            senderCounty: parsed.sender_county ?? '',
            senderPostcode: parsed.sender_postcode ?? '',
            senderTelephone: parsed.sender_phone ?? '',
            references: parsedReferences,
            responseId: job.letterResponseId ?? null,
            tone: job.letterTone ?? null,
            rawJson: job.letterJson ?? '',
            subjectLineHtml: parsed.subject_line_html ?? '',
          });
        } catch {
          setLetterMetadata(null);
        }
      } else {
        setLetterMetadata(null);
      }
      const resolvedLetterContent =
        typeof job.letterContent === 'string' && job.letterContent.trim().length > 0
          ? job.letterContent
          : resumeLetterHtml ?? '';
      setLetterPendingAutoResume(false);

      if (nextLetterStatus === 'completed') {
        setLetterContentHtml(resolvedLetterContent);
        setLetterPhase('completed');
        setLetterError(null);
        setLetterStatusMessage(null);
        setLetterRemainingCredits(null);
        setLetterReasoningVisible(false);
      } else if (nextLetterStatus === 'generating') {
        setLetterContentHtml(resumeLetterHtml ?? '');
        setLetterPhase('streaming');
        setLetterError(null);
        setLetterStatusMessage('Composing your letter…');
        setLetterRemainingCredits(null);
        setLetterReasoningVisible(true);
        setLetterMetadata(null);
        setLetterEvents([]);
        setLetterCopyState('idle');
        setLetterPendingAutoResume(true);
      } else if (nextLetterStatus === 'error') {
        setLetterContentHtml(resolvedLetterContent);
        setLetterPhase('error');
        setLetterError('Letter drafting did not finish. Start again when ready.');
        setLetterReasoningVisible(true);
        setLetterMetadata(null);
        setLetterStatusMessage(null);
      } else {
        setLetterContentHtml(resolvedLetterContent);
        setLetterPhase('idle');
        setLetterError(null);
        setLetterStatusMessage(null);
        setLetterReasoningVisible(true);
        if (!job.letterJson) {
          setLetterMetadata(null);
        }
      }
    },
    [clearToast, closeResearchStream, resetFollowUps],
  );

  const resourceToPayload = useCallback(
    (job: ActiveWritingDeskJob): UpsertActiveWritingDeskJobPayload => ({
      jobId: job.jobId,
      phase: job.phase,
      stepIndex: job.stepIndex,
      followUpIndex: job.followUpIndex,
      form: {
        issueDescription: job.form?.issueDescription ?? '',
      },
      followUpQuestions: Array.isArray(job.followUpQuestions) ? [...job.followUpQuestions] : [],
      followUpAnswers: Array.isArray(job.followUpAnswers) ? [...job.followUpAnswers] : [],
      notes: job.notes ?? null,
      responseId: job.responseId ?? null,
      researchContent: job.researchContent ?? null,
      researchResponseId: job.researchResponseId ?? null,
      researchStatus: job.researchStatus ?? 'idle',
      letterStatus: job.letterStatus ?? 'idle',
      letterTone: job.letterTone ?? null,
      letterResponseId: job.letterResponseId ?? null,
      letterContent: job.letterContent ?? null,
      letterReferences: Array.isArray(job.letterReferences) ? [...job.letterReferences] : [],
      letterJson: job.letterJson ?? null,
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
      letterStatus,
      letterTone: selectedTone,
      letterResponseId: letterResponseId ?? null,
      letterContent: letterContentHtml || null,
      letterReferences,
      letterJson: letterRawJson,
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
      letterStatus,
      selectedTone,
      letterResponseId,
      letterContentHtml,
      letterReferences,
      letterRawJson,
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

  const handleTranscriptionComplete = useCallback((text: string) => {
    if (!currentStep) return;
    if (!persistenceEnabled) setPersistenceEnabled(true);
    setForm((prev) => ({ ...prev, [currentStep.key]: prev[currentStep.key] + (prev[currentStep.key] ? ' ' : '') + text }));
  }, [currentStep, persistenceEnabled]);

  const handleFollowUpTranscriptionComplete = useCallback((text: string) => {
    if (!persistenceEnabled) setPersistenceEnabled(true);
    setFollowUpAnswers((prev) => {
      const next = [...prev];
      next[followUpIndex] = next[followUpIndex] + (next[followUpIndex] ? ' ' : '') + text;
      return next;
    });
  }, [followUpIndex, persistenceEnabled]);

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
          issueDescription: form.issueDescription.trim(),
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
            issueDescription: form.issueDescription.trim(),
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
        const latestCredits = await reportRefundedFailure('follow-up question generation failed');
        if (latestCredits === null && previousCredits !== null) {
          setAvailableCredits(previousCredits);
        }
      } finally {
        setLoading(false);
      }
    },
    [availableCredits, followUpCreditCost, form, reportRefundedFailure, refreshCredits, submitBundle],
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

    // Show confirmation modal before generating initial follow-ups
    setInitialFollowUpsConfirmOpen(true);
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
    handleEditInitialStep('issueDescription');
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

  const handleConfirmInitialFollowUps = useCallback(() => {
    setInitialFollowUpsConfirmOpen(false);
    void generateFollowUps('initial');
  }, [generateFollowUps]);

  const handleCancelInitialFollowUps = useCallback(() => {
    setInitialFollowUpsConfirmOpen(false);
  }, []);

  const handleRequestRegenerateFollowUps = useCallback(() => {
    setFollowUpsConfirmOpen(true);
  }, []);

  const handleConfirmRegenerateFollowUps = useCallback(() => {
    setFollowUpsConfirmOpen(false);
    resetLetter();
    void generateFollowUps('summary');
  }, [generateFollowUps, resetLetter]);

  const handleCancelRegenerateFollowUps = useCallback(() => {
    setFollowUpsConfirmOpen(false);
  }, []);

  const handleShowToneSelection = useCallback(() => {
    if (letterStatus !== 'idle') {
      resetLetter();
    }
    setLetterPhase('tone');
    setLetterStatusMessage(null);
    setLetterError(null);
    setShowSummaryDetails(false);
  }, [letterStatus, resetLetter]);

  const handleToneSelect = useCallback(
    (tone: WritingDeskLetterTone) => {
      void beginLetterComposition(tone);
    },
    [beginLetterComposition],
  );

  const handleRequestRecompose = useCallback(() => {
    setRecomposeConfirmOpen(true);
  }, []);

  const handleConfirmRecompose = useCallback(() => {
    setRecomposeConfirmOpen(false);
    handleShowToneSelection();
  }, [handleShowToneSelection]);

  const handleCancelRecompose = useCallback(() => {
    setRecomposeConfirmOpen(false);
  }, []);

  const handleRequestExit = useCallback(() => {
    setExitConfirmOpen(true);
  }, []);

  const handleConfirmExit = useCallback(async () => {
    setExitConfirmOpen(false);
    try {
      await clearJob();
      router.push('/dashboard');
    } catch (error) {
      console.error('Failed to clear job:', error);
      // Still navigate even if clear fails
      router.push('/dashboard');
    }
  }, [clearJob, router]);

  const handleCancelExit = useCallback(() => {
    setExitConfirmOpen(false);
  }, []);

  const handleRequestResearch = useCallback(() => {
    setResearchConfirmOpen(true);
  }, []);

  const handleConfirmResearch = useCallback(() => {
    setResearchConfirmOpen(false);
    void startDeepResearch();
  }, [startDeepResearch]);

  const handleCancelResearch = useCallback(() => {
    setResearchConfirmOpen(false);
  }, []);

  const handleSaveLetter = useCallback(async () => {
    if (!letterMetadata || !letterContentHtml || !letterResponseId) {
      setLetterSaveError('Your letter is still preparing. Please wait a moment and try again.');
      return;
    }

    if (savedLetterResponseId && savedLetterResponseId === letterResponseId) {
      showToast('Letter already saved to My letters.');
      return;
    }

    const tone = (letterMetadata.tone ?? selectedTone ?? 'neutral') as WritingDeskLetterTone;
    const metadata: WritingDeskLetterPayload = {
      ...letterMetadata,
      tone,
      responseId: letterMetadata.responseId ?? letterResponseId,
    };

    setIsSavingLetter(true);
    setLetterSaveError(null);

    try {
      const saved = await saveLetter({
        responseId: letterResponseId,
        letterHtml: letterContentHtml,
        metadata,
      });
      setSavedLetterResponseId(saved.responseId || letterResponseId);
      showToast('Letter saved to My letters.');
    } catch (error: any) {
      const message =
        error?.message && typeof error.message === 'string' && error.message.trim().length > 0
          ? error.message
          : 'We could not save your letter. Please try again.';
      setLetterSaveError(message);
    } finally {
      setIsSavingLetter(false);
    }
  }, [
    letterContentHtml,
    letterMetadata,
    letterResponseId,
    saveLetter,
    savedLetterResponseId,
    selectedTone,
    showToast,
  ]);

  const handleCopyLetter = useCallback(async () => {
    if (!letterContentHtml) {
      setLetterCopyState('error');
      return;
    }
    try {
      if (typeof window !== 'undefined' && 'ClipboardItem' in window && navigator.clipboard && 'write' in navigator.clipboard) {
        const htmlBlob = new Blob([letterContentHtml], { type: 'text/html' });
        const plainText = letterHtmlToPlainText(letterContentHtml);
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        const item = new (window as any).ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
        await (navigator.clipboard as any).write([item]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(letterHtmlToPlainText(letterContentHtml));
      } else {
        throw new Error('Clipboard API not available');
      }
      setLetterCopyState('copied');
    } catch (error) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(letterHtmlToPlainText(letterContentHtml));
          setLetterCopyState('copied');
          return;
        }
      } catch {
        // ignore nested failure
      }
      setLetterCopyState('error');
    }
  }, [letterContentHtml]);

  const handleDownloadDocx = useCallback(async () => {
    if (isDownloadingDocx || typeof window === 'undefined') return;
    setIsDownloadingDocx(true);
    try {
      const htmlDocxModule = await import('html-docx-js/dist/html-docx.js');
      const htmlDocx = (htmlDocxModule.default ?? htmlDocxModule) as { asBlob: (input: string) => Blob };
      const blob = htmlDocx.asBlob(letterDocxHtml);
      triggerBlobDownload(blob, resolveDownloadFilename('docx'));
    } catch (error) {
      console.error('Failed to generate DOCX export', error);
    } finally {
      setIsDownloadingDocx(false);
    }
  }, [isDownloadingDocx, letterDocxHtml, resolveDownloadFilename, triggerBlobDownload]);

  const handleDownloadPdf = useCallback(async () => {
    if (isDownloadingPdf || typeof window === 'undefined') return;
    setIsDownloadingPdf(true);
    const container = document.createElement('div');
    let appended = false;
    try {
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '210mm';
      container.style.padding = '0';
      container.style.margin = '0';
      container.style.background = '#ffffff';
      container.style.zIndex = '-1';
      container.setAttribute('aria-hidden', 'true');
      container.innerHTML = `<style>${LETTER_DOCUMENT_CSS}</style>${letterDocumentBodyHtml}`;
      document.body.appendChild(container);
      appended = true;
      const target = container.querySelector('.letter-document') as HTMLElement | null;
      if (!target) {
        throw new Error('Unable to locate letter content for export');
      }
      const html2pdfModule = (await import('html2pdf.js')) as any;
      const html2pdf = html2pdfModule.default ?? html2pdfModule;
      await html2pdf()
        .set({
          margin: [15, 15, 15, 15],
          filename: resolveDownloadFilename('pdf'),
          pagebreak: { mode: ['css', 'legacy'] },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(target)
        .save();
    } catch (error) {
      console.error('Failed to generate PDF export', error);
    } finally {
      if (appended && container.parentNode) {
        container.parentNode.removeChild(container);
      }
      setIsDownloadingPdf(false);
    }
  }, [isDownloadingPdf, letterDocumentBodyHtml, resolveDownloadFilename]);

  return (
    <>
      <StartOverConfirmModal
        open={startOverConfirmOpen}
        onConfirm={handleConfirmStartOver}
        onCancel={handleCancelStartOver}
      />
      <RecomposeConfirmModal
        open={recomposeConfirmOpen}
        onConfirm={handleConfirmRecompose}
        onCancel={handleCancelRecompose}
        letterIsSaved={letterIsSaved}
      />
      <EditIntakeConfirmModal
        open={editIntakeModalOpen}
        creditCost={formatCredits(followUpCreditCost)}
        onConfirm={handleConfirmEditIntake}
        onCancel={handleCancelEditIntake}
      />
      <ResearchConfirmModal
        open={researchConfirmOpen}
        creditCost={formatCredits(deepResearchCreditCost)}
        isRerun={hasResearchContent}
        onConfirm={handleConfirmResearch}
        onCancel={handleCancelResearch}
      />
      <FollowUpsConfirmModal
        open={followUpsConfirmOpen}
        creditCost={formatCredits(followUpCreditCost)}
        onConfirm={handleConfirmRegenerateFollowUps}
        onCancel={handleCancelRegenerateFollowUps}
      />
      <FollowUpsConfirmModal
        open={initialFollowUpsConfirmOpen}
        creditCost={formatCredits(followUpCreditCost)}
        onConfirm={handleConfirmInitialFollowUps}
        onCancel={handleCancelInitialFollowUps}
        isInitialGeneration={true}
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
      <ExitWritingDeskModal
        open={exitConfirmOpen}
        onConfirm={handleConfirmExit}
        onCancel={handleCancelExit}
      />
      <section className="card" style={{ marginTop: 16 }} aria-hidden={resumeModalOpen}>
        <div className="container">
        <header style={{ marginBottom: 16 }}>
          <div className="section-header">
            <div>
              <h2 className="section-title">Tell us about the issue</h2>
              <p className="section-sub">We’ll use your answers to draft clarifying questions before the fact-finding research step.</p>
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
              <div className="input-with-mic">
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
                <div className="input-mic-button">
                  <MicButton
                    onTranscriptionComplete={handleTranscriptionComplete}
                    disabled={loading}
                    size="sm"
                  />
                </div>
              </div>
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
              className={`actions${stepIndex === 0 ? ' actions--primary-only' : ''}`}
              style={{
                marginTop: 12,
                gap: 12,
                display: 'flex',
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
              <div className="input-with-mic">
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
                <div className="input-mic-button">
                  <MicButton
                    onTranscriptionComplete={handleFollowUpTranscriptionComplete}
                    disabled={loading}
                    size="sm"
                  />
                </div>
              </div>
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
            {letterPhase === 'idle' && (
              <>
                <h3 className="section-title" style={{ fontSize: '1.25rem' }}>Initial summary captured</h3>
                <p className="section-sub">Thanks for all the information. When you’re ready, click the research button and I’ll dig into the evidence.</p>

                {serverError && (
                  <div className="status" aria-live="assertive" style={{ marginTop: 12 }}>
                    <p style={{ color: '#b91c1c' }}>{serverError}</p>
                  </div>
                )}

                <div className="card" style={{ padding: 16, marginTop: 16 }}>
                  <h4 className="section-title" style={{ fontSize: '1rem' }}>Research evidence</h4>
                  {!hasResearchContent && researchStatus !== 'running' && (
                    <p style={{ marginTop: 8 }}>
                      Run research to gather cited evidence that supports your letter. We&apos;ll use the research to craft the perfect impactful letter.
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
                      onClick={handleRequestResearch}
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
                    <div className="research-progress" role="status" aria-live="polite">
                      <span className="research-progress__spinner" aria-hidden="true" />
                      <div className="research-progress__content">
                        <p>
                          Gathering evidence — this may take several minutes, please be patient and have a cup of tea.
                        </p>
                        <p>We&apos;ll keep posting updates in the activity feed below while the research continues.</p>
                      </div>
                    </div>
                  )}
                  {researchStatus === 'running' && researchActivities.length > 0 && (
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
                    {showSummaryDetails ? 'Hide intake details' : 'Show intake details'}
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
                            onClick={handleRequestRegenerateFollowUps}
                            disabled={loading}
                          >
                            Ask for new follow-up questions
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
                    disabled={loading || researchStatus === 'running'}
                  >
                    Edit intake answers
                  </button>
                  {followUps.length > 0 && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleEditFollowUpQuestion(0)}
                      disabled={loading || researchStatus === 'running'}
                    >
                      Review follow-up answers
                    </button>
                  )}
                  {researchStatus === 'completed' && (
                    <button
                      type="button"
                      className="btn-primary create-letter-button"
                      onClick={handleShowToneSelection}
                      disabled={loading}
                    >
                      Create my letter (costs {formatCredits(letterCreditCost)} credits)
                    </button>
                  )}
                </div>
              </>
            )}

            {letterPhase === 'tone' && (
              <div className="card" style={{ padding: 16, marginTop: 16 }}>
                <h4 className="section-title" style={{ fontSize: '1.1rem' }}>Choose a tone for your letter</h4>
                <p className="section-sub">
                  Pick the style you want the drafted MP letter to use. You can always compose another letter later in a different tone.
                </p>
                <div className="tone-grid">
                  {WRITING_DESK_LETTER_TONES.map((tone) => {
                    const toneInfo = LETTER_TONE_LABELS[tone];
                    return (
                      <button
                        key={tone}
                        type="button"
                        className="tone-option"
                        data-tone={tone}
                        onClick={() => handleToneSelect(tone)}
                      >
                        <span className="tone-option__badge" aria-hidden="true">
                          {toneInfo.icon}
                        </span>
                        <span className="tone-option__label">{toneInfo.label}</span>
                        <span className="tone-option__description">{toneInfo.description}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="actions" style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                  <button type="button" className="btn-secondary" onClick={() => setLetterPhase('idle')}>
                    Back to summary
                  </button>
                </div>
              </div>
            )}

            {letterPhase === 'streaming' && (
              <div className="card" style={{ padding: 16, marginTop: 16 }}>
                <h4 className="section-title" style={{ fontSize: '1.1rem' }}>Drafting your letter</h4>
                {letterStatus === 'generating' && letterStatusMessage && (
                  <div
                    className="research-progress"
                    role="status"
                    aria-live="polite"
                    style={{ marginTop: 16 }}
                  >
                    <span className="research-progress__spinner" aria-hidden="true" />
                    <div className="research-progress__content">
                      <p>{letterStatusMessage}</p>
                      <p>We’ll keep posting updates in the reasoning feed while the letter takes shape.</p>
                    </div>
                  </div>
                )}
                {letterReasoningVisible && (
                  <div style={{ marginTop: 16 }}>
                    <h5 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>Reasoning feed</h5>
                    {visibleLetterEvents.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {visibleLetterEvents.map((event) => (
                          <li key={event.id} style={{ marginBottom: 4 }}>{event.text}</li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, color: '#6b7280' }}>The assistant is planning the letter…</p>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  <h5 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>Letter preview</h5>
                  <div
                    className="letter-preview"
                    dangerouslySetInnerHTML={{ __html: letterContentHtml || '<p>Drafting the opening paragraph…</p>' }}
                  />
                </div>
              </div>
            )}

            {letterPhase === 'completed' && letterMetadata && (
              <div className="card" style={{ padding: 16, marginTop: 16 }}>
                <h4 className="section-title" style={{ fontSize: '1.1rem' }}>Your drafted letter</h4>
                <p className="section-sub">
                  Tone: {selectedTone ? LETTER_TONE_LABELS[selectedTone].label : 'Not specified'} · Date {letterMetadata.date || new Date().toISOString().slice(0, 10)}
                </p>
                {letterResponseId && (
                  <p style={{ marginTop: 4, fontSize: '0.85rem', color: '#6b7280' }}>Letter reference ID: {letterResponseId}</p>
                )}
                <div
                  className="letter-preview"
                  style={{ marginTop: 16 }}
                  dangerouslySetInnerHTML={{ __html: letterContentHtml || '<p>No content available.</p>' }}
                />
                <div className="actions" style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSaveLetter}
                    disabled={
                      isSavingLetter ||
                      !letterResponseId ||
                      !letterMetadata ||
                      !letterContentHtml ||
                      (savedLetterResponseId !== null && savedLetterResponseId === letterResponseId)
                    }
                    aria-busy={isSavingLetter}
                  >
                    {isSavingLetter
                      ? 'Saving…'
                      : savedLetterResponseId === letterResponseId
                        ? 'Saved to my letters'
                        : 'Save to my letters'}
                  </button>
                  <button
                    type="button"
                    className="cta-pill cta-pill--secondary writing-desk-my-letters-btn"
                    disabled={!(savedLetterResponseId !== null && savedLetterResponseId === letterResponseId)}
                  >
                    My Letters
                  </button>
                  <button type="button" className="btn-primary" onClick={handleCopyLetter}>
                    {letterCopyState === 'copied' ? 'Copied!' : letterCopyState === 'error' ? 'Copy failed — try again' : 'Copy for email'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleDownloadPdf}
                    disabled={isDownloadingPdf}
                    aria-busy={isDownloadingPdf}
                  >
                    {isDownloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleDownloadDocx}
                    disabled={isDownloadingDocx}
                    aria-busy={isDownloadingDocx}
                  >
                    {isDownloadingDocx ? 'Preparing DOCX...' : 'Download DOCX'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={handleRequestRecompose}>
                    Recompose this letter
                  </button>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={handleRequestExit}
                    style={{ 
                      backgroundColor: '#fee2e2', 
                      color: '#991b1b', 
                      border: '1px solid #fecaca' 
                    }}
                  >
                    Exit writing desk
                  </button>
                </div>
                {letterSaveError && (
                  <p role="alert" aria-live="polite" style={{ marginTop: 8, color: '#b91c1c' }}>
                    {letterSaveError}
                  </p>
                )}
                {toastMessage && <Toast>{toastMessage}</Toast>}
              </div>
            )}

            {letterPhase === 'error' && (
              <div className="card" style={{ padding: 16, marginTop: 16 }}>
                <h4 className="section-title" style={{ fontSize: '1.1rem', color: '#b91c1c' }}>We couldn&apos;t finish your letter</h4>
                {letterError && <p style={{ marginTop: 8 }}>{letterError}</p>}
                <div className="actions" style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                  <button type="button" className="btn-primary" onClick={handleShowToneSelection}>
                    Try again
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setLetterPhase('idle')}>
                    Back to summary
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </section>
      <style>{`
        @keyframes create-letter-jiggle {
          0%, 100% {
            transform: translateX(0);
          }
          15% {
            transform: translateX(-2px) rotate(-1deg);
          }
          30% {
            transform: translateX(2px) rotate(1deg);
          }
          45% {
            transform: translateX(-2px) rotate(-1deg);
          }
          60% {
            transform: translateX(2px) rotate(1deg);
          }
          75% {
            transform: translateX(-1px) rotate(-0.5deg);
          }
        }

        .tone-grid {
          display: grid;
          gap: 16px;
          margin-top: 16px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        @media (max-width: 640px) {
          .tone-grid {
            grid-template-columns: 1fr;
          }

          .tone-option {
            padding: 16px;
          }
        }

        .tone-option {
          --tone-bg: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
          --tone-border: rgba(148, 163, 184, 0.4);
          --tone-heading: #0f172a;
          --tone-text: rgba(30, 41, 59, 0.82);
          --tone-badge-bg: rgba(15, 23, 42, 0.08);
          --tone-badge-fg: #0f172a;
          background: var(--tone-bg);
          border: 1px solid var(--tone-border);
          border-radius: 20px;
          color: var(--tone-text);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          font-family: inherit;
          line-height: 1.4;
          gap: 12px;
          -webkit-appearance: none;
          appearance: none;
          padding: 18px 20px;
          position: relative;
          text-align: left;
          transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }

        .tone-option::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.55), transparent 55%);
          opacity: 0;
          transition: opacity 160ms ease;
        }

        .tone-option:hover,
        .tone-option:focus-visible {
          transform: translateY(-2px);
          box-shadow: 0 16px 32px rgba(15, 23, 42, 0.16);
          border-color: transparent;
        }

        .tone-option:hover::after,
        .tone-option:focus-visible::after {
          opacity: 1;
        }

        .tone-option:focus-visible {
          outline: 3px solid rgba(59, 130, 246, 0.45);
          outline-offset: 2px;
        }

        .tone-option__badge {
          align-items: center;
          background: var(--tone-badge-bg);
          border-radius: 16px;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
          color: var(--tone-badge-fg);
          display: inline-flex;
          font-size: 1.75rem;
          height: 52px;
          justify-content: center;
          width: 52px;
        }

        .tone-option__label {
          color: var(--tone-heading);
          font-size: 1.05rem;
          font-weight: 600;
        }

        .tone-option__description {
          color: var(--tone-text);
          font-size: 0.9rem;
          line-height: 1.45;
        }

        .tone-option[data-tone='formal'] {
          --tone-bg: linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%);
          --tone-border: rgba(59, 130, 246, 0.35);
          --tone-heading: #1d4ed8;
          --tone-text: rgba(30, 64, 175, 0.88);
          --tone-badge-bg: rgba(37, 99, 235, 0.18);
          --tone-badge-fg: #1e3a8a;
        }

        .tone-option[data-tone='polite_but_firm'] {
          --tone-bg: linear-gradient(135deg, #fff7ed 0%, #fde68a 100%);
          --tone-border: rgba(217, 119, 6, 0.4);
          --tone-heading: #b45309;
          --tone-text: rgba(146, 64, 14, 0.9);
          --tone-badge-bg: rgba(180, 83, 9, 0.18);
          --tone-badge-fg: #9a3412;
        }

        .tone-option[data-tone='empathetic'] {
          --tone-bg: linear-gradient(135deg, #fdf2f8 0%, #ede9fe 100%);
          --tone-border: rgba(217, 70, 239, 0.35);
          --tone-heading: #a855f7;
          --tone-text: rgba(134, 25, 143, 0.86);
          --tone-badge-bg: rgba(168, 85, 247, 0.2);
          --tone-badge-fg: #7c3aed;
        }

        .tone-option[data-tone='urgent'] {
          --tone-bg: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
          --tone-border: rgba(248, 113, 113, 0.5);
          --tone-heading: #dc2626;
          --tone-text: rgba(153, 27, 27, 0.9);
          --tone-badge-bg: rgba(220, 38, 38, 0.22);
          --tone-badge-fg: #b91c1c;
        }

        .tone-option[data-tone='neutral'] {
          --tone-bg: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
          --tone-border: rgba(71, 85, 105, 0.35);
          --tone-heading: #334155;
          --tone-text: rgba(51, 65, 85, 0.88);
          --tone-badge-bg: rgba(71, 85, 105, 0.18);
          --tone-badge-fg: #1e293b;
        }

        .tone-option[data-tone='highly_persuasive'] {
          --tone-bg: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%);
          --tone-border: rgba(14, 165, 233, 0.38);
          --tone-heading: #0f766e;
          --tone-text: rgba(15, 118, 110, 0.9);
          --tone-badge-bg: rgba(13, 148, 136, 0.18);
          --tone-badge-fg: #115e59;
        }

        @media (prefers-reduced-motion: reduce) {
          .tone-option {
            transition: none;
          }

          .tone-option:hover,
          .tone-option:focus-visible {
            transform: none;
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
          }

          .tone-option::after {
            transition: none;
          }
        }

        .create-letter-button {
          animation: create-letter-jiggle 1.6s ease-in-out infinite;
        }

        .input-with-mic {
          position: relative;
          display: flex;
          align-items: flex-end;
          gap: 8px;
        }

        .input-with-mic .input {
          flex: 1;
          margin-bottom: 0;
        }

        .input-mic-button {
          flex-shrink: 0;
          margin-bottom: 8px;
        }

        .actions--primary-only {
          justify-content: flex-end;
        }

        @media (max-width: 640px) {
          .input-with-mic {
            display: block;
          }

          .input-with-mic .input {
            width: 100%;
            padding-right: 72px;
            padding-bottom: 72px;
          }

          .input-mic-button {
            position: absolute;
            right: 16px;
            bottom: 16px;
            transform: none;
            margin: 0;
          }

          .input-mic-button :global(.mic-button-container) {
            align-items: flex-end;
          }

          .input-mic-button :global(.mic-button__error) {
            margin-top: 8px;
            text-align: right;
            max-width: min(220px, 70vw);
          }

          .actions--primary-only {
            justify-content: center;
          }
        }
      `}</style>
    </>
  );
}
