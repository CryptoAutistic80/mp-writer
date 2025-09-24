'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FollowupQuestion,
  Letter,
  LetterReference,
} from '@mp-writer/api-types';
import DeepResearchProgress from '../../components/DeepResearchProgress';

const QUESTIONS: { id: string; prompt: string }[] = [
  { id: 'who', prompt: 'Who is most affected by this issue?' },
  { id: 'details', prompt: 'What background or context should your MP know?' },
  { id: 'action', prompt: 'What action would you like your MP to take?' },
];

const TONES: { id: string; label: string; description: string }[] = [
  {
    id: 'formal',
    label: 'Formal',
    description: 'Polite and professional with clear respect.',
  },
  {
    id: 'neutral',
    label: 'Neutral',
    description: 'Factual, calm and to the point.',
  },
  {
    id: 'friendly',
    label: 'Friendly',
    description: 'Warm and conversational while staying respectful.',
  },
  {
    id: 'urgent',
    label: 'Urgent',
    description: 'Passionate and time-sensitive but still courteous.',
  },
];

type Phase = 'issue' | 'questions' | 'followups' | 'tone' | 'review' | 'result';

type UserContext = {
  mpName: string;
  mpEmail: string;
  constituency: string;
  credits: number;
  userName: string;
  addressLine: string;
};

type FollowupAnswerRecord = Record<string, string>;

type ResearchPromptState = 'idle' | 'loading' | 'ready' | 'error';

type FollowupState = 'idle' | 'loading' | 'ready' | 'skipped' | 'error';

