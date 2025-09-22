"use client";

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const ACTIVE_JOB_STORAGE_KEY = 'mpw-active-job';

type LetterSummary = {
  jobId: string;
  prompt: string;
  mpName?: string;
  constituency?: string;
  tone?: string;
  createdAt: number;
  updatedAt: number;
};

type LetterDetail = LetterSummary & {
  content: string;
};

type LetterMetadata = {
  jobId: string;
  prompt: string;
  mpName?: string;
  constituency?: string;
  tone?: string;
  createdAt: number;
  completedAt?: number | null;
  source: 'current' | 'history';
};

function getStoredActiveJobId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeActiveJobId(jobId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, jobId);
  } catch {
    // ignore storage errors
  }
}

function clearStoredActiveJobId() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function formatDisplayDate(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function resolveToneLabel(toneId?: string) {
  if (!toneId) return '';
  return TONES.find((item) => item.id === toneId)?.label ?? toneId;
}

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
  const [letterMetadata, setLetterMetadata] = useState<LetterMetadata | null>(null);
  const [history, setHistory] = useState<LetterSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshHistory = useCallback(async () => {
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/ai/letters', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Failed to load saved letters');
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        const mapped = data
          .map((item: any) => {
            if (!item || typeof item.jobId !== 'string') return null;
            const prompt = typeof item.prompt === 'string' ? item.prompt : '';
            const createdAtCandidate = Number(item.createdAt ?? item.updatedAt ?? Date.now());
            const updatedAtCandidate = Number(item.updatedAt ?? item.createdAt ?? createdAtCandidate);
            const createdAt = Number.isFinite(createdAtCandidate) ? createdAtCandidate : Date.now();
            const updatedAt = Number.isFinite(updatedAtCandidate) ? updatedAtCandidate : createdAt;
            const summary: LetterSummary = {
              jobId: item.jobId,
              prompt,
              mpName: typeof item.mpName === 'string' ? item.mpName : undefined,
              constituency: typeof item.constituency === 'string' ? item.constituency : undefined,
              tone: typeof item.tone === 'string' ? item.tone : undefined,
              createdAt,
              updatedAt,
            };
            return summary;
          })
          .filter((entry): entry is LetterSummary => Boolean(entry?.jobId));
        setHistory(mapped);
      } else {
        setHistory([]);
      }
    } catch {
      setHistoryError('We could not load your saved letters.');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

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
    refreshHistory().catch(() => {
      // errors handled inside refreshHistory
    });
  }, [refreshHistory]);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resumeJob = async (jobId: string) => {
      if (cancelled) return;
      setActiveJobId(jobId);
      setIsGenerating(true);
      setNotice(null);
      setJobMessage('Resuming your deep research request…');
      try {
        await pollJob(jobId);
      } catch {
        if (!cancelled) {
          clearJobPolling();
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
          clearStoredActiveJobId();
        }
      }
    };

    const existing = getStoredActiveJobId();
    if (existing) {
      void resumeJob(existing);
    } else {
      (async () => {
        try {
          const res = await fetch('/api/ai/jobs/active', {
            credentials: 'include',
            cache: 'no-store',
          });
          if (!res.ok) return;
          const data = await res.json();
          if (data && typeof data.jobId === 'string') {
            storeActiveJobId(data.jobId);
            await resumeJob(data.jobId);
          }
        } catch {
          // ignore connection issues
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [pollJob]);

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

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/ai/generate/${jobId}`, {
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('Failed to fetch job status');
        }

        const data = await res.json();

        if (typeof data?.credits === 'number') {
          setContext((prev) => (prev ? { ...prev, credits: data.credits } : prev));
        }

        if (typeof data?.prompt === 'string') {
          setIssue(data.prompt);
        }

        if (Array.isArray(data?.details)) {
          const mapped: Record<string, string> = {};
          for (const detail of data.details as any[]) {
            if (!detail || typeof detail.question !== 'string' || typeof detail.answer !== 'string') continue;
            const match = QUESTIONS.find((item) => item.prompt === detail.question);
            if (match) {
              mapped[match.id] = detail.answer;
            }
          }
          if (Object.keys(mapped).length > 0) {
            setAnswers((prev) => ({ ...prev, ...mapped }));
          }
        }

        if (typeof data?.tone === 'string' && TONES.some((item) => item.id === data.tone)) {
          setTone(data.tone);
        }

        if (typeof data?.message === 'string') {
          setJobMessage(data.message);
        }

        if (data?.status === 'completed' && typeof data?.content === 'string') {
          clearJobPolling();
          const html = normaliseLetterHtml(data.content);
          setLetter(enhanceCitations(html));
          const completedAt =
            typeof data?.completedAt === 'number'
              ? data.completedAt
              : typeof data?.updatedAt === 'number'
              ? data.updatedAt
              : Date.now();
          setLetterMetadata({
            jobId: data.jobId,
            prompt: typeof data.prompt === 'string' ? data.prompt : '',
            mpName: typeof data.mpName === 'string' ? data.mpName : undefined,
            constituency: typeof data.constituency === 'string' ? data.constituency : undefined,
            tone: typeof data.tone === 'string' ? data.tone : undefined,
            createdAt: completedAt,
            completedAt: typeof data.completedAt === 'number' ? data.completedAt : undefined,
            source: 'current',
          });
          setPhase('result');
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
          clearStoredActiveJobId();
          void refreshHistory();
          return;
        }

        if (data?.status === 'failed') {
          clearJobPolling();
          setError(data?.error || 'The AI service was unable to draft your letter just now.');
          setLetterMetadata(null);
          setIsGenerating(false);
          setActiveJobId(null);
          setJobMessage(null);
          clearStoredActiveJobId();
          return;
        }

        pollTimeoutRef.current = setTimeout(() => {
          pollJob(jobId).catch(() => {
            clearJobPolling();
            setError('We could not connect to the AI service. Please try again shortly.');
            setIsGenerating(false);
            setActiveJobId(null);
            setJobMessage(null);
            clearStoredActiveJobId();
          });
        }, 5000);
      } catch {
        clearJobPolling();
        setError('We could not connect to the AI service. Please try again shortly.');
        setLetterMetadata(null);
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        clearStoredActiveJobId();
      }
    },
    [refreshHistory],
  );

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
    // NEW: Strip inline citations/links from the body while preserving
    // the clickable References list at the bottom.
    {
      const root2 = document.createElement('div');
      root2.innerHTML = html;

      const heading2 = Array.from(root2.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((h) =>
        /^references\b/i.test((h.textContent || '').trim()),
      );
      const refsList2 = heading2
        ? (heading2.nextElementSibling && /^(ol|ul)$/i.test(heading2.nextElementSibling.tagName)
            ? (heading2.nextElementSibling as HTMLOListElement | HTMLUListElement)
            : (heading2.parentElement?.querySelector('ol,ul') as HTMLOListElement | HTMLUListElement | null))
        : null;

      const until2 = refsList2 as Node | null;
      const walker2 = document.createTreeWalker(root2, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node2: Node | null = walker2.nextNode();
      const urlLike2 = /^(?:https?:\/\/|www\.)/i;

      while (node2 && node2 !== until2) {
        if (node2.nodeType === Node.ELEMENT_NODE) {
          const el = node2 as Element;
          if (until2 && el === until2) break;
          if (el.matches('a[href]')) {
            const a = el as HTMLAnchorElement;
            // Remove the anchor entirely from the body
            a.replaceWith(document.createTextNode(''));
          }
        }

        if (node2 && node2.nodeType === Node.TEXT_NODE && (node2.parentElement && (!until2 || !until2.contains(node2)))) {
          let text = node2.textContent || '';
          const domainPart = String.raw`(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w\-./%?#=&+]*)?`;
          const parenWithUrl = new RegExp(String.raw`\(\s*(?:\[)?${domainPart}(?:\])?(?:\s*\[[0-9]+\])?\s*\)`, 'gi');
          text = text.replace(parenWithUrl, '');
          // Remove parenthetical Markdown links entirely: ([label](https://...))
          text = text.replace(/\(\s*\[[^\]]+\]\(https?:\/\/[^)\s]+\)\s*\)/gi, '');
          // Remove any inline Markdown links: [label](https://...)
          text = text.replace(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/gi, '');
          // Remove bracketed bare domains: [www.example.com] or [https://...]
          text = text.replace(/\[(?:https?:\/\/|www\.)[^\]]+\]/gi, '');
          // Remove [n] style citation markers (allowing spaces and NBSP inside)
          const citeNum = /(?:\s|\u00A0)*\[\s*\d+\s*\](?:[,.;:])?/g;
          text = text.replace(citeNum, '');
          text = text.replace(/\s{2,}/g, ' ');
          if (text !== (node2.textContent || '')) node2.textContent = text;
        }

        node2 = walker2.nextNode();
      }

      let output2 = root2.innerHTML;
      output2 = output2.replace(/\(\s*\)/g, '');
      output2 = output2.replace(/\s{2,}/g, ' ');
      return output2;
    }
    const root = document.createElement('div');
    root.innerHTML = html;

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
      clearStoredActiveJobId();
    }

    setIsGenerating(true);
    setError(null);
    setNotice(null);
    setLetter(null);
    setLetterMetadata(null);
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
        clearStoredActiveJobId();
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
      storeActiveJobId(data.jobId);
      pollJob(data.jobId).catch(() => {
        clearJobPolling();
        setError('We could not connect to the AI service. Please try again shortly.');
        setIsGenerating(false);
        setActiveJobId(null);
        setJobMessage(null);
        clearStoredActiveJobId();
      });
    } catch (err) {
      clearJobPolling();
      setError('We could not connect to the AI service. Please try again shortly.');
      setIsGenerating(false);
      setActiveJobId(null);
      setJobMessage(null);
      clearStoredActiveJobId();
    }
  }

  async function handleSelectLetter(jobId: string) {
    clearJobPolling();
    setIsGenerating(false);
    setActiveJobId(null);
    clearStoredActiveJobId();
    setJobMessage(null);
    setNotice(null);
    setError(null);

    try {
      const res = await fetch(`/api/ai/letters/${jobId}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Failed to load letter');
      }
      const data: LetterDetail = await res.json();
      if (!data || typeof data.content !== 'string') {
        throw new Error('Letter content missing');
      }
      const html = normaliseLetterHtml(data.content);
      setLetter(enhanceCitations(html));
      if (typeof data.prompt === 'string') {
        setIssue(data.prompt);
      }
      if (typeof data.tone === 'string' && TONES.some((item) => item.id === data.tone)) {
        setTone(data.tone);
      }
      const updatedTimestamp = Number(data.updatedAt);
      const createdTimestamp = Number(data.createdAt);
      const generatedAt = Number.isFinite(updatedTimestamp)
        ? updatedTimestamp
        : Number.isFinite(createdTimestamp)
        ? createdTimestamp
        : Date.now();
      setLetterMetadata({
        jobId: data.jobId,
        prompt: typeof data.prompt === 'string' ? data.prompt : '',
        mpName: typeof data.mpName === 'string' ? data.mpName : undefined,
        constituency: typeof data.constituency === 'string' ? data.constituency : undefined,
        tone: typeof data.tone === 'string' ? data.tone : undefined,
        createdAt: generatedAt,
        completedAt: Number.isFinite(updatedTimestamp) ? updatedTimestamp : undefined,
        source: 'history',
      });
      setPhase('result');
      setNotice('Loaded saved letter.');
      setTimeout(() => setNotice(null), 2000);
    } catch {
      setError('We could not load that saved letter. Please try again.');
      setTimeout(() => setError(null), 3000);
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
            {letterMetadata && (
              <div className="letter-meta">
                <p>
                  <strong>Generated:</strong> {formatDisplayDate(letterMetadata.createdAt)}
                </p>
                {letterMetadata.prompt && (
                  <p>
                    <strong>Issue:</strong> {letterMetadata.prompt}
                  </p>
                )}
                {(letterMetadata.mpName || letterMetadata.constituency) && (
                  <p>
                    <strong>MP:</strong>{' '}
                    {letterMetadata.mpName || 'Your MP'}
                    {letterMetadata.constituency ? ` — ${letterMetadata.constituency}` : ''}
                  </p>
                )}
                {letterMetadata.tone && (
                  <p>
                    <strong>Tone:</strong> {resolveToneLabel(letterMetadata.tone)}
                  </p>
                )}
                {letterMetadata.source === 'history' && (
                  <p>
                    <em>This draft was loaded from your saved letters.</em>
                  </p>
                )}
              </div>
            )}
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

      <section className="card">
        <div className="container saved-letters-section">
          <h2 className="section-title">Saved letters</h2>
          {historyLoading ? (
            <p>Loading your saved letters…</p>
          ) : historyError ? (
            <p className="error-text">{historyError}</p>
          ) : history.length === 0 ? (
            <p>You haven't generated any letters yet. Your drafts will appear here once ready.</p>
          ) : (
            <ul className="saved-letter-list">
              {history.map((item) => (
                <li key={item.jobId} className="saved-letter-item">
                  <div>
                    <h3>{item.prompt || 'Letter to your MP'}</h3>
                    <p className="saved-letter-meta">
                      {[
                        `Generated ${formatDisplayDate(item.updatedAt)}`,
                        item.mpName
                          ? `MP: ${item.mpName}${item.constituency ? ` (${item.constituency})` : ''}`
                          : null,
                        item.tone ? `Tone: ${resolveToneLabel(item.tone)}` : null,
                      ]
                        .filter((part): part is string => Boolean(part))
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="saved-letter-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleSelectLetter(item.jobId)}
                      disabled={isGenerating}
                    >
                      View letter
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

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
