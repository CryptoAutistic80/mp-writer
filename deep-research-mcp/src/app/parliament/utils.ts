import { URL } from 'node:url';

type ParamValue = string | number | undefined;

type ParamRecord = Record<string, ParamValue>;

export const createUrl = (base: string, path?: string) => {
  const normalizedPath = path?.replace(/^\/+/, '') ?? '';
  return new URL(normalizedPath, base.endsWith('/') ? base : `${base}/`);
};

export const appendParams = (url: URL, params: ParamRecord) => {
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    url.searchParams.set(key, String(value));
  });
};