export default function WritingDeskClient() {
  const [phase, setPhase] = useState<Phase>('issue');
  const [issue, setIssue] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [tone, setTone] = useState<string>('formal');
  const [followupQuestions, setFollowupQuestions] = useState<
    FollowupQuestion[]
  >([]);
  const [followupIndex, setFollowupIndex] = useState(0);
  const [followupAnswers, setFollowupAnswers] = useState<FollowupAnswerRecord>(
    {}
  );
  const [followupState, setFollowupState] = useState<FollowupState>('idle');
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [researchPrompt, setResearchPrompt] = useState<string>('');
  const [researchPromptState, setResearchPromptState] =
    useState<ResearchPromptState>('idle');
  const [structuredLetter, setStructuredLetter] = useState<Letter | null>(null);
  const [researchSummary, setResearchSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [context, setContext] = useState<UserContext | null>(null);
  const [contextMessage, setContextMessage] = useState<string>(
    'Loading your saved details…'
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, mpRes, addressRes] = await Promise.all([
          fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/user/mp', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/user/address', {
            credentials: 'include',
            cache: 'no-store',
          }),
        ]);

        if (!meRes.ok) {
          const message =
            meRes.status === 401
              ? 'Please sign in to continue.'
              : 'We could not load your profile details.';
          if (!cancelled) {
            setContextMessage(message);
          }
          return;
        }

        const me = await meRes.json();
        const mp = mpRes.ok ? await mpRes.json() : null;
        const addressDoc = addressRes.ok ? await addressRes.json() : null;
        const name = (me?.name as string | undefined) || '';
        const mpName =
          mp?.mp?.name || mp?.mp?.fullName || mp?.mp?.displayName || '';
        const mpEmail = mp?.mp?.email || '';
        const constituency = mp?.constituency || '';
        const address = addressDoc?.address;
        const addressLine = address
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
          : '';

        if (!cancelled) {
          setContext({
            mpName,
            mpEmail,
            constituency,
            userName: name,
            credits: Number(me?.credits ?? 0),
            addressLine,
          });
          setContextMessage('');
        }
      } catch (err) {
        if (!cancelled)
          setContextMessage('We could not load your saved details.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  const remainingCredits = context?.credits ?? 0;

  useEffect(() => {
    if (!context) return;
    if (!context.mpName || !context.addressLine) {
      setContextMessage(
        'Please return to the dashboard to confirm your MP and address before generating a letter.'
      );
    }
  }, [context]);

  const currentQuestion = useMemo(
    () => QUESTIONS[questionIndex],
    [questionIndex]
  );
  const currentFollowup = useMemo(
    () => followupQuestions[followupIndex],
    [followupIndex, followupQuestions]
  );

  function buildBaseAnswers() {
    return QUESTIONS.map((question) => ({
      questionId: question.id,
      prompt: question.prompt,
      answer: answers[question.id]?.trim() || 'Not specified.',
    }));
  }

  function buildFollowupAnswerArray() {
    return followupQuestions.map((question) => ({
      questionId: question.id,
      answer: followupAnswers[question.id]?.trim() || 'Not specified.',
    }));
  }

  function handleIssueSubmit(event: FormEvent) {
    event.preventDefault();
    if (!issue.trim()) {
      setError('Please describe the issue you want to raise.');
      return;
    }
    setError(null);
    setNotice(null);
    setPhase('questions');
  }

  function handleQuestionSubmit(event: FormEvent) {
    event.preventDefault();
    if (!currentQuestion) {
      setPhase('tone');
      return;
    }
    const answer = answers[currentQuestion.id]?.trim();
    if (!answer) {
      setError('Please add a short answer or choose Skip.');
      return;
    }
    setError(null);
    setNotice(null);
    advanceQuestion();
  }

  async function advanceQuestion() {
    if (questionIndex + 1 >= QUESTIONS.length) {
      await loadFollowupQuestions();
      return;
    }
    setQuestionIndex((prev) => prev + 1);
  }

  function skipQuestion() {
    setError(null);
    setNotice(null);
    if (currentQuestion) {
      setAnswers((prev) => ({
        ...prev,
        [currentQuestion.id]: prev[currentQuestion.id] ?? 'Not specified.',
      }));
    }
    advanceQuestion().catch(() => undefined);
  }

  async function loadFollowupQuestions() {
    if (!issue.trim()) {
      setPhase('tone');
      return;
    }

    setFollowupState('loading');
    setFollowupError(null);
    try {
      const res = await fetch('/api/ai/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          issueSummary: issue.trim(),
          baseAnswers: buildBaseAnswers(),
        }),
      });

      if (!res.ok) {
        throw new Error('Unable to retrieve follow-up questions.');
      }

      const data = await res.json();
      const questions: FollowupQuestion[] = Array.isArray(data?.questions)
        ? data.questions
        : [];
      if (!questions.length) {
        setFollowupQuestions([]);
        setFollowupState('skipped');
        setPhase('tone');
        return;
      }

      setFollowupQuestions(questions);
      setFollowupAnswers({});
      setFollowupIndex(0);
      setFollowupState('ready');
      setPhase('followups');
    } catch (err) {
      setFollowupState('error');
      setFollowupError(
        'We could not generate follow-up questions. You can continue without them.'
      );
      setFollowupQuestions([]);
      setPhase('tone');
    }
  }

  function handleFollowupSubmit(event: FormEvent) {
    event.preventDefault();
    if (!currentFollowup) {
      setPhase('tone');
      return;
    }
    const answer = followupAnswers[currentFollowup.id]?.trim();
    if (!answer) {
      setError('Please add a short answer or choose Skip.');
      return;
    }
    setError(null);
    setNotice(null);
    advanceFollowup();
  }

  function advanceFollowup() {
    if (followupIndex + 1 >= followupQuestions.length) {
      setPhase('tone');
      return;
    }
    setFollowupIndex((prev) => prev + 1);
  }

  function skipFollowup() {
    setError(null);
    setNotice(null);
    if (currentFollowup) {
      setFollowupAnswers((prev) => ({
        ...prev,
        [currentFollowup.id]: prev[currentFollowup.id] ?? 'Not specified.',
      }));
    }
    advanceFollowup();
  }

  function backToPrevious() {
    setError(null);
    setNotice(null);
    if (phase === 'questions') {
      if (questionIndex === 0) {
        setPhase('issue');
      } else {
        setQuestionIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }

    if (phase === 'followups') {
      if (followupIndex === 0) {
        setPhase('questions');
      } else {
        setFollowupIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }

    if (phase === 'tone') {
      if (followupQuestions.length) {
        setPhase('followups');
      } else {
        setPhase('questions');
        setQuestionIndex(Math.max(QUESTIONS.length - 1, 0));
      }
      return;
    }

    if (phase === 'review') {
      setPhase('tone');
      return;
    }

    if (phase === 'result') {
      setPhase('review');
    }
  }

  async function ensureResearchPrompt() {
    if (researchPromptState === 'loading') {
      return false;
    }

    if (researchPrompt && researchPromptState === 'ready') {
      return true;
    }

    return refreshResearchPrompt();
  }

  async function refreshResearchPrompt() {
    if (!issue.trim()) {
      setError('Please describe your issue before generating a research plan.');
      return false;
    }

    setResearchPromptState('loading');
    setError(null);
    try {
      const res = await fetch('/api/ai/research-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          issueSummary: issue.trim(),
          baseAnswers: buildBaseAnswers(),
          followupAnswers: buildFollowupAnswerArray(),
          tone,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate research prompt.');
      }

      const data = await res.json();
      setResearchPrompt(data?.prompt ?? '');
      setResearchPromptState('ready');
      return true;
    } catch (err) {
      setResearchPromptState('error');
      setError('We could not generate the research plan. Please try again.');
      return false;
    }
  }

  async function goToReview() {
    const ready = await ensureResearchPrompt();
    if (!ready) {
      return;
    }
    setError(null);
    setNotice(null);
    setPhase('review');
  }

  async function handleGenerate() {
    if (!context) {
      setError('Please sign in and set up your details first.');
      return;
    }

    const ready = await ensureResearchPrompt();
    if (!ready) {
      return;
    }

    if (activeJobId) {
      clearJobPolling();
      setActiveJobId(null);
    }

    setIsGenerating(true);
    setStructuredLetter(null);
    setResearchSummary(null);
    setError(null);
    setNotice(null);
    setJobMessage('Submitting your deep research request…');

    const baseAnswers = buildBaseAnswers();
    const followupAnswerArray = buildFollowupAnswerArray();

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          issueSummary: issue.trim(),
          baseAnswers,
          followupAnswers: followupAnswerArray,
          tone,
          researchPrompt,
          mpName: context.mpName,
          constituency: context.constituency,
          userName: context.userName,
          userAddressHtml: addressToHtml(context.addressLine),
        }),
      });

      if (res.status === 400 || res.status === 402) {
        setIsGenerating(false);
        setJobMessage(null);
        setError('You need at least one credit to generate a letter.');
        return;
      }

      if (!res.ok) {
        throw new Error(
          'The AI service was unable to start deep research just now.'
        );
      }

      const data = await res.json();

      if (typeof data?.credits === 'number') {
        setContext((prev) =>
          prev ? { ...prev, credits: data.credits } : prev
        );
      }

      if (typeof data?.message === 'string') {
        setJobMessage(data.message);
      }

      if (typeof data?.jobId !== 'string' || !data.jobId) {
        throw new Error('Deep research job identifier missing in response.');
      }

      setActiveJobId(data.jobId);
      pollJob(data.jobId, {
        issueSummary: issue.trim(),
        baseAnswers,
        followupAnswers: followupAnswerArray,
        tone,
      }).catch(() => {
        clearJobPolling();
        setError(
          'We could not connect to the AI service. Please try again shortly.'
        );
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
      });
    } catch (err) {
      clearJobPolling();
      setError(
        'We could not connect to the AI service. Please try again shortly.'
      );
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
    }
  }

  async function pollJob(
    jobId: string,
    contextPayload: {
      issueSummary: string;
      baseAnswers: ReturnType<typeof buildBaseAnswers>;
      followupAnswers: ReturnType<typeof buildFollowupAnswerArray>;
      tone: string;
    }
  ) {
    try {
      const res = await fetch(`/api/ai/generate/${jobId}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to fetch job status');
      }

      const data = await res.json();

      if (typeof data?.credits === 'number') {
        setContext((prev) =>
          prev ? { ...prev, credits: data.credits } : prev
        );
      }

      if (typeof data?.message === 'string') {
        setJobMessage(data.message);
      }

      if (data?.status === 'completed' && typeof data?.content === 'string') {
        clearJobPolling();
        setResearchSummary(data.content);
        await composeLetter(jobId, data.content, contextPayload);
        return;
      }

      if (data?.status === 'failed') {
        clearJobPolling();
        setError(
          data?.error ||
            'The AI service was unable to complete the research just now.'
        );
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        return;
      }

      pollTimeoutRef.current = setTimeout(() => {
        pollJob(jobId, contextPayload).catch(() => {
          clearJobPolling();
          setError(
            'We could not connect to the AI service. Please try again shortly.'
          );
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
        });
      }, 5000);
    } catch (err) {
      clearJobPolling();
      setError(
        'We could not connect to the AI service. Please try again shortly.'
      );
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
    }
  }

  async function composeLetter(
    jobId: string,
    summary: string,
    contextPayload: {
      issueSummary: string;
      baseAnswers: ReturnType<typeof buildBaseAnswers>;
      followupAnswers: ReturnType<typeof buildFollowupAnswerArray>;
      tone: string;
    }
  ) {
    if (!context) {
      setError('Session expired. Please sign in again.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
      return;
    }

    try {
      const res = await fetch('/api/ai/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          jobId,
          issueSummary: contextPayload.issueSummary,
          baseAnswers: contextPayload.baseAnswers,
          followupAnswers: contextPayload.followupAnswers,
          tone: contextPayload.tone,
          researchSummary: summary,
          mpName: context.mpName,
          constituency: context.constituency,
          userName: context.userName,
          userAddressHtml: addressToHtml(context.addressLine),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to compose the letter.');
      }

      const data = await res.json();
      if (!data?.letter) {
        throw new Error('Letter data missing from response.');
      }

      setStructuredLetter(data.letter as Letter);
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
      setPhase('result');
    } catch (err) {
      setError('We could not compose the letter. Please try again.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
    }
  }

  function clearJobPolling() {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }

  async function copyLetter() {
    if (!structuredLetter) return;
    const html = letterToHtml(structuredLetter);
    const asPlainText = letterToPlainText(structuredLetter);

    try {
      const cb: any = (navigator as any).clipboard;
      if (cb && typeof cb.write === 'function') {
        const type = 'text/html';
        const blob = new Blob([html], { type });
        const data = [
          new ClipboardItem({
            [type]: blob,
            'text/plain': new Blob([asPlainText], { type: 'text/plain' }),
          } as any),
        ];
        await cb.write(data);
      } else if (cb && typeof cb.writeText === 'function') {
        await cb.writeText(asPlainText);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setNotice('Letter copied to clipboard.');
      setTimeout(() => setNotice(null), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(asPlainText);
        setNotice('Letter copied to clipboard.');
        setTimeout(() => setNotice(null), 2500);
      } catch {
        setError('We could not copy the letter. Please copy manually.');
        setTimeout(() => setError(null), 3000);
      }
    }
  }

  return (
    <main className="hero-section writing-desk">
      <section className="card">
        <div className="container writing-header">
          <div>
            <h1 className="section-title">Writing desk</h1>
            <p className="section-sub">
              Answer a few quick questions and we will draft a fact-checked
              letter for you.
            </p>
          </div>
          <div className="writing-context">
            <p>
              <strong>Credits:</strong> {remainingCredits}
            </p>
            <p>
              Need more? Visit the <Link href="/dashboard">dashboard</Link> to
              buy credits.
            </p>
            {context?.mpEmail && (
              <p>
                <strong>MP email:</strong>{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(context.mpEmail);
                      setNotice('MP email copied.');
                      setTimeout(() => setNotice(null), 2000);
                    } catch {
                      setError('Unable to copy email address.');
                      setTimeout(() => setError(null), 2000);
                    }
                  }}
                >
                  {context.mpEmail}
                </button>
              </p>
            )}
          </div>
        </div>
      </section>

      {contextMessage && (
        <section className="card" aria-live="polite">
          <div className="container">
            <p>{contextMessage}</p>
          </div>
        </section>
      )}

      {phase === 'issue' && (
        <section className="card">
          <div className="container">
            <form className="writing-form" onSubmit={handleIssueSubmit}>
              <label htmlFor="issue" className="label">
                What would you like to raise with your MP?
              </label>
              <textarea
                id="issue"
                name="issue"
                className="textarea"
                rows={6}
                placeholder="Describe the problem or request in a few sentences."
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
              />
              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Next
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {phase === 'questions' && currentQuestion && (
        <section className="card">
          <div className="container">
            <form className="writing-form" onSubmit={handleQuestionSubmit}>
              <div className="step-indicator">
                Step {questionIndex + 1} of {QUESTIONS.length}
              </div>
              <label
                htmlFor={`question-${currentQuestion.id}`}
                className="label"
              >
                {currentQuestion.prompt}
              </label>
              <textarea
                id={`question-${currentQuestion.id}`}
                name={currentQuestion.id}
                className="textarea"
                rows={4}
                placeholder="Add a short answer."
                value={answers[currentQuestion.id] ?? ''}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [currentQuestion.id]: event.target.value,
                  }))
                }
              />
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={backToPrevious}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn-tertiary"
                  onClick={skipQuestion}
                >
                  Skip
                </button>
                <button type="submit" className="btn-primary">
                  {questionIndex + 1 === QUESTIONS.length ? 'Continue' : 'Next'}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {phase === 'followups' && followupState === 'loading' && (
        <section className="card" aria-live="polite">
          <div className="container">
            <p>Generating follow-up questions…</p>
          </div>
        </section>
      )}

      {phase === 'followups' &&
        followupState === 'ready' &&
        currentFollowup && (
          <section className="card">
            <div className="container">
              <form className="writing-form" onSubmit={handleFollowupSubmit}>
                <div className="step-indicator">
                  Follow-up {followupIndex + 1} of {followupQuestions.length}
                </div>
                <label
                  htmlFor={`followup-${currentFollowup.id}`}
                  className="label"
                >
                  {currentFollowup.prompt}
                </label>
                <textarea
                  id={`followup-${currentFollowup.id}`}
                  name={currentFollowup.id}
                  className="textarea"
                  rows={4}
                  placeholder="Add a short answer."
                  value={followupAnswers[currentFollowup.id] ?? ''}
                  onChange={(event) =>
                    setFollowupAnswers((prev) => ({
                      ...prev,
                      [currentFollowup.id]: event.target.value,
                    }))
                  }
                />
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={backToPrevious}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-tertiary"
                    onClick={skipFollowup}
                  >
                    Skip
                  </button>
                  <button type="submit" className="btn-primary">
                    {followupIndex + 1 === followupQuestions.length
                      ? 'Continue'
                      : 'Next'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

      {phase === 'tone' && (
        <section className="card">
          <div className="container">
            {followupError && (
              <div className="flash-message warning" role="alert">
                {followupError}
              </div>
            )}
            <div
              className="tone-options"
              role="radiogroup"
              aria-label="Choose a tone for your letter"
            >
              {TONES.map((option) => (
                <label
                  key={option.id}
                  className={`tone-card ${
                    tone === option.id ? 'selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="tone"
                    value={option.id}
                    checked={tone === option.id}
                    onChange={() => setTone(option.id)}
                  />
                  <span className="tone-label">{option.label}</span>
                  <span className="tone-description">{option.description}</span>
                </label>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={backToPrevious}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={goToReview}
              >
                Review inputs
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === 'review' && (
        <section className="card">
          <div className="container review-card">
            <h2 className="section-title">Review your inputs</h2>
            <dl>
              <dt>Issue summary</dt>
              <dd>{issue || 'Not provided'}</dd>

              {QUESTIONS.map((question) => (
                <div key={question.id} className="review-item">
                  <dt>{question.prompt}</dt>
                  <dd>{answers[question.id]?.trim() || 'Not specified'}</dd>
                </div>
              ))}

              {followupQuestions.length > 0 && (
                <div className="review-item">
                  <dt>Follow-up answers</dt>
                  <dd>
                    <ul className="followup-list">
                      {followupQuestions.map((followup) => (
                        <li key={followup.id}>
                          <strong>{followup.prompt}</strong>
                          <div>
                            {followupAnswers[followup.id]?.trim() ||
                              'Not specified'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}

              <dt>Preferred tone</dt>
              <dd>{TONES.find((item) => item.id === tone)?.label ?? tone}</dd>
            </dl>

            <div className="research-prompt">
              <div className="research-header">
                <h3>Research plan</h3>
                <button
                  type="button"
                  className="btn-tertiary"
                  onClick={refreshResearchPrompt}
                  disabled={researchPromptState === 'loading'}
                >
                  {researchPromptState === 'loading'
                    ? 'Refreshing…'
                    : 'Regenerate plan'}
                </button>
              </div>
              {researchPromptState === 'loading' && (
                <p>Generating latest research plan…</p>
              )}
              {researchPromptState === 'ready' && (
                <pre className="research-plan" aria-live="polite">
                  {researchPrompt}
                </pre>
              )}
              {researchPromptState === 'error' && (
                <p className="error-text">
                  We could not prepare the research plan. Try again before
                  generating the letter.
                </p>
              )}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={backToPrevious}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? 'Researching…' : 'Generate letter'}
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === 'result' && structuredLetter && (
        <section className="card">
          <div className="container letter-container">
            <header className="letter-header">
              <h2 className="section-title">Your draft letter</h2>
              <div className="letter-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={backToPrevious}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={copyLetter}
                >
                  Copy letter
                </button>
              </div>
            </header>
            <article className="letter-output" aria-live="polite">
              <StructuredLetter letter={structuredLetter} />
            </article>
            <footer className="letter-footer">
              <p>
                Ready to send? You can email your MP directly using their
                address above or paste this into your preferred email client.
              </p>
            </footer>
          </div>
        </section>
      )}

      {isGenerating && (
        <section className="card" aria-live="polite">
          <div className="container">
            <DeepResearchProgress
              active={isGenerating}
              messageOverride={jobMessage}
            />
            {researchSummary && (
              <details className="research-summary">
                <summary>View research summary</summary>
                <pre>{researchSummary}</pre>
              </details>
            )}
          </div>
        </section>
      )}

      {notice && (
        <section className="card" aria-live="polite">
          <div className="container">
            <p className="notice-text">{notice}</p>
          </div>
        </section>
      )}

      {error && (
        <section className="card" aria-live="assertive">
          <div className="container">
            <p className="error-text">{error}</p>
          </div>
        </section>
      )}
    </main>
  );
}

function StructuredLetter({ letter }: { letter: Letter }) {
  const references = letter.references ?? [];

  return (
    <div className="letter-html">
      {letter.sender.addressHtml && (
        <div dangerouslySetInnerHTML={{ __html: letter.sender.addressHtml }} />
      )}

      <div dangerouslySetInnerHTML={{ __html: letter.salutationHtml }} />

      {letter.body.paragraphs.map((paragraph, index) => (
        <div key={index} dangerouslySetInnerHTML={{ __html: paragraph.html }} />
      ))}

      {letter.body.actions?.length ? (
        <div className="letter-actions-list">
          <h3>Requested actions</h3>
          <ul>
            {letter.body.actions.map((action, index) => (
              <li key={index}>
                <strong>{action.label}</strong>
                {action.description ? <div>{action.description}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div dangerouslySetInnerHTML={{ __html: letter.closingHtml }} />

      {references.length ? (
        <div className="letter-references">
          <h3>References</h3>
          <ol>
            {references.map((ref, index) => (
              <li key={index}>
                {ref.url ? (
                  <a href={ref.url} target="_blank" rel="noopener noreferrer">
                    {referenceLabel(ref)}
                  </a>
                ) : (
                  referenceLabel(ref)
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function referenceLabel(ref: LetterReference) {
  const parts = [ref.title];
  if (ref.source) parts.push(ref.source);
  if (ref.year) parts.push(ref.year);
  return parts.join(' — ');
}

function letterToHtml(letter: Letter): string {
  const parts: string[] = [];
  if (letter.sender.addressHtml) {
    parts.push(letter.sender.addressHtml);
  }
  parts.push(letter.salutationHtml);
  letter.body.paragraphs.forEach((paragraph) => {
    parts.push(paragraph.html);
  });
  if (letter.body.actions?.length) {
    const actionItems = letter.body.actions
      .map((action) => {
        const description = action.description
          ? `<div>${escapeHtml(action.description)}</div>`
          : '';
        return `<li><strong>${escapeHtml(
          action.label
        )}</strong>${description}</li>`;
      })
      .join('');
    parts.push(`<h3>Requested actions</h3><ul>${actionItems}</ul>`);
  }
  parts.push(letter.closingHtml);
  if (letter.references?.length) {
    const refs = letter.references
      .map((ref) => {
        const label = referenceLabel(ref);
        return ref.url
          ? `<li><a href="${
              ref.url
            }" rel="noopener noreferrer" target="_blank">${escapeHtml(
              label
            )}</a></li>`
          : `<li>${escapeHtml(label)}</li>`;
      })
      .join('');
    parts.push(`<h3>References</h3><ol>${refs}</ol>`);
  }
  return `<div class="letter">${parts.join('')}</div>`;
}

function letterToPlainText(letter: Letter): string {
  const lines: string[] = [];
  if (letter.sender.addressHtml) {
    lines.push(stripHtml(letter.sender.addressHtml));
  }
  lines.push(stripHtml(letter.salutationHtml));
  letter.body.paragraphs.forEach((paragraph) => {
    lines.push(stripHtml(paragraph.html));
  });
  if (letter.body.actions?.length) {
    lines.push('Requested actions:');
    letter.body.actions.forEach((action, index) => {
      const lineParts = [`${index + 1}. ${action.label}`];
      if (action.description) {
        lineParts.push(action.description);
      }
      lines.push(lineParts.join(' — '));
    });
  }
  lines.push(stripHtml(letter.closingHtml));
  if (letter.references?.length) {
    lines.push('References:');
    letter.references.forEach((ref, index) => {
      lines.push(`${index + 1}. ${referenceLabel(ref)}`);
      if (ref.url) {
        lines.push(`   ${ref.url}`);
      }
    });
  }
  return lines.filter(Boolean).join('\n\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addressToHtml(address: string): string {
  if (!address.trim()) return '';
  return `<p>${escapeHtml(address.trim())}</p>`;
}
