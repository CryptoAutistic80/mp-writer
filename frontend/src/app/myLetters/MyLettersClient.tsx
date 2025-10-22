"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listSavedLetters } from '../../features/my-letters/api/letters';
import { SavedLetterResource } from '../../features/writing-desk/api/letter';
import {
  copyLetterToClipboard,
  downloadLetterAsDocx,
  downloadLetterAsPdf,
  normaliseLetterHtml,
} from '../../features/writing-desk/utils/letterPresentation';

type CopyState = 'idle' | 'copied' | 'error';

const DEFAULT_DATE_RANGE_DAYS = 30;

function formatDateInput(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateTimeDisplay(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function sortLettersDescending(letters: SavedLetterResource[]): SavedLetterResource[] {
  return [...letters].sort((a, b) => {
    const aTime = new Date(a.createdAt ?? 0).getTime();
    const bTime = new Date(b.createdAt ?? 0).getTime();
    return bTime - aTime;
  });
}

function formatToneLabel(tone: string | null | undefined): string | null {
  if (!tone) return null;
  return tone
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function MyLettersClient() {
  const today = useMemo(() => new Date(), []);
  const defaultEndDate = useMemo(() => formatDateInput(today), [today]);
  const defaultStartDate = useMemo(
    () => formatDateInput(addDays(today, -DEFAULT_DATE_RANGE_DAYS)),
    [today],
  );

  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [endDate, setEndDate] = useState<string>(defaultEndDate);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);

  const isRangeValid = useMemo(() => {
    if (!startDate || !endDate) return true;
    return startDate <= endDate;
  }, [startDate, endDate]);

  const queryKey = useMemo(() => ['myLetters', { startDate, endDate }], [startDate, endDate]);

  const savedLettersQuery = useQuery({
    queryKey,
    queryFn: () => listSavedLetters({ startDate, endDate }),
    enabled: isRangeValid,
    keepPreviousData: true,
  });

  const letters = useMemo(() => {
    const items = savedLettersQuery.data?.letters;
    if (!Array.isArray(items)) {
      return [] as SavedLetterResource[];
    }
    return sortLettersDescending(items);
  }, [savedLettersQuery.data]);

  const currentLetter = letters[currentIndex] ?? null;
  const totalLetters = letters.length;
  const todayIso = useMemo(() => formatDateInput(today), [today]);
  const savedTimestamp = useMemo(() => {
    if (!currentLetter) return '';
    return formatDateTimeDisplay(currentLetter.updatedAt || currentLetter.createdAt);
  }, [currentLetter]);
  const toneLabel = useMemo(() => formatToneLabel(currentLetter?.metadata?.tone ?? null), [currentLetter]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [startDate, endDate]);

  useEffect(() => {
    if (currentIndex > 0 && currentIndex > totalLetters - 1) {
      setCurrentIndex(totalLetters > 0 ? totalLetters - 1 : 0);
    }
  }, [currentIndex, totalLetters]);

  useEffect(() => {
    setCopyState('idle');
    setIsDownloadingDocx(false);
    setIsDownloadingPdf(false);
  }, [currentIndex]);

  const handleStartDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setStartDate(event.target.value);
  }, []);

  const handleEndDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEndDate(event.target.value);
  }, []);

  const handleCopyLetter = useCallback(async () => {
    if (!currentLetter?.letterHtml) {
      setCopyState('error');
      return;
    }
    try {
      await copyLetterToClipboard(currentLetter.letterHtml);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }, [currentLetter]);

  const handleDownloadPdf = useCallback(async () => {
    if (!currentLetter) return;
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      await downloadLetterAsPdf(normaliseLetterHtml(currentLetter.letterHtml), currentLetter.metadata);
    } catch (error) {
      console.error('Failed to prepare PDF download', error);
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [currentLetter, isDownloadingPdf]);

  const handleDownloadDocx = useCallback(async () => {
    if (!currentLetter) return;
    if (isDownloadingDocx) return;
    setIsDownloadingDocx(true);
    try {
      await downloadLetterAsDocx(normaliseLetterHtml(currentLetter.letterHtml), currentLetter.metadata);
    } catch (error) {
      console.error('Failed to prepare DOCX download', error);
    } finally {
      setIsDownloadingDocx(false);
    }
  }, [currentLetter, isDownloadingDocx]);

  const goToFirst = useCallback(() => {
    setCurrentIndex(0);
  }, []);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, Math.max(totalLetters - 1, 0)));
  }, [totalLetters]);

  const goToLast = useCallback(() => {
    if (totalLetters === 0) {
      setCurrentIndex(0);
    } else {
      setCurrentIndex(totalLetters - 1);
    }
  }, [totalLetters]);

  const references = useMemo(() => {
    if (!Array.isArray(currentLetter?.metadata?.references)) {
      return [];
    }
    return currentLetter.metadata.references.filter(
      (ref): ref is string => typeof ref === 'string' && ref.trim().length > 0,
    );
  }, [currentLetter]);

  const copyLabel = useMemo(() => {
    if (copyState === 'copied') return 'Copied!';
    if (copyState === 'error') return 'Copy failed — try again';
    return 'Copy for email';
  }, [copyState]);

  const isLoading = savedLettersQuery.isLoading || savedLettersQuery.isFetching;
  const error = savedLettersQuery.error;
  const errorMessage = useMemo(() => {
    if (!error) return null;
    return error instanceof Error ? error.message : 'We could not load your saved letters. Please try again.';
  }, [error]);

  const showEmptyState = !isLoading && totalLetters === 0 && isRangeValid && !errorMessage;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="container">
        <header style={{ marginBottom: 16 }}>
          <div className="section-header">
            <div>
              <h2 className="section-title">My letters</h2>
              <p className="section-sub">Browse the letters you&apos;ve saved from the writing desk.</p>
            </div>
          </div>
        </header>

        <div
          className="card"
          style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}
          aria-label="Filter saved letters by date range"
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem', minWidth: 180 }}>
              <span style={{ marginBottom: 4, fontWeight: 600 }}>From</span>
              <input
                type="date"
                value={startDate}
                max={endDate || todayIso}
                onChange={handleStartDateChange}
                className="input"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem', minWidth: 180 }}>
              <span style={{ marginBottom: 4, fontWeight: 600 }}>To</span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                max={todayIso}
                onChange={handleEndDateChange}
                className="input"
              />
            </label>
          </div>
          {!isRangeValid && (
            <p role="alert" aria-live="polite" style={{ margin: 0, color: '#b91c1c' }}>
              The start date must be on or before the end date.
            </p>
          )}
        </div>

        {isLoading && (
          <p style={{ marginTop: 16 }} role="status" aria-live="polite">
            Loading your saved letters…
          </p>
        )}

        {errorMessage && (
          <p role="alert" aria-live="polite" style={{ marginTop: 16, color: '#b91c1c' }}>
            {errorMessage}
          </p>
        )}

        {showEmptyState && (
          <div className="card" style={{ padding: 16 }}>
            <p style={{ margin: 0 }}>You don&apos;t have any saved letters for this date range yet.</p>
          </div>
        )}

        {isRangeValid && currentLetter && (
          <div className="card" style={{ padding: 16, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{currentLetter.metadata?.mpName || 'MP letter'}</h3>
                <p style={{ margin: '4px 0 0 0', color: '#6b7280' }}>
                  Saved {savedTimestamp || '—'}
                  {toneLabel ? ` · Tone: ${toneLabel}` : ''}
                  {currentLetter.metadata?.date ? ` · Letter date: ${currentLetter.metadata.date}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={goToFirst}
                  disabled={totalLetters <= 1 || currentIndex === 0}
                  aria-label="Go to first letter"
                >
                  «
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={goToPrevious}
                  disabled={totalLetters <= 1 || currentIndex === 0}
                  aria-label="Go to previous letter"
                >
                  ‹
                </button>
                <span style={{ fontSize: '0.9rem' }}>
                  Letter {currentIndex + 1} of {totalLetters}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={goToNext}
                  disabled={totalLetters <= 1 || currentIndex >= totalLetters - 1}
                  aria-label="Go to next letter"
                >
                  ›
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={goToLast}
                  disabled={totalLetters <= 1 || currentIndex >= totalLetters - 1}
                  aria-label="Go to last letter"
                >
                  »
                </button>
              </div>
            </div>

            <div
              className="letter-preview"
              dangerouslySetInnerHTML={{ __html: normaliseLetterHtml(currentLetter.letterHtml) }}
            />

            <div
              className="actions"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}
            >
              <button type="button" className="btn-primary" onClick={handleCopyLetter}>
                {copyLabel}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
                aria-busy={isDownloadingPdf}
              >
                {isDownloadingPdf ? 'Preparing PDF…' : 'Download PDF'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleDownloadDocx}
                disabled={isDownloadingDocx}
                aria-busy={isDownloadingDocx}
              >
                {isDownloadingDocx ? 'Preparing DOCX…' : 'Download DOCX'}
              </button>
            </div>

            {references.length > 0 && (
              <div>
                <h4 style={{ margin: '8px 0', fontSize: '0.95rem' }}>References included</h4>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {references.map((ref) => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
