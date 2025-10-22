"use client";

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { LetterViewer } from '../../features/writing-desk/components/LetterViewer';
import {
  useMyLettersQuery,
  type UseMyLettersQueryResult,
} from '../../features/my-letters/hooks/useMyLettersQuery';
import type { SavedLetterSummary } from '../../features/my-letters/api/listLetters';
import type { WritingDeskLetterTone } from '../../features/writing-desk/types';
import InfoTooltip from '../../components/InfoTooltip';

const TONE_LABELS: Record<string, string> = {
  formal: 'Formal',
  polite_but_firm: 'Polite but firm',
  empathetic: 'Empathetic',
  urgent: 'Urgent',
  neutral: 'Neutral',
  highly_persuasive: 'Highly persuasive',
};

const PAGE_SIZE = 10;

function toIsoDate(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function resolveToneLabel(summary: SavedLetterSummary): string {
  const tone = (summary.metadata?.tone ?? summary.tone) as WritingDeskLetterTone | null;
  if (!tone) {
    return 'Not specified';
  }
  return TONE_LABELS[tone] ?? tone;
}

function resolveDisplayDate(summary: SavedLetterSummary): string {
  return (
    toIsoDate(typeof summary.metadata?.date === 'string' ? summary.metadata.date : null) ??
    toIsoDate(summary.createdAt) ??
    new Date().toISOString().slice(0, 10)
  );
}

function resolveMpName(summary: SavedLetterSummary): string | null {
  const mpName = summary.metadata?.mpName;
  return typeof mpName === 'string' && mpName.trim().length > 0 ? mpName.trim() : null;
}

export default function MyLettersClient() {
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [pendingPageDirection, setPendingPageDirection] = useState<'next' | 'prev' | null>(null);

  const queryParams = useMemo(
    () => ({
      from: fromDate || undefined,
      to: toDate || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [fromDate, toDate, page],
  );

  const { items, meta, isLoading, isFetching, error, refetch }: UseMyLettersQueryResult = useMyLettersQuery(queryParams);

  useEffect(() => {
    if (!meta || meta.totalPages <= 0) {
      return;
    }
    if (page > meta.totalPages) {
      setPage(Math.max(1, meta.totalPages));
      setSelectedIndex(0);
      setPendingPageDirection(null);
    }
  }, [meta, page]);

  const letters = items;
  const hasLetters = letters.length > 0;
  const showEmpty = !isLoading && !isFetching && !hasLetters && !error;

  useEffect(() => {
    if (!hasLetters) {
      if (selectedIndex !== 0) {
        setSelectedIndex(0);
      }
      if (pendingPageDirection !== null) {
        setPendingPageDirection(null);
      }
      return;
    }

    if (pendingPageDirection === 'next') {
      if (selectedIndex !== 0) {
        setSelectedIndex(0);
      }
      setPendingPageDirection(null);
      return;
    }

    if (pendingPageDirection === 'prev') {
      const lastIndex = Math.max(letters.length - 1, 0);
      if (selectedIndex !== lastIndex) {
        setSelectedIndex(lastIndex);
      }
      setPendingPageDirection(null);
      return;
    }

    if (selectedIndex >= letters.length) {
      setSelectedIndex(Math.max(letters.length - 1, 0));
    }
  }, [hasLetters, letters.length, pendingPageDirection, selectedIndex]);

  const selectedLetter = letters[selectedIndex] ?? null;
  const selectedMpName = selectedLetter ? resolveMpName(selectedLetter) : null;
  const selectedToneLabel = selectedLetter ? resolveToneLabel(selectedLetter) : null;
  const selectedDisplayDate = selectedLetter ? resolveDisplayDate(selectedLetter) : null;
  const currentPage = Math.max(1, meta.page);

  const totalLetters = useMemo(() => {
    if (meta.totalItems > 0) {
      return meta.totalItems;
    }
    if (meta.totalPages > 1) {
      return meta.totalPages * meta.pageSize;
    }
    return letters.length;
  }, [letters.length, meta.pageSize, meta.totalItems, meta.totalPages]);

  const displayIndex = hasLetters ? (currentPage - 1) * meta.pageSize + selectedIndex + 1 : 0;

  const canGoPrevPage = meta.hasPrevious && currentPage > 1;
  const canGoNextPage = meta.hasNext && currentPage < meta.totalPages;
  const canGoPrevLetter = hasLetters && (selectedIndex > 0 || canGoPrevPage);
  const canGoNextLetter = hasLetters && (selectedIndex < letters.length - 1 || canGoNextPage);

  const arrowButtonStyle: CSSProperties = {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#bfdbfe',
    borderRadius: 9999,
    color: '#1d4ed8',
    cursor: 'pointer',
    fontSize: '1.5rem',
    fontWeight: 600,
    height: 56,
    width: 56,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s ease, transform 0.2s ease',
  };

  const disabledArrowStyle: CSSProperties = {
    backgroundColor: '#e5e7eb',
    borderColor: '#d1d5db',
    color: '#9ca3af',
    cursor: 'not-allowed',
  };

  const handlePreviousLetter = () => {
    if (!canGoPrevLetter) {
      return;
    }
    if (selectedIndex > 0) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (canGoPrevPage) {
      setPendingPageDirection('prev');
      setPage((prev) => Math.max(1, prev - 1));
    }
  };

  const handleNextLetter = () => {
    if (!canGoNextLetter) {
      return;
    }
    if (selectedIndex < letters.length - 1) {
      setSelectedIndex((prev) => Math.min(letters.length - 1, prev + 1));
      return;
    }
    if (canGoNextPage) {
      setPendingPageDirection('next');
      setPage((prev) => prev + 1);
    }
  };

  return (
    <main className="hero-section">
      <section className="card">
        <div className="container" style={{ paddingTop: 32, paddingBottom: 32 }}>
          <div style={{ maxWidth: 880, margin: '0 auto', width: '100%' }}>
            <header style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: '2rem', marginBottom: 8 }}>My letters</h1>
              <p style={{ color: '#4b5563', maxWidth: 640 }}>
                Browse, download, or copy the letters you&apos;ve previously drafted in the writing desk.
              </p>
            </header>

            <section aria-labelledby="filters-heading" style={{ marginBottom: 32 }}>
              <h2 id="filters-heading" style={{ fontSize: '1.25rem', marginBottom: 12 }}>
                Filter by date saved
              </h2>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 16,
                  alignItems: 'flex-end',
                }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    From
                    <InfoTooltip
                      content="Limit the list to drafts saved on or after this date."
                      label="From date filter info"
                      placement="top"
                      inlineHint={false}
                    />
                  </span>
                  <input
                    type="date"
                    value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                    setPage(1);
                    setSelectedIndex(0);
                    setPendingPageDirection(null);
                  }}
                    aria-label="Filter letters from date"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    To
                    <InfoTooltip
                      content="Show letters saved up to and including this date."
                      label="To date filter info"
                      placement="top"
                      inlineHint={false}
                    />
                  </span>
                  <input
                    type="date"
                    value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value);
                    setPage(1);
                    setSelectedIndex(0);
                    setPendingPageDirection(null);
                  }}
                    aria-label="Filter letters to date"
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                    setPage(1);
                    setSelectedIndex(0);
                    setPendingPageDirection(null);
                    void refetch();
                  }}
                  style={{ height: 40 }}
                >
                  Reset filters
                </button>
              </div>
            </section>

            {hasLetters && (
              <nav aria-label="Browse saved letters" style={{ marginBottom: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 24,
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={handlePreviousLetter}
                    disabled={!canGoPrevLetter}
                    aria-disabled={!canGoPrevLetter}
                    aria-label="View previous letter"
                    style={{
                      ...arrowButtonStyle,
                      ...(canGoPrevLetter ? {} : disabledArrowStyle),
                    }}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <div style={{ textAlign: 'center', minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                      Letter {displayIndex} of {Math.max(displayIndex, totalLetters)}
                    </div>
                    <div style={{ color: '#6b7280' }}>Page {currentPage} of {Math.max(1, meta.totalPages)}</div>
                  </div>
                  <InfoTooltip
                    content="Use the arrows to move between saved letters. We’ll automatically move to the next or previous page when you reach the end."
                    label="Letter navigation help"
                    placement="top"
                    inlineHint={false}
                  />
                  <button
                    type="button"
                    onClick={handleNextLetter}
                    disabled={!canGoNextLetter}
                    aria-disabled={!canGoNextLetter}
                    aria-label="View next letter"
                    style={{
                      ...arrowButtonStyle,
                      ...(canGoNextLetter ? {} : disabledArrowStyle),
                    }}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                </div>
              </nav>
            )}

            {isFetching && !isLoading && (
              <div role="status" aria-live="polite" style={{ marginBottom: 24 }}>
                Updating results…
              </div>
            )}

            {isLoading && (
              <div role="status" aria-live="polite" style={{ marginBottom: 24 }}>
                Loading your letters…
              </div>
            )}

            {error && (
              <div role="alert" style={{ marginBottom: 24, color: '#b91c1c' }}>
                {error.message || 'We could not load your saved letters. Please try again later.'}
              </div>
            )}

            {showEmpty && (
              <p style={{ marginBottom: 24, color: '#4b5563' }}>
                You haven&apos;t saved any letters yet. Draft one in the writing desk and save it to revisit it here.
              </p>
            )}

            {selectedLetter && (
              <article className="card" style={{ padding: 24 }}>
                <header style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: 4 }}>
                    {selectedMpName ? `Letter to ${selectedMpName}` : 'Drafted letter'}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, color: '#6b7280' }}>
                      Tone: {selectedToneLabel} · Saved on {selectedDisplayDate}
                    </p>
                    <InfoTooltip
                      content="Tone is recorded from the draft metadata. Recompose the letter in the writing desk if you need to change it."
                      label="Tone metadata details"
                      placement="top"
                      inlineHint={false}
                    />
                  </div>
                  {selectedLetter.responseId && (
                    <p style={{ margin: '4px 0 0', color: '#9ca3af', fontSize: '0.9rem' }}>
                      Reference ID: {selectedLetter.responseId}
                    </p>
                  )}
                </header>
                <LetterViewer letterHtml={selectedLetter.letterHtml} metadata={selectedLetter.metadata} />
              </article>
            )}

            {hasLetters && (
              <nav aria-label="Browse saved letters" style={{ marginTop: 32 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 24,
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={handlePreviousLetter}
                    disabled={!canGoPrevLetter}
                    aria-disabled={!canGoPrevLetter}
                    aria-label="View previous letter"
                    style={{
                      ...arrowButtonStyle,
                      ...(canGoPrevLetter ? {} : disabledArrowStyle),
                    }}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <div style={{ textAlign: 'center', minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                      Letter {displayIndex} of {Math.max(displayIndex, totalLetters)}
                    </div>
                    <div style={{ color: '#6b7280' }}>Page {currentPage} of {Math.max(1, meta.totalPages)}</div>
                  </div>
                  <InfoTooltip
                    content="Navigation arrows continue into the next or previous page when you reach the end of the current list."
                    label="Letter navigation help"
                    placement="top"
                    inlineHint={false}
                  />
                  <button
                    type="button"
                    onClick={handleNextLetter}
                    disabled={!canGoNextLetter}
                    aria-disabled={!canGoNextLetter}
                    aria-label="View next letter"
                    style={{
                      ...arrowButtonStyle,
                      ...(canGoNextLetter ? {} : disabledArrowStyle),
                    }}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                </div>
              </nav>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
