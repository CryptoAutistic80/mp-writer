"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Lookup = {
  constituency: string;
  mp?: {
    id?: number;
    name?: string;
    party?: string;
    portraitUrl?: string;
    since?: string;
    email?: string;
    twitter?: string;
    website?: string;
    parliamentaryAddress?: string;
  } | null;
};

type MpFetchProps = {
  onPostcodeChange?: (postcode: string) => void;
};

export default function MpFetch({ onPostcodeChange }: MpFetchProps) {
  const [postcode, setPostcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Lookup | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  const normalized = useMemo(() => postcode.replace(/\s+/g, '').toUpperCase(), [postcode]);
  const valid = useMemo(() => /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(normalized), [normalized]);

  const doLookup = useCallback(async () => {
    setError(null);
    setData(null);
    if (!valid) {
      setError('Please enter a valid UK postcode.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/mps/lookup?postcode=${encodeURIComponent(postcode)}`, { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => 'Lookup failed');
        throw new Error(text || 'Lookup failed');
      }
      const json = (await res.json()) as Lookup;
      setData(json);
      // Try to persist for signed-in users; ignore failures
      try {
        await fetch('/api/user/mp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ constituency: json.constituency, mp: json.mp ?? null }),
        });
      } catch {}
    } catch {
      setError('We couldn\'t find a match for that postcode.');
    } finally {
      setLoading(false);
    }
  }, [postcode, valid]);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await doLookup();
  }, [doLookup]);

  // On mount, attempt to load any saved MP for the current user
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/mp', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return; // likely unauthenticated or none saved
        const doc = await res.json();
        if (!cancelled && doc && (doc.constituency || doc.mp)) {
          setData({ constituency: doc.constituency, mp: doc.mp });
        }
      } catch {
        // ignore errors silently
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container">
      <div className="section-header">
        <div>
          <h2 id="find-mp-heading" className="section-title">Find your MP</h2>
          <p className="section-sub">Enter your UK postcode to look up your constituency MP.</p>
        </div>
        {(data || !data) && (
          <div className="header-actions">
            {data ? (
              <button
                type="button"
                className="btn-primary btn-wide"
                onClick={() => {
                  setError(null);
                  // Clear saved MP server-side if present; ignore result
                  fetch('/api/user/mp', { method: 'DELETE', credentials: 'include' }).catch(() => {});
                  setData(null);
                  setPostcode('');
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                Change my MP
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary btn-wide"
                disabled={!valid || loading}
                aria-busy={loading}
                onClick={() => { void doLookup(); }}
              >
                {loading ? 'Finding…' : 'Find my MP'}
              </button>
            )}
          </div>
        )}
      </div>

      <form
        className={`form-grid ${data ? 'single' : ''}`}
        aria-labelledby="find-mp-heading"
        onSubmit={onSubmit}
      >
        {!data && (
          <div className="field">
            <label htmlFor="postcode" className="label">Postcode</label>
            <input
              ref={inputRef}
              id="postcode"
              name="postcode"
              inputMode="text"
              autoComplete="postal-code"
              placeholder="e.g. SW1A 1AA"
              className="input"
              value={postcode}
              onChange={(e) => {
                const v = e.target.value;
                setPostcode(v);
                try { onPostcodeChange?.(v); } catch {}
              }}
              disabled={loading}
              aria-invalid={!valid && postcode.length > 0}
            />
          </div>
        )}

        {/* No inline actions; button lives in the section header */}

        {error && (
          <div className="status" aria-live="polite">
            <p style={{ color: '#b91c1c', marginTop: 10 }}>{error}</p>
          </div>
        )}

        <div className="result" aria-live="polite">
          {data && (
            <article className="mp-card">
              {data.mp?.portraitUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.mp.portraitUrl} alt="" className="mp-portrait" />
              )}
              <div className="mp-body">
                <header>
                  <div className="mp-name">{data.mp?.name ?? 'Member of Parliament'}</div>
                  <div className="mp-meta">{data.constituency} · {data.mp?.party ?? 'Party'}{data.mp?.since ? ` · MP since ${new Date(data.mp.since).getFullYear()}` : ''}</div>
                </header>
                {(data.mp?.email || data.mp?.twitter || data.mp?.website) && (
                  <ul className="mp-links">
                    {data.mp?.email && (
                      <li>
                        <button
                          type="button"
                          className="mp-email"
                          aria-label={`Copy email ${data.mp.email}`}
                          onClick={async () => {
                            try {
                              if (navigator?.clipboard?.writeText) {
                                await navigator.clipboard.writeText(data.mp!.email!);
                              } else {
                                const el = document.createElement('textarea');
                                el.value = data.mp!.email!;
                                el.style.position = 'fixed';
                                el.style.opacity = '0';
                                document.body.appendChild(el);
                                el.focus();
                                el.select();
                                document.execCommand('copy');
                                document.body.removeChild(el);
                              }
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            } catch {
                              // ignore copy errors silently
                            }
                          }}
                        >
                          {data.mp.email}
                        </button>
                        {copied && <span className="copy-hint" aria-live="polite">Copied</span>}
                      </li>
                    )}
                    {data.mp?.twitter && (
                      <li><a target="_blank" rel="noreferrer" href={`https://twitter.com/${data.mp.twitter.replace(/^@/, '')}`}>Twitter</a></li>
                    )}
                    {data.mp?.website && (
                      <li><a target="_blank" rel="noreferrer" href={data.mp.website}>Website</a></li>
                    )}
                  </ul>
                )}
                {data.mp?.parliamentaryAddress && (
                  <p className="mp-address">{data.mp.parliamentaryAddress}</p>
                )}
              </div>
            </article>
          )}
        </div>
      </form>
    </div>
  );
}
