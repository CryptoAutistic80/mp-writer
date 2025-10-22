"use client";

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import InfoTooltip from '../../../components/InfoTooltip';
import { letterHtmlToPlainText } from '../utils/composeLetterHtml';
import type { WritingDeskLetterPayload } from '../types';

export const LETTER_DOCUMENT_CSS = `
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

export type LetterViewerMetadata = Pick<
  WritingDeskLetterPayload,
  'mpName' | 'date' | 'tone' | 'references' | 'responseId'
> &
  Partial<WritingDeskLetterPayload>;

export interface LetterViewerProps {
  letterHtml?: string | null;
  metadata?: Partial<LetterViewerMetadata> | null;
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'error';

export function LetterViewer({
  letterHtml,
  metadata,
  leadingActions,
  trailingActions,
  className,
}: LetterViewerProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);

  const letterHtmlForExport = useMemo(() => {
    if (typeof letterHtml !== 'string' || letterHtml.trim().length === 0) {
      return '<p>No content available.</p>';
    }
    return letterHtml;
  }, [letterHtml]);

  useEffect(() => {
    setCopyState('idle');
  }, [letterHtmlForExport]);

  const letterDocumentBodyHtml = useMemo(
    () => `<div class="letter-document">${letterHtmlForExport}</div>`,
    [letterHtmlForExport],
  );

  const letterDocxHtml = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${LETTER_DOCUMENT_CSS}</style></head><body>${letterDocumentBodyHtml}</body></html>`,
    [letterDocumentBodyHtml],
  );

  const resolveDownloadFilename = useCallback(
    (extension: 'pdf' | 'docx') => {
      const mpName = typeof metadata?.mpName === 'string' ? metadata.mpName.trim() : '';
      const dateValue =
        typeof metadata?.date === 'string' && metadata.date.trim().length > 0
          ? metadata.date.trim()
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
    [metadata?.date, metadata?.mpName],
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

  const handleCopy = useCallback(async () => {
    if (!letterHtmlForExport) {
      setCopyState('error');
      return;
    }

    try {
      if (
        typeof window !== 'undefined' &&
        'ClipboardItem' in window &&
        navigator.clipboard &&
        'write' in navigator.clipboard
      ) {
        const htmlBlob = new Blob([letterHtmlForExport], { type: 'text/html' });
        const plainText = letterHtmlToPlainText(letterHtmlForExport);
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        const item = new (window as any).ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
        await (navigator.clipboard as any).write([item]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(letterHtmlToPlainText(letterHtmlForExport));
      } else {
        throw new Error('Clipboard API not available');
      }
      setCopyState('copied');
    } catch (error) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(letterHtmlToPlainText(letterHtmlForExport));
          setCopyState('copied');
          return;
        }
      } catch {
        // ignore nested failure
      }
      setCopyState('error');
    }
  }, [letterHtmlForExport]);

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
    <div className={className}>
      <div className="letter-preview" dangerouslySetInnerHTML={{ __html: letterHtmlForExport }} />
      <div
        className="actions"
        style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {leadingActions}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <button type="button" className="btn-primary" onClick={handleCopy}>
            {copyState === 'copied'
              ? 'Copied!'
              : copyState === 'error'
                ? 'Copy failed — try again'
                : 'Copy for email'}
          </button>
          <InfoTooltip
            content="Copies both the formatted letter and plain text to your clipboard when supported."
            label="Copy export details"
            placement="top"
            inlineHint={false}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf}
            aria-busy={isDownloadingPdf}
          >
            {isDownloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <InfoTooltip
            content="Generates a PDF in the background — stay on the page until the download starts."
            label="PDF download info"
            placement="top"
            inlineHint={false}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleDownloadDocx}
            disabled={isDownloadingDocx}
            aria-busy={isDownloadingDocx}
          >
            {isDownloadingDocx ? 'Preparing DOCX...' : 'Download DOCX'}
          </button>
          <InfoTooltip
            content="Creates a Word-friendly DOCX file — generation can take a few seconds before the download begins."
            label="DOCX download info"
            placement="top"
            inlineHint={false}
          />
        </div>
        {trailingActions}
      </div>
    </div>
  );
}
