"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IssueDetailsForm from './IssueDetailsForm';
import RefinementPreview from './RefinementPreview';
import ResearchResultPanel from './ResearchResultPanel';

type WritingSession = {
  id: string;
  status: 'draft' | 'refined' | 'researching' | 'completed' | 'failed';
  issueBrief: string;
  refinement: {
    summary: string;
    keyPoints: string[];
    toneSuggestions: string[];
    followUpQuestions?: string[];
    model?: string | null;
  } | null;
  research: {
    letterBody: string;
    citations: { label: string; url?: string; note?: string }[];
    rawOutput?: string;
  } | null;
  mpSnapshot: any;
  addressSnapshot: any;
  refinementModel?: string | null;
  researchModel?: string | null;
  researchCompletedAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
};

type UserMp = {
  constituency?: string;
  mp?: {
    name?: string;
    party?: string;
    parliamentaryAddress?: string;
  } | null;
} | null;

type UserAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode?: string;
} | null;

const MIN_CHARACTERS = 200;
const MAX_CHARACTERS = 5000;

export default function WritingDeskClient() {
  const [issueBrief, setIssueBrief] = useState('');
  const [issueError, setIssueError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [currentSession, setCurrentSession] = useState<WritingSession | null>(null);
  const [currentStep, setCurrentStep] = useState<'issue' | 'refinement' | 'research'>('issue');
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [mpDoc, setMpDoc] = useState<UserMp>(null);
  const [addressDoc, setAddressDoc] = useState<UserAddress>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const readyForResearch = Boolean(mpDoc?.constituency) && Boolean(addressDoc);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/writing-sessions?limit=20', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as WritingSession[];
      setHistoryCount(data.filter((item) => item.status === 'completed').length);
      setSessionsLoaded(true);
    } catch {
      // ignore history failures silently
    }
  }, []);

  const loadContext = useCallback(async () => {
    setContextLoading(true);
    setContextError(null);
    try {
      const [mpRes, addressRes] = await Promise.all([
        fetch('/api/user/mp', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/user/address', { credentials: 'include', cache: 'no-store' }),
      ]);

      if (mpRes.ok) {
        const mp = await mpRes.json();
        setMpDoc(mp);
      } else if (mpRes.status !== 404) {
        throw new Error('Unable to load your saved MP.');
      }

      if (addressRes.ok) {
        const { address } = await addressRes.json();
        setAddressDoc(address ?? null);
      } else if (addressRes.status !== 404) {
        throw new Error('Unable to load your saved address.');
      }

      await fetchHistory();
    } catch (error: any) {
      setContextError(error?.message ?? 'We could not load your account information.');
    } finally {
      setContextLoading(false);
    }
  }, [fetchHistory]);

  useEffect(() => {
    void loadContext();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [loadContext]);

  const parseError = useCallback(async (response: Response) => {
    try {
      const payload = await response.json();
      if (Array.isArray(payload?.message)) {
        return String(payload.message[0]);
      }
      if (typeof payload?.message === 'string') {
        return payload.message;
      }
    } catch {}
    return response.statusText || 'Request failed';
  }, []);

  const submitRefinement = useCallback(async (overrideBrief?: string) => {
    const nextBrief = typeof overrideBrief === 'string' ? overrideBrief : issueBrief;
    const trimmed = nextBrief.trim();
    setIssueBrief(nextBrief);
    if (trimmed.length < MIN_CHARACTERS) {
      setIssueError(`Please provide at least ${MIN_CHARACTERS} characters so we have enough detail.`);
      return;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIssueError(null);
    setIsRefining(true);
    setResearchError(null);

    try {
      const res = await fetch('/api/writing-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ brief: nextBrief }),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      const session = (await res.json()) as WritingSession;
      setCurrentSession(session);
      setIssueBrief(session.issueBrief ?? nextBrief);
      setCurrentStep('refinement');
      setCopyStatus('idle');
      await fetchHistory();
    } catch (error: any) {
      setIssueError(error?.message ?? 'We could not refine your brief. Please try again.');
    } finally {
      setIsRefining(false);
    }
  }, [issueBrief, parseError, fetchHistory]);

  const startPolling = useCallback((sessionId: string) => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/writing-sessions/${sessionId}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const session = (await res.json()) as WritingSession;
        setCurrentSession(session);
        if (session.status === 'completed') {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setResearchLoading(false);
          setResearchError(null);
          setCopyStatus('idle');
          setCurrentStep('research');
          await fetchHistory();
        }
        if (session.status === 'failed') {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setResearchLoading(false);
          setResearchError(session.errorMessage ?? 'Deep research failed. Please try again.');
        }
      } catch {
        // ignore transient polling errors
      }
    }, 2500);
  }, [fetchHistory]);

  const handleRunResearch = useCallback(async () => {
    if (!currentSession) return;
    setResearchError(null);
    setCopyStatus('idle');
    setResearchLoading(true);
    setCurrentStep('research');
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setCurrentSession((prev) => (prev ? { ...prev, status: 'researching' } : prev));

    try {
      const res = await fetch(`/api/writing-sessions/${currentSession.id}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ force: currentSession.research ? true : undefined }),
      });
      if (!res.ok) {
        throw new Error(await parseError(res));
      }
      const session = (await res.json()) as WritingSession;
      setCurrentSession(session);
      if (session.status === 'researching') {
        startPolling(session.id);
      } else {
        setResearchLoading(false);
        if (session.status === 'completed') {
          setResearchError(null);
          setCopyStatus('idle');
          setCurrentStep('research');
          await fetchHistory();
        }
        if (session.status === 'failed') {
          setResearchError(session.errorMessage ?? 'Deep research failed. Please try again.');
        }
      }
    } catch (error: any) {
      setResearchLoading(false);
      setResearchError(error?.message ?? 'We could not run deep research. Please try again.');
    }
  }, [currentSession, parseError, startPolling, fetchHistory]);

  const handleCopy = useCallback(async () => {
    if (!currentSession?.research?.letterBody) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentSession.research.letterBody);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = currentSession.research.letterBody;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('idle');
      setResearchError('We copied part of the letter, but please double check it pasted correctly.');
    }
  }, [currentSession]);

  const mpSummary = useMemo(() => {
    if (!mpDoc) return 'No MP saved yet.';
    const mpName = mpDoc.mp?.name ?? 'Member of Parliament';
    const party = mpDoc.mp?.party ? ` · ${mpDoc.mp.party}` : '';
    return `${mpName}${party}${mpDoc.constituency ? ` — ${mpDoc.constituency}` : ''}`;
  }, [mpDoc]);

  const addressSummary = useMemo(() => {
    if (!addressDoc) return 'No address saved yet.';
    const parts = [addressDoc.line1, addressDoc.line2, addressDoc.city, addressDoc.county, addressDoc.postcode]
      .map((part) => (part ? String(part).trim() : ''))
      .filter((part) => part.length > 0);
    return parts.join(', ');
  }, [addressDoc]);

  return (
    <>
      <section className="card">
        <div className="container" style={{ display: 'grid', gap: 20 }}>
          <header className="section-header">
            <div>
              <h1 className="section-title">Writing desk</h1>
              <p className="section-sub">Describe your issue, refine the key points, then run deep research to draft your letter.</p>
            </div>
            <div className="header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {sessionsLoaded && (
                <span style={{ background: '#eef2ff', color: '#312e81', padding: '6px 12px', borderRadius: 999, fontSize: 13 }}>
                  Completed letters: {historyCount}
                </span>
              )}
            </div>
          </header>

          {contextLoading ? (
            <p style={{ margin: '16px 0' }}>Loading your saved MP and address…</p>
          ) : (
            <div className="status" style={{ background: '#f9fafb', borderRadius: 12, padding: 16, display: 'grid', gap: 8 }}>
              <div>
                <strong>Your MP</strong>
                <p style={{ margin: '4px 0 0 0' }}>{mpSummary}</p>
              </div>
              <div>
                <strong>Your address</strong>
                <p style={{ margin: '4px 0 0 0' }}>{addressSummary}</p>
              </div>
              {!readyForResearch && (
                <p style={{ margin: '8px 0 0 0', color: '#b91c1c' }}>
                  Save both an MP and mailing address on your <Link href="/dashboard" className="link">dashboard</Link> before running deep research.
                </p>
              )}
            </div>
          )}

          {contextError && (
            <div className="status" aria-live="assertive" style={{ color: '#b91c1c' }}>
              {contextError}
            </div>
          )}

          {(currentStep === 'issue' || !currentSession) && (
            <IssueDetailsForm
              value={issueBrief}
              minCharacters={MIN_CHARACTERS}
              maxCharacters={MAX_CHARACTERS}
              loading={isRefining}
              error={issueError}
              onChange={(value) => {
                setIssueBrief(value);
                if (issueError) setIssueError(null);
              }}
              onSubmit={() => void submitRefinement()}
            />
          )}

          {currentSession && currentStep !== 'issue' && currentSession.refinement && (
            <div style={{ marginTop: 8 }}>
              {researchError && (
                <div className="status" aria-live="assertive" style={{ marginBottom: 12, color: '#b91c1c' }}>
                  {researchError}
                </div>
              )}
              <RefinementPreview
                refinement={currentSession.refinement}
                onEdit={() => {
                  setCurrentStep('issue');
                  setIssueBrief(currentSession.issueBrief);
                }}
                onReRun={() => void submitRefinement(currentSession.issueBrief)}
                onRunResearch={() => void handleRunResearch()}
                researchDisabled={!readyForResearch}
                researchLoading={researchLoading || currentSession.status === 'researching'}
              />
            </div>
          )}

          {currentSession && currentSession.status === 'researching' && (
            <div className="status" aria-live="polite" style={{ color: '#2563eb' }}>
              We&apos;re gathering evidence and drafting your letter. This can take up to a couple of minutes.
            </div>
          )}

          {currentSession && currentSession.research && currentSession.status === 'completed' && (
            <ResearchResultPanel
              letterBody={currentSession.research.letterBody}
              citations={currentSession.research.citations ?? []}
              mpSnapshot={currentSession.mpSnapshot}
              addressSnapshot={currentSession.addressSnapshot}
              researchModel={currentSession.researchModel}
              updatedAt={currentSession.researchCompletedAt ?? currentSession.updatedAt}
              onCopyLetter={() => void handleCopy()}
              copyStatus={copyStatus}
            />
          )}
        </div>
      </section>
    </>
  );
}
