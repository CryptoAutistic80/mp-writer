"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import DeepResearchProgress from '../../components/DeepResearchProgress';

const QUESTIONS: { id: string; prompt: string }[] = [
  { id: 'who', prompt: 'Who is most affected by this issue?' },
  { id: 'details', prompt: 'What background or context should your MP know?' },
  { id: 'action', prompt: 'What action would you like your MP to take?' },
];

const TONES: { id: string; label: string; description: string }[] = [
  { id: 'formal', label: 'Formal', description: 'Polite and professional with clear respect.' },
  { id: 'neutral', label: 'Neutral', description: 'Factual, calm and to the point.' },
  { id: 'friendly', label: 'Friendly', description: 'Warm and conversational while staying respectful.' },
  { id: 'urgent', label: 'Urgent', description: 'Passionate and time-sensitive but still courteous.' },
];

type Phase = 'issue' | 'questions' | 'tone' | 'review' | 'result';

type UserContext = {
  mpName: string;
  mpEmail: string;
  constituency: string;
  credits: number;
  userName: string;
  addressLine: string;
};

export default function WritingDeskClient() {
  const [phase, setPhase] = useState<Phase>('issue');
  const [issue, setIssue] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [tone, setTone] = useState<string>('formal');
  const [letter, setLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [context, setContext] = useState<UserContext | null>(null);
  const [contextMessage, setContextMessage] = useState<string>('Loading your saved details…');
  const [notice, setNotice] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function apiPath(path: string) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `/api${normalized}`.replace('//', '/');
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, mpRes, addressRes] = await Promise.all([
          fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/user/mp', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/user/address', { credentials: 'include', cache: 'no-store' }),
        ]);

        if (!meRes.ok) {
          const message = meRes.status === 401
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
        const mpName = mp?.mp?.name || mp?.mp?.fullName || mp?.mp?.displayName || '';
        const mpEmail = mp?.mp?.email || '';
        const constituency = mp?.constituency || '';
        const address = addressDoc?.address;
        const addressLine = address
          ? [address.line1, address.line2, address.city, address.county, address.postcode]
              .map((part: string | undefined) => (part || '').trim())
              .filter((part: string) => Boolean(part))
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
        if (!cancelled) setContextMessage('We could not load your saved details.');
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
      setContextMessage('Please return to the dashboard to confirm your MP and address before generating a letter.');
    }
  }, [context]);

  const currentQuestion = useMemo(() => QUESTIONS[questionIndex], [questionIndex]);

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

  function advanceQuestion() {
    if (questionIndex + 1 >= QUESTIONS.length) {
      setPhase('tone');
      return;
    }
    setQuestionIndex((prev) => prev + 1);
  }

  function skipQuestion() {
    setError(null);
    setNotice(null);
    advanceQuestion();
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
    if (phase === 'tone') {
      setPhase('questions');
      setQuestionIndex(Math.max(QUESTIONS.length - 1, 0));
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

  function clearJobPolling() {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }

  async function pollJob(jobId: string) {
    try {
      const res = await fetch(apiPath(`/ai/generate/${jobId}`), {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to fetch job status');
      }

      const data = await res.json();

      if (typeof data?.credits === 'number') {
        setContext((prev) => (prev ? { ...prev, credits: data.credits } : prev));
      }

      if (typeof data?.message === 'string') {
        setJobMessage(data.message);
      }

      if (data?.status === 'completed' && typeof data?.content === 'string') {
        clearJobPolling();
        setLetter(data.content.trim());
        setPhase('result');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        return;
      }

      if (data?.status === 'failed') {
        clearJobPolling();
        setError(data?.error || 'The AI service was unable to draft your letter just now.');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        return;
      }

      pollTimeoutRef.current = setTimeout(() => {
        pollJob(jobId).catch(() => {
          clearJobPolling();
          setError('We could not connect to the AI service. Please try again shortly.');
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
        });
      }, 5000);
    } catch (err) {
      clearJobPolling();
      setError('We could not connect to the AI service. Please try again shortly.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
    }
  }

  async function handleGenerate() {
    if (!context) {
      setError('Please sign in and set up your details first.');
      return;
    }

    if (activeJobId) {
      clearJobPolling();
      setActiveJobId(null);
    }

    setIsGenerating(true);
    setError(null);
    setNotice(null);
    setLetter(null);
    setJobMessage('Submitting your deep research request…');
    try {
      const details = QUESTIONS.map((question) => ({
        question: question.prompt,
        answer: answers[question.id]?.trim() || 'Not specified.',
      }));

      const res = await fetch(apiPath('/ai/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: issue,
          tone,
          details,
          mpName: context.mpName,
          constituency: context.constituency,
          userName: context.userName,
          userAddressLine: context.addressLine,
        }),
      });

      if (res.status === 400 || res.status === 402) {
        setIsGenerating(false);
        setJobMessage(null);
        setError('You need at least one credit to generate a letter.');
        return;
      }

      if (!res.ok) {
        setIsGenerating(false);
        setJobMessage(null);
        setError('The AI service was unable to draft your letter just now.');
        return;
      }

      const data = await res.json();

      if (typeof data?.credits === 'number') {
        setContext((prev) => (prev ? { ...prev, credits: data.credits } : prev));
      }

      if (typeof data?.message === 'string') {
        setJobMessage(data.message);
      }

      if (typeof data?.jobId !== 'string' || !data.jobId) {
        throw new Error('Deep research job identifier missing in response.');
      }

      setActiveJobId(data.jobId);
      pollJob(data.jobId).catch(() => {
        clearJobPolling();
        setError('We could not connect to the AI service. Please try again shortly.');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
      });
    } catch (err) {
      clearJobPolling();
      setError('We could not connect to the AI service. Please try again shortly.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
    }
  }

  async function copyLetter() {
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letter);
      setNotice('Letter copied to clipboard.');
      setTimeout(() => setNotice(null), 2500);
    } catch {
      setError('We could not copy the letter. Please copy manually.');
      setTimeout(() => setError(null), 3000);
    }
  }

  return (
    <main className="hero-section writing-desk">
      <section className="card">
        <div className="container writing-header">
          <div>
            <h1 className="section-title">Writing desk</h1>
            <p className="section-sub">Answer a few quick questions and we will draft a fact-checked letter for you.</p>
          </div>
          <div className="writing-context">
            <p><strong>Credits:</strong> {remainingCredits}</p>
            <p>
              Need more? Visit the <Link href="/dashboard">dashboard</Link> to buy credits.
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
                <button type="submit" className="btn-primary">Next</button>
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
              <label htmlFor={`question-${currentQuestion.id}`} className="label">
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
                  setAnswers((prev) => ({ ...prev, [currentQuestion.id]: event.target.value }))
                }
              />
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={backToPrevious}>
                  Back
                </button>
                <button type="button" className="btn-tertiary" onClick={skipQuestion}>
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

      {phase === 'tone' && (
        <section className="card">
          <div className="container">
            <div className="tone-options" role="radiogroup" aria-label="Choose a tone for your letter">
              {TONES.map((option) => (
                <label key={option.id} className={`tone-card ${tone === option.id ? 'selected' : ''}`}>
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
              <button type="button" className="btn-secondary" onClick={backToPrevious}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={() => setPhase('review')}>
                Review inputs
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === 'review' && (
        <section className="card">
          <div className="container review-card">
            <h2 className="section-title">Review your answers</h2>
            <dl>
              <dt>Issue summary</dt>
              <dd>{issue || 'Not provided'}</dd>
              {QUESTIONS.map((question) => (
                <div key={question.id} className="review-item">
                  <dt>{question.prompt}</dt>
                  <dd>{answers[question.id]?.trim() || 'Not specified'}</dd>
                </div>
              ))}
              <dt>Preferred tone</dt>
              <dd>{TONES.find((item) => item.id === tone)?.label ?? tone}</dd>
            </dl>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={backToPrevious}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? 'Generating…' : 'Generate letter'}
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === 'result' && (
        <section className="card">
          <div className="container letter-container">
            <header className="letter-header">
              <h2 className="section-title">Your draft letter</h2>
              <div className="letter-actions">
                <button type="button" className="btn-secondary" onClick={backToPrevious}>
                  Back
                </button>
                <button type="button" className="btn-primary" onClick={copyLetter}>
                  Copy letter
                </button>
              </div>
            </header>
            <article className="letter-output" aria-live="polite">
              {letter?.split('\n').map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>
            <footer className="letter-footer">
              <p>
                Ready to send? You can email your MP directly using their address above or paste this into your
                preferred email client.
              </p>
            </footer>
          </div>
        </section>
      )}

      {isGenerating && (
        <section className="card" aria-live="polite">
          <div className="container">
            <DeepResearchProgress active={isGenerating} messageOverride={jobMessage} />
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
