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

type UserLetterStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

type UserLetterSummary = {
  id: string;
  jobId: string;
  status: UserLetterStatus;
  message: string;
  prompt: string;
  tone: string;
  mpName: string;
  constituency: string;
  hasContent: boolean;
  credits: number | null;
  updatedAt: string;
  createdAt: string;
};

type LetterDetailEntry = {
  question: string;
  answer: string;
};

type UserLetterDetail = {
  id: string;
  jobId: string;
  status: UserLetterStatus;
  message: string;
  prompt: string;
  tone: string;
  details: LetterDetailEntry[];
  mpName: string;
  constituency: string;
  userName: string;
  userAddressLine: string;
  content: string | null;
  error: string | null;
  credits: number | null;
  createdAt: string;
  updatedAt: string;
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
  const [letters, setLetters] = useState<UserLetterSummary[]>([]);
  const [lettersLoading, setLettersLoading] = useState<boolean>(true);
  const [lettersError, setLettersError] = useState<string | null>(null);
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const lettersRef = useRef<UserLetterSummary[]>([]);

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
    refreshLetters().catch(() => {
      /* Errors handled inside refreshLetters */
    });
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
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

  function describeStatus(status: UserLetterStatus): string {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'queued':
      case 'in_progress':
        return 'In progress';
      default:
        return status;
    }
  }

  function summarisePrompt(prompt: string): string {
    const trimmed = (prompt || '').trim();
    if (!trimmed) {
      return 'No issue summary saved yet.';
    }
    if (trimmed.length <= 160) {
      return trimmed;
    }
    return `${trimmed.slice(0, 157)}…`;
  }

  function formatUpdatedAt(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function mapDetailsToAnswers(details: LetterDetailEntry[] = []): Record<string, string> {
    const mapped: Record<string, string> = {};
    details.forEach((entry) => {
      if (!entry) return;
      const match = QUESTIONS.find((question) => question.prompt === entry.question);
      if (match) {
        mapped[match.id] = entry.answer || '';
      }
    });
    return mapped;
  }

  async function fetchLetterDetail(letterId: string): Promise<UserLetterDetail> {
    const res = await fetch(`/api/user/letters/${letterId}`, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      const message = res.status === 404 ? 'Letter not found' : 'Failed to fetch saved letter.';
      throw new Error(message);
    }

    return res.json();
  }

  async function resumeLetter(letterId: string) {
    try {
      const data = await fetchLetterDetail(letterId);
      if (!isMountedRef.current) return;

      if (data.status === 'completed' && typeof data.content === 'string') {
        await viewLetter(letterId);
        return;
      }

      if (data.status === 'failed') {
        clearJobPolling();
        setActiveJobId(null);
        setIsGenerating(false);
        setJobMessage(null);
        setLetter(null);
        setPhase('review');
        setSelectedLetterId(letterId);
        setError(data.error || 'The previous request was unable to generate a letter.');
        return;
      }

      if (!data.jobId) {
        setError('We could not resume that request. Please try again shortly.');
        return;
      }

      const mapped = mapDetailsToAnswers(data.details || []);
      const restored: Record<string, string> = {};
      QUESTIONS.forEach((question) => {
        restored[question.id] = mapped[question.id] ?? '';
      });

      clearJobPolling();
      setActiveJobId(data.jobId);
      setSelectedLetterId(letterId);
      setIsGenerating(true);
      setNotice(null);
      setError(null);
      setLetter(null);
      setPhase('review');
      setJobMessage(data.message || 'Deep research in progress…');
      setIssue(data.prompt || '');
      setTone((data.tone || '').trim() || 'formal');
      setAnswers(restored);

      if (typeof data.credits === 'number') {
        const credits = data.credits;
        setContext((prev) => (prev ? { ...prev, credits } : prev));
      }

      pollJob(data.jobId).catch(() => {
        clearJobPolling();
        if (!isMountedRef.current) return;
        setError('We could not connect to the AI service. Please try again shortly.');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
      });
    } catch (err) {
      if (!isMountedRef.current) return;
      setError('We could not resume that request. Please try again shortly.');
    }
  }

  async function viewLetter(letterId: string) {
    try {
      const data = await fetchLetterDetail(letterId);
      if (!isMountedRef.current) return;

      setSelectedLetterId(letterId);

      if (typeof data.credits === 'number') {
        const credits = data.credits;
        setContext((prev) => (prev ? { ...prev, credits } : prev));
      }

      if (data.status === 'completed' && typeof data.content === 'string') {
        clearJobPolling();
        setActiveJobId(null);
        setIsGenerating(false);
        setJobMessage(null);
        setNotice(null);
        setError(null);

        const mapped = mapDetailsToAnswers(data.details || []);
        const restored: Record<string, string> = {};
        QUESTIONS.forEach((question) => {
          restored[question.id] = mapped[question.id] ?? '';
        });
        setAnswers(restored);
        setIssue(data.prompt || '');
        setTone((data.tone || '').trim() || 'formal');

        const html = normaliseLetterHtml(data.content);
        setLetter(enhanceCitations(html));
        setPhase('result');
        return;
      }

      if ((data.status === 'in_progress' || data.status === 'queued') && data.jobId) {
        await resumeLetter(letterId);
        return;
      }

      if (data.status === 'failed') {
        clearJobPolling();
        setActiveJobId(null);
        setIsGenerating(false);
        setJobMessage(null);
        setLetter(null);
        setPhase('review');
        const mapped = mapDetailsToAnswers(data.details || []);
        const restored: Record<string, string> = {};
        QUESTIONS.forEach((question) => {
          restored[question.id] = mapped[question.id] ?? '';
        });
        setAnswers(restored);
        setIssue(data.prompt || '');
        setTone((data.tone || '').trim() || 'formal');
        setError(data.error || 'The AI service was unable to draft your letter.');
        return;
      }

      setError('This letter is not available yet. Please try again soon.');
    } catch (err) {
      if (!isMountedRef.current) return;
      setError('We could not load that letter. Please try again shortly.');
    }
  }

  async function refreshLetters(options: { resume?: boolean } = {}) {
    try {
      const res = await fetch('/api/user/letters', {
        credentials: 'include',
        cache: 'no-store',
      });

      if (res.status === 401) {
        if (!isMountedRef.current) return;
        setLetters([]);
        lettersRef.current = [];
        setLettersLoading(false);
        setLettersError('Sign in to view saved letters.');
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to load letters');
      }

      const data = await res.json();
      if (!isMountedRef.current) return;

      const list: UserLetterSummary[] = Array.isArray(data?.letters) ? data.letters : [];
      setLetters(list);
      lettersRef.current = list;
      setLettersError(null);
      setLettersLoading(false);

      if (options.resume !== false) {
        const active = list.find(
          (item) => (item.status === 'in_progress' || item.status === 'queued') && item.jobId,
        );
        if (active && active.jobId && active.jobId !== activeJobId) {
          await resumeLetter(active.id);
        }
      }
    } catch (_error) {
      if (!isMountedRef.current) return;
      setLettersLoading(false);
      setLettersError('We could not load your saved letters.');
    }
  }

  async function pollJob(jobId: string) {
    try {
      const res = await fetch(`/api/ai/generate/${jobId}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to fetch job status');
      }

      const data = await res.json();

      if (!isMountedRef.current) return;

      if (typeof data?.credits === 'number') {
        const credits = data.credits;
        setContext((prev) => (prev ? { ...prev, credits } : prev));
      }

      if (typeof data?.message === 'string') {
        setJobMessage(data.message);
      }

      if (data?.status === 'completed' && typeof data?.content === 'string') {
        clearJobPolling();
        const html = normaliseLetterHtml(data.content);
        setLetter(enhanceCitations(html));
        setPhase('result');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        await refreshLetters({ resume: false });
        const summary = lettersRef.current.find((item) => item.jobId === jobId);
        if (summary) {
          setSelectedLetterId(summary.id);
        }
        return;
      }

      if (data?.status === 'failed') {
        clearJobPolling();
        setError(data?.error || 'The AI service was unable to draft your letter just now.');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        await refreshLetters({ resume: false });
        return;
      }

      pollTimeoutRef.current = setTimeout(() => {
        pollJob(jobId).catch(() => {
          clearJobPolling();
          setError('We could not connect to the AI service. Please try again shortly.');
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
          refreshLetters({ resume: false }).catch(() => {
            /* handled elsewhere */
          });
        });
      }, 5000);
    } catch (err) {
      clearJobPolling();
      setError('We could not connect to the AI service. Please try again shortly.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
      refreshLetters({ resume: false }).catch(() => {
        /* handled elsewhere */
      });
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

  // Convert inline long links in the body into numbered [n] citations
  // that link down to the References list, which remains expanded.
  function enhanceCitations(html: string): string {
    const stripInlineCitations = (input: string): string => {
      const container = document.createElement('div');
      container.innerHTML = input;

      const heading = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((h) =>
        /^references\b/i.test((h.textContent || '').trim()),
      );
      const refsList = heading
        ? (heading.nextElementSibling && /^(ol|ul)$/i.test(heading.nextElementSibling.tagName)
            ? (heading.nextElementSibling as HTMLOListElement | HTMLUListElement)
            : (heading.parentElement?.querySelector('ol,ul') as HTMLOListElement | HTMLUListElement | null))
        : null;

      const limitNode = refsList as Node | null;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let current: Node | null = walker.nextNode();

      while (current && current !== limitNode) {
        if (current.nodeType === Node.ELEMENT_NODE) {
          const el = current as Element;
          if (limitNode && el === limitNode) break;
          if (el.matches('a[href]')) {
            const anchor = el as HTMLAnchorElement;
            anchor.replaceWith(document.createTextNode(''));
          }
        }

        if (
          current &&
          current.nodeType === Node.TEXT_NODE &&
          current.parentElement &&
          (!limitNode || !limitNode.contains(current))
        ) {
          let text = current.textContent || '';
          const domainPart = String.raw`(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w\-./%?#=&+]*)?`;
          const parenWithUrl = new RegExp(String.raw`\(\s*(?:\[)?${domainPart}(?:\])?(?:\s*\[[0-9]+\])?\s*\)`, 'gi');
          text = text.replace(parenWithUrl, '');
          text = text.replace(/\(\s*\[[^\]]+\]\(https?:\/\/[^)\s]+\)\s*\)/gi, '');
          text = text.replace(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/gi, '');
          text = text.replace(/\[(?:https?:\/\/|www\.)[^\]]+\]/gi, '');
          const citeNum = /(?:\s|\u00A0)*\[\s*\d+\s*\](?:[,.;:])?/g;
          text = text.replace(citeNum, '');
          text = text.replace(/\s{2,}/g, ' ');
          if (text !== (current.textContent || '')) current.textContent = text;
        }

        current = walker.nextNode();
      }

      let output = container.innerHTML;
      output = output.replace(/\(\s*\)/g, '');
      output = output.replace(/\s{2,}/g, ' ');
      return output;
    };

    const cleanedHtml = stripInlineCitations(html);

    const root = document.createElement('div');
    root.innerHTML = cleanedHtml;

    // 1) Locate References heading and list
    const heading = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((h) =>
      /^references\b/i.test((h.textContent || '').trim()),
    );
    const refsList = heading
      ? (heading.nextElementSibling && /^(ol|ul)$/i.test(heading.nextElementSibling.tagName)
          ? (heading.nextElementSibling as HTMLOListElement | HTMLUListElement)
          : (heading.parentElement?.querySelector('ol,ul') as HTMLOListElement | HTMLUListElement | null))
      : null;

    if (!refsList) {
      // Nothing to map to; just return input
      return root.innerHTML;
    }

    // 2) Build URL -> index map from references
    const urlToIndex = new Map<string, number>();
    const normalise = (u: string) => {
      try {
        const url = new URL(u);
        // Canonicalise for matching: strip hash and query to ignore trackers/anchors
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return u.trim();
      }
    };

    const items = Array.from(refsList.querySelectorAll('li'));
    items.forEach((li, i) => {
      const a = li.querySelector('a[href]') as HTMLAnchorElement | null;
      if (!a || !a.href) return;
      const idx = i + 1;
      const norm = normalise(a.href);
      if (!urlToIndex.has(norm)) urlToIndex.set(norm, idx);
      li.id = `ref-${idx}`;
    });
    let nextIndex = items.length + 1;

    const appendReference = (href: string) => {
      // Avoid duplicates after normalisation
      const norm = normalise(href);
      const existing = urlToIndex.get(norm);
      if (existing) return existing;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      // Use domain as fallback text; backend already supplies nice titles in most cases
      try {
        const u = new URL(href);
        a.textContent = u.hostname.replace(/^www\./, '') + ' — ' + u.pathname.replace(/\/$/, '');
      } catch {
        a.textContent = href;
      }
      li.appendChild(a);
      refsList.appendChild(li);
      const assigned = nextIndex++;
      li.id = `ref-${assigned}`;
      urlToIndex.set(norm, assigned);
      return assigned;
    };

    // 3) Walk body (before references list) replacing anchors and parenthetical URLs
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.nextNode();
    const until = refsList as Node;
    const citationClass = 'citation';

    const replaceAnchorWithCitation = (a: HTMLAnchorElement) => {
      const norm = normalise(a.href || '');
      let index = urlToIndex.get(norm);
      if (!index) {
        index = appendReference(a.href || '');
      }
      const cite = document.createElement('a');
      cite.href = `#ref-${index}`;
      cite.className = citationClass;
      cite.textContent = `[${index}]`;
      a.replaceWith(cite);
    };

    while (node && node !== until) {
      // Replace anchors in the body
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        // Stop walking into references section
        if (el === until) break;
        if (el.matches('a[href]')) {
          replaceAnchorWithCitation(el as HTMLAnchorElement);
        }
      }

      // Replace parenthetical raw URLs within text nodes: (https://...)
      if (node.nodeType === Node.TEXT_NODE && node.parentElement && !(refsList.contains(node))) {
        const text = node.textContent || '';
        const regex = /\((https?:\/\/[^)\s]+)\)/g;
        if (regex.test(text)) {
          const frag = document.createDocumentFragment();
          let lastIndex = 0;
          let m: RegExpExecArray | null;
          regex.lastIndex = 0;
          while ((m = regex.exec(text))) {
            const before = text.slice(lastIndex, m.index);
            if (before) frag.appendChild(document.createTextNode(before));
            const url = m[1];
            let idx = urlToIndex.get(normalise(url));
            if (!idx) idx = appendReference(url);
            if (idx) {
              const cite = document.createElement('a');
              cite.href = `#ref-${idx}`;
              cite.className = citationClass;
              cite.textContent = `[${idx}]`;
              frag.appendChild(cite);
            } else {
              // Not in references; keep as original parentheses
              frag.appendChild(document.createTextNode(m[0]));
            }
            lastIndex = regex.lastIndex;
          }
          const tail = text.slice(lastIndex);
          if (tail) frag.appendChild(document.createTextNode(tail));
          if (node.parentNode) {
            node.parentNode.replaceChild(frag, node);
          }
        }
      }

      node = walker.nextNode();
    }

    let output = root.innerHTML;
    // 4) Clean up leftover parenthetical site labels around citations, e.g.
    //    (bbc.co.uk [2]) -> [2]
    //    ([www.bbc.co.uk] [2]) -> [2]
    //    (https://example.com [3]) -> [3]
    const domainPart = String.raw`(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w\-./%?#=&+]*)?`;
    const citePart = String.raw`<a[^>]*class="citation"[^>]*>\[\d+\]<\/a>`;
    const patterns: RegExp[] = [
      new RegExp(String.raw`\(\s*(?:\[)?${domainPart}(?:\])?\s*(?:[,;:]?\s*)?(${citePart})\s*\)`, 'gi'),
      new RegExp(String.raw`\(\s*(${citePart})\s*(?:[,;:]?\s*)?(?:\[)?${domainPart}(?:\])?\s*\)`, 'gi'),
    ];
    patterns.forEach((re) => {
      output = output.replace(re, '$1');
    });
    // Collapse parentheses that contain only citations like: ([1], [2]) -> [1][2]
    const citeToken = String.raw`<a[^>]*class="citation"[^>]*>\[\d+\]<\/a>`;
    const citesOnly = new RegExp(String.raw`\(\s*((?:${citeToken}(?:\s*[,;]\s*)?)+)\s*\)`, 'gi');
    output = output.replace(citesOnly, (_m, inner) => inner.replace(/\s*[,;]\s*/g, ''));

    // Collapse immediately repeated identical citations: [2][2] -> [2]
    const dupCite = new RegExp(String.raw`(${citeToken})(?:\s*\1)+`, 'g');
    output = output.replace(dupCite, '$1');

    // Reduce any remaining double spaces introduced by replacements
    output = output.replace(/\s{2,}/g, ' ');
    return output;
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

      if (typeof data?.credits === 'number') {
        const credits = data.credits;
        setContext((prev) => (prev ? { ...prev, credits } : prev));
      }

      if (typeof data?.message === 'string') {
        setJobMessage(data.message);
      }

      if (typeof data?.jobId !== 'string' || !data.jobId) {
        throw new Error('Deep research job identifier missing in response.');
      }

      setSelectedLetterId(null);
      setActiveJobId(data.jobId);
      refreshLetters({ resume: false }).catch(() => {
        /* handled elsewhere */
      });
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

      <section className="card">
        <div className="container letter-history">
          <div className="letter-history-header">
            <h2 className="section-title">Saved letters</h2>
            <p className="section-sub">Return to previous drafts or resume an in-progress request.</p>
          </div>
          {lettersLoading ? (
            <p className="letter-history-loading">Loading your letters…</p>
          ) : lettersError ? (
            <p className="letter-history-error">{lettersError}</p>
          ) : letters.length === 0 ? (
            <p className="letter-history-empty">You haven&apos;t generated any letters yet.</p>
          ) : (
            <ul className="letter-history-list">
              {letters.map((item) => {
                const statusLabel = describeStatus(item.status);
                const updatedAtLabel = formatUpdatedAt(item.updatedAt);
                const itemClasses = [
                  'letter-history-item',
                  selectedLetterId === item.id ? 'active' : '',
                  activeJobId && item.jobId === activeJobId ? 'in-progress' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li key={item.id} className={itemClasses}>
                    <div className="letter-history-summary">{summarisePrompt(item.prompt)}</div>
                    <div className="letter-history-meta">
                      <span className="letter-history-status">{statusLabel}</span>
                      {updatedAtLabel && <span>{updatedAtLabel}</span>}
                      {item.mpName && <span>MP: {item.mpName}</span>}
                    </div>
                    {item.message && <p className="letter-history-message">{item.message}</p>}
                    <div className="letter-history-actions">
                      {item.status === 'completed' ? (
                        <button type="button" className="btn-secondary" onClick={() => viewLetter(item.id)}>
                          View letter
                        </button>
                      ) : item.status === 'failed' ? (
                        <button type="button" className="btn-secondary" onClick={() => viewLetter(item.id)}>
                          View details
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => resumeLetter(item.id)}
                          disabled={isGenerating && activeJobId === item.jobId}
                        >
                          Resume progress
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

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
