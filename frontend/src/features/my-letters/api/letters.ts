import { SavedLetterResource } from '../../writing-desk/api/letter';

/**
 * Fetch saved letters for the authenticated user via GET /api/user/saved-letters.
 * Supports optional date range filtering and pagination so the UI can navigate between pages.
 */
export interface ListSavedLettersParams {
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  pageSize?: number;
}

export interface ListSavedLettersResponse {
  letters: SavedLetterResource[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
}

function buildQueryString(params: ListSavedLettersParams): string {
  const searchParams = new URLSearchParams();
  if (params.startDate) {
    searchParams.set('startDate', params.startDate);
  }
  if (params.endDate) {
    searchParams.set('endDate', params.endDate);
  }
  if (typeof params.page === 'number') {
    searchParams.set('page', String(params.page));
  }
  if (typeof params.pageSize === 'number') {
    searchParams.set('pageSize', String(params.pageSize));
  }
  const query = searchParams.toString();
  return query.length > 0 ? `?${query}` : '';
}

export async function listSavedLetters(params: ListSavedLettersParams): Promise<ListSavedLettersResponse> {
  const res = await fetch(`/api/user/saved-letters${buildQueryString(params)}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const data = await res.json().catch(() => null);

  if (Array.isArray(data)) {
    return { letters: data };
  }

  if (data && Array.isArray(data.letters)) {
    const totalCount = typeof data.totalCount === 'number' ? data.totalCount : undefined;
    const page = typeof data.page === 'number' ? data.page : undefined;
    const pageSize = typeof data.pageSize === 'number' ? data.pageSize : undefined;
    return { letters: data.letters, totalCount, page, pageSize };
  }

  throw new Error('We could not load your saved letters. Please try again.');
}
