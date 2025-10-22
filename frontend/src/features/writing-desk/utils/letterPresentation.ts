import { letterHtmlToPlainText } from './composeLetterHtml';

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

export const LETTER_HTML_FALLBACK = '<p>No content available.</p>';

export interface LetterDownloadMetadata {
  mpName?: string | null;
  date?: string | null;
}

export function normaliseLetterHtml(letterHtml?: string | null): string {
  if (typeof letterHtml !== 'string') {
    return LETTER_HTML_FALLBACK;
  }
  const trimmed = letterHtml.trim();
  return trimmed.length > 0 ? trimmed : LETTER_HTML_FALLBACK;
}

export function createLetterDocumentBodyHtml(letterHtml?: string | null): string {
  return `<div class="letter-document">${normaliseLetterHtml(letterHtml)}</div>`;
}

export function createLetterDocxHtml(letterHtml?: string | null): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
${LETTER_DOCUMENT_CSS}
</style>
</head>
<body>
${createLetterDocumentBodyHtml(letterHtml)}
</body>
</html>`;
}

export function resolveLetterDownloadFilename(
  metadata: LetterDownloadMetadata | null | undefined,
  extension: 'pdf' | 'docx',
): string {
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
}

export function triggerLetterBlobDownload(blob: Blob, filename: string) {
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
}

export async function copyLetterToClipboard(letterHtml: string): Promise<void> {
  const safeHtml = normaliseLetterHtml(letterHtml);

  try {
    if (
      typeof window !== 'undefined' &&
      'ClipboardItem' in window &&
      navigator.clipboard &&
      'write' in navigator.clipboard
    ) {
      const htmlBlob = new Blob([safeHtml], { type: 'text/html' });
      const plainText = letterHtmlToPlainText(safeHtml);
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      const item = new (window as any).ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
      await (navigator.clipboard as any).write([item]);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(letterHtmlToPlainText(safeHtml));
      return;
    }

    throw new Error('Clipboard API not available');
  } catch (initialError) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(letterHtmlToPlainText(safeHtml));
        return;
      }
    } catch {
      // Ignore nested failure and rethrow original error below.
    }

    if (initialError instanceof Error) {
      throw initialError;
    }
    throw new Error('Unable to copy letter content');
  }
}

export async function downloadLetterAsDocx(letterHtml: string, metadata: LetterDownloadMetadata | null | undefined) {
  if (typeof window === 'undefined') return;
  const htmlDocxModule = await import('html-docx-js/dist/html-docx.js');
  const htmlDocx = (htmlDocxModule.default ?? htmlDocxModule) as { asBlob: (input: string) => Blob };
  const blob = htmlDocx.asBlob(createLetterDocxHtml(letterHtml));
  triggerLetterBlobDownload(blob, resolveLetterDownloadFilename(metadata, 'docx'));
}

export async function downloadLetterAsPdf(
  letterHtml: string,
  metadata: LetterDownloadMetadata | null | undefined,
): Promise<void> {
  if (typeof window === 'undefined') return;

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
    container.innerHTML = `<style>${LETTER_DOCUMENT_CSS}</style>${createLetterDocumentBodyHtml(letterHtml)}`;
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
        filename: resolveLetterDownloadFilename(metadata, 'pdf'),
        pagebreak: { mode: ['css', 'legacy'] },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(target)
      .save();
  } finally {
    if (appended && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
