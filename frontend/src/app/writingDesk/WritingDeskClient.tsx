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

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

type JobPayloadSnapshot = {
  prompt?: string;
  tone?: string;
  model?: string;
  details?: { question: string; answer: string }[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
};

type JobSnapshot = {
  jobId?: string;
  status?: JobStatus;
  message?: string;
  credits?: number;
  updatedAt?: number;
  content?: string;
  error?: string;
  payload?: JobPayloadSnapshot;
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

        if (!cancelled) {
          try {
            const jobRes = await fetch('/api/ai/generate', {
              credentials: 'include',
              cache: 'no-store',
            });
            if (cancelled) return;
            if (jobRes.ok) {
              const jobData: JobSnapshot = await jobRes.json().catch(() => null);
              if (cancelled) return;
              const status = handleJobSnapshot(jobData);
              if (
                status &&
                (status === 'queued' || status === 'in_progress') &&
                jobData &&
                typeof jobData.jobId === 'string' &&
                jobData.jobId
              ) {
                pollJob(jobData.jobId).catch(() => {
                  clearJobPolling();
                  setError('We could not connect to the AI service. Please try again shortly.');
                  setIsGenerating(false);
                  setActiveJobId(null);
                  setJobMessage(null);
                });
              }
            }
          } catch {
            // Ignore job fetch errors on initial load.
          }
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

  function handleJobSnapshot(data: JobSnapshot | null | undefined): JobStatus | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const status = data.status;
    if (!status) {
      return null;
    }

    if (typeof data.credits === 'number') {
      const credits = data.credits;
      setContext((prev) => (prev ? { ...prev, credits } : prev));
    }

    if (typeof data.message === 'string') {
      setJobMessage(data.message);
    } else {
      setJobMessage(null);
    }

    if (typeof data.jobId === 'string' && data.jobId) {
      setActiveJobId(data.jobId);
    }

    const payload = data.payload;
    if (payload && typeof payload === 'object') {
      if (typeof payload.prompt === 'string') {
        setIssue(payload.prompt);
      }
      if (typeof payload.tone === 'string' && payload.tone.trim()) {
        setTone(payload.tone);
      }
      if (Array.isArray(payload.details)) {
        const mapped: Record<string, string> = {};
        payload.details.forEach((detail) => {
          if (!detail || typeof detail.question !== 'string') {
            return;
          }
          const match = QUESTIONS.find((q) => q.prompt === detail.question);
          if (match) {
            mapped[match.id] = detail.answer || '';
          }
        });
        setAnswers(mapped);
      }
      if (
        (status === 'in_progress' || status === 'queued') &&
        ((typeof payload.prompt === 'string' && payload.prompt.trim()) ||
          (Array.isArray(payload.details) && payload.details.length > 0))
      ) {
        setPhase('review');
      }
    }

    if (status === 'completed') {
      clearJobPolling();
      if (typeof data.content === 'string') {
        const html = normaliseLetterHtml(data.content);
        setLetter(stripCitationsAndReferences(html));
      }
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
      setError(null);
      setPhase('result');
      return status;
    }

    if (status === 'failed') {
      clearJobPolling();
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
      setLetter(null);
      setError(data.error || 'The AI service was unable to draft your letter just now.');
      setPhase((prev) => (prev === 'result' ? 'review' : prev));
      return status;
    }

    if (status === 'queued' || status === 'in_progress') {
      setLetter(null);
      setError(null);
      setNotice(null);
      setIsGenerating(true);
      return status;
    }

    return status;
  }

  async function pollJob(jobId: string) {
    try {
      const res = await fetch(`/api/ai/generate/${jobId}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to fetch job status');
      }

      const data: JobSnapshot = await res.json();
      const status = handleJobSnapshot(data);

      if (status === 'queued' || status === 'in_progress') {
        pollTimeoutRef.current = setTimeout(() => {
          pollJob(jobId).catch(() => {
            clearJobPolling();
            setError('We could not connect to the AI service. Please try again shortly.');
            setIsGenerating(false);
            setActiveJobId(null);
            setJobMessage(null);
          });
        }, 5000);
      }
    } catch (err) {
      clearJobPolling();
      setError('We could not connect to the AI service. Please try again shortly.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
    }
  }

  function normaliseLetterHtml(raw: string): string {
    let s = (raw || '').trim();
    // 1) Strip code fences if present
    s = s.replace(/^```\s*html\s*/i, '').replace(/^```/, '').replace(/```\s*$/m, '').trim();

    // 2) Decode HTML entities to real tags if output was escaped
    if (/&lt;|&gt;|&amp;/.test(s)) {
      const t = document.createElement('textarea');
      t.innerHTML = s;
      s = t.value;
    }

    const looksLikeHtml = /<\s*[a-z][\s\S]*>/i.test(s);

    if (!looksLikeHtml) {
      // 3) Convert Markdown/plaintext to HTML
      s = markdownToHtml(s);
    }

    // 4) Linkify any leftover bare URLs inside existing HTML safely
    s = linkifyHtml(s);
    return s;
  }

  function markdownToHtml(md: string): string {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const html: string[] = [];
    let i = 0;
    const flushPara = (buf: string[]) => {
      if (!buf.length) return;
      const text = buf.join('\n');
      html.push(`<p>${inlineMarkdown(text).replace(/\n/g, '<br/>')}</p>`);
      buf.length = 0;
    };
    const inlineMarkdown = (s: string) => {
      // Links [text](url)
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) =>
        `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`,
      );
      // Bold **text** or __text__
      s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a || b}</strong>`);
      // Italic *text* or _text_
      s = s.replace(/\*(?!\s)([^*]+)\*(?!\S)|_(?!\s)([^_]+)_(?!\S)/g, (_m, a, b) => `<em>${a || b}</em>`);
      return s;
    };

    while (i < lines.length) {
      // Skip leading blank lines
      if (!lines[i].trim()) {
        i++;
        continue;
      }

      // Headings ###, ##, # (map # -> h2 to keep sizes modest)
      const heading = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(3, heading[1].length + 1); // #->h2, ##->h3, ###+->h3
        html.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
        i++;
        continue;
      }

      // References label
      if (/^references\s*:?$/i.test(lines[i].trim())) {
        html.push('<h3>References</h3>');
        i++;
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(lines[i])) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          const text = lines[i].replace(/^\d+\.\s+/, '');
          items.push(`<li>${inlineMarkdown(text)}</li>`);
          i++;
        }
        html.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // Unordered list
      if (/^[-*+]\s+/.test(lines[i])) {
        const items: string[] = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
          const text = lines[i].replace(/^[-*+]\s+/, '');
          items.push(`<li>${inlineMarkdown(text)}</li>`);
          i++;
        }
        html.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // Paragraph block until blank line
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        buf.push(lines[i]);
        i++;
      }
      flushPara(buf);
    }

    return html.join('\n');
  }

  function linkifyHtml(html: string): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const urlRe = /(https?:\/\/[^\s<>()]+[^\s.,;:!?<>()\]\}])/g;
    const toProcess: Text[] = [];
    let node: Node | null = walker.nextNode();
    while (node) {
      // ignore inside existing anchors
      if (!node.parentElement || node.parentElement.closest('a')) {
        node = walker.nextNode();
        continue;
      }
      if (urlRe.test(node.textContent || '')) {
        toProcess.push(node as Text);
      }
      node = walker.nextNode();
    }
    toProcess.forEach((textNode) => {
      const parts = (textNode.textContent || '').split(urlRe);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        if (/^https?:\/\//.test(part)) {
          const a = document.createElement('a');
          a.href = part;
          a.textContent = part;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          frag.appendChild(a);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      textNode.replaceWith(frag);
    });
    return container.innerHTML;
  }

  function stripCitationsAndReferences(html: string): string {
    const root = document.createElement('div');
    root.innerHTML = html;

    const citationInline = /(?:\s|\u00A0)*(?:\[\s*\d+\s*\]|【\s*\d+\s*】|\(\s*\d+\s*\)|\^\s*\d+)(?:[,.;:]|\s)?/g;

    const isCitationOnly = (node: Element, text: string): boolean => {
      if (/^\s*(?:\[\s*\d+\s*\]|【\s*\d+\s*】|\(\s*\d+\s*\)|\^\s*\d+)\s*[,.;:]?\s*$/.test(text)) {
        return true;
      }

      if ((node.tagName === 'SUP' || node.tagName === 'SUB') && /^\s*\d+\s*$/.test(text)) {
        return true;
      }

      return false;
    };

    const removeReferenceSections = () => {
      const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      headings.forEach((heading) => {
        const text = (heading.textContent || '').trim();
        if (!/^(?:references?|sources?)\b/i.test(text)) {
          return;
        }

        let sibling = heading.nextElementSibling;
        while (sibling && /^(p|ol|ul)$/i.test(sibling.tagName)) {
          const next = sibling.nextElementSibling;
          sibling.remove();
          sibling = next;
        }
        heading.remove();
      });
    };

    const removeCitationNodes = () => {
      const inlineNodes = Array.from(root.querySelectorAll('sup,sub,span,em,strong,b,i,a'));
      inlineNodes.forEach((node) => {
        const text = node.textContent || '';
        if (isCitationOnly(node, text)) {
          node.remove();
          return;
        }

        const cleaned = text.replace(citationInline, ' ').replace(/\s{2,}/g, ' ').trim();
        if (!cleaned) {
          node.remove();
          return;
        }

        if (cleaned !== text) {
          node.textContent = cleaned;
        }
      });
    };

    const stripTextNodes = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current: Node | null = walker.nextNode();
      while (current) {
        const parent = current.parentElement;
        if (parent && /^(script|style|code|pre)$/i.test(parent.tagName)) {
          current = walker.nextNode();
          continue;
        }

        const original = current.textContent || '';
        const replaced = original.replace(citationInline, ' ').replace(/\s{2,}/g, ' ');
        if (replaced !== original) {
          current.textContent = replaced;
        }

        current = walker.nextNode();
      }
    };

    const removeEmptyNodes = () => {
      const maybeEmpty = Array.from(root.querySelectorAll('p,li,span,div'));
      maybeEmpty.forEach((el) => {
        if (!(el.textContent || '').trim() && el.children.length === 0) {
          el.remove();
        }
      });
    };

    removeReferenceSections();
    removeCitationNodes();
    stripTextNodes();
    removeEmptyNodes();

    let output = root.innerHTML;
    output = output.replace(/\s{2,}/g, ' ');
    output = output.replace(/\(\s*\)/g, '');
    output = output.replace(/\s+([,.;:])/g, '$1');
    return output.trim();
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

      const res = await fetch('/api/ai/generate', {
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
      const status = handleJobSnapshot(data);
      const jobId = typeof data?.jobId === 'string' ? data.jobId : null;

      if (status === 'queued' || status === 'in_progress') {
        if (!jobId) {
          throw new Error('Deep research job identifier missing in response.');
        }
        clearJobPolling();
        pollJob(jobId).catch(() => {
          clearJobPolling();
          setError('We could not connect to the AI service. Please try again shortly.');
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
        });
      } else {
        setIsGenerating(false);
      }
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
    const asPlainText = (() => {
      // Basic HTML -> text fallback
      const div = document.createElement('div');
      div.innerHTML = letter;
      return div.textContent || div.innerText || '';
    })();

    try {
      const cb: any = (navigator as any).clipboard;
      if (cb && typeof cb.write === 'function') {
        const type = 'text/html';
        const blob = new Blob([letter], { type });
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
              {letter ? (
                <div
                  className="letter-html"
                  // Letter content is generated by our backend and expected to be HTML.
                  dangerouslySetInnerHTML={{ __html: letter }}
                />
              ) : null}
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
