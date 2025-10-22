import { SavedLetterResource } from '../../writing-desk/api/letter';

export interface ListSavedLettersParams {
  startDate?: string | null;
  endDate?: string | null;
}

export interface ListSavedLettersResponse {
  letters: SavedLetterResource[];
  totalCount?: number;
}

function buildQueryString(params: ListSavedLettersParams): string {
  const searchParams = new URLSearchParams();
  if (params.startDate) {
    searchParams.set('startDate', params.startDate);
  }
  if (params.endDate) {
    searchParams.set('endDate', params.endDate);
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
    return { letters: data.letters, totalCount };
  }

  throw new Error('We could not load your saved letters. Please try again.');
}
