"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

type Address = {
  id: string;
  line1: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode: string;
  label: string; // for select options
};

function normalisePostcode(input: string) {
  const tight = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(tight)) return null;
  return `${tight.slice(0, -3)} ${tight.slice(-3)}`;
}

type AddressFormProps = {
  // Postcode typed in the MP lookup step; used to seed and keep the field in sync.
  seedPostcode?: string;
};

export default function AddressForm({ seedPostcode }: AddressFormProps) {
  const [postcode, setPostcode] = useState("");
  const [_loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  const [manual, setManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const valid = useMemo(() => !!normalisePostcode(postcode), [postcode]);

  const search = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSelected(null);
    setManual(false);
    const pc = normalisePostcode(postcode);
    if (!pc) {
      // Invalid postcode – quietly stop; UI hints via aria-invalid
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/addresses/lookup?postcode=${encodeURIComponent(pc)}`, { cache: 'no-store', credentials: 'include' });
      let items: Address[] = [];
      if (res.ok) {
        const json: any = await res.json();
        const raw = json?.items ?? json?.addresses ?? json?.result;
        if (Array.isArray(raw)) {
          // Accept various shapes: strings; label-only suggestions from backend; or full objects
          items = raw.map((r: any, i: number) => {
            if (typeof r === 'string') {
              const parts = r.split(',').map((s) => s.trim()).filter(Boolean);
              const label = r;
              const last = parts[parts.length - 1];
              const pc2 = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(last) ? last.toUpperCase() : pc;
              return { id: `${i}`,
                line1: parts[0] || '', line2: parts[1] || '', city: parts[2] || '', county: parts[3] || '', postcode: pc2, label } as Address;
            }
            // If backend already provided a normalized suggestion with label, use it as-is
            if (r && (r.label || r.id)) {
              return {
                id: r.id?.toString?.() || `${i}`,
                line1: r.line1 || '',
                line2: r.line2 || '',
                city: r.city || '',
                county: r.county || '',
                postcode: r.postcode || pc,
                label: r.label || [r.line1 || r.address1, r.line2 || r.address2, r.town || r.city, r.county, r.postcode || pc].filter(Boolean).join(', '),
              } as Address;
            }
            // Fallback: try to build a label from common field names
            const label = [r.line1 || r.address1, r.line2 || r.address2, r.town || r.city, r.county, r.postcode || pc].filter(Boolean).join(', ');
            return {
              id: r.id?.toString?.() || r.udprn?.toString?.() || `${i}`,
              line1: r.line1 || r.address1 || '',
              line2: r.line2 || r.address2 || '',
              city: r.town || r.city || '',
              county: r.county || '',
              postcode: r.postcode || pc,
              label,
            } as Address;
          });
        }
      } else {
        const msg = await res.text().catch(() => '');
        setAddresses([]);
        setError(msg || `Address provider error (HTTP ${res.status}). Please check configuration.`);
        return;
      }
      setAddresses(items);
      if (!items.length) setError('No addresses found for that postcode.');
    } catch {
      setError('Address lookup failed. You can enter it manually.');
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }, [postcode]);

  // Keep this form's postcode synced with the postcode typed in the MP lookup.
  useEffect(() => {
    if (seedPostcode != null && seedPostcode !== postcode) {
      setPostcode(seedPostcode);
    }
  }, [seedPostcode]);

  // Auto-search when postcode changes to a valid UK postcode.
  useEffect(() => {
    const pc = normalisePostcode(postcode);
    if (!pc) {
      setAddresses([]);
      setError(null);
      return;
    }
    // If a saved/selected address already matches this postcode, don't refetch.
    if (selected && normalisePostcode(selected.postcode) === pc) {
      return;
    }
    const t = setTimeout(() => {
      void search();
    }, 350);
    return () => clearTimeout(t);
  }, [postcode, search, selected]);

  const onSelect = useCallback(async (id: string) => {
    setError(null);
    // Find the chosen suggestion (for postcode default), then fetch full details by id
    const chosen = addresses.find((x) => x.id === id) || null;
    setLoading(true);
    try {
      const pc = chosen?.postcode || normalisePostcode(postcode) || '';
      const res = await fetch(`/api/addresses/get?id=${encodeURIComponent(id)}${pc ? `&postcode=${encodeURIComponent(pc)}` : ''}`, { cache: 'no-store', credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch address details (${res.status})`);
      const json: any = await res.json();
      const item = json?.item || json?.address || json;
      if (item && item.id) {
        const a: Address = {
          id: item.id?.toString?.() || id,
          line1: item.line1 || item.address1 || '',
          line2: item.line2 || item.address2 || '',
          city: item.city || item.town || '',
          county: item.county || '',
          postcode: item.postcode || pc,
          label: item.label || [item.line1 || item.address1, item.line2 || item.address2, item.city || item.town, item.county, item.postcode || pc].filter(Boolean).join(', '),
        };
        setSelected(a);
      } else {
        throw new Error('No address details returned');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load address details. You can enter it manually.');
      setSelected(chosen); // keep at least the label
    } finally {
      setLoading(false);
    }
  }, [addresses, postcode]);

  const current = selected || (manual ? { id: 'manual', line1: '', line2: '', city: '', county: '', postcode: normalisePostcode(postcode) || '' , label: '' } : null);

  // Load saved address on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/user/address', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const json: any = await res.json().catch(() => null);
        const a = json?.address;
        if (a && a.postcode) {
          const addr: Address = { id: 'saved', line1: a.line1 || '', line2: a.line2 || '', city: a.city || '', county: a.county || '', postcode: a.postcode || '', label: '' };
          setSelected(addr);
          setPostcode(a.postcode || '');
        }
      } catch {}
    })();
  }, []);

  const save = useCallback(async () => {
    if (!current) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      const body = {
        line1: current.line1,
        line2: current.line2 || '',
        city: current.city || '',
        county: current.county || '',
        postcode: current.postcode,
      };
      const res = await fetch('/api/user/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Save failed (${res.status})`);
      }
      setSavedMsg('Address saved');
    } catch (e: any) {
      setSavedMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [current]);

  const clearSaved = useCallback(async () => {
    setSavedMsg(null);
    try {
      await fetch('/api/user/address', { method: 'DELETE', credentials: 'include' });
      setSelected(null);
    } catch {}
  }, []);

  return (
    <div className="container">
      <div className="section-header">
        <div>
          <h2 className="section-title">Your address</h2>
          <p className="section-sub">Enter the address you want to use when writing to your MP.</p>
        </div>
      </div>

      {/* Search row */}
      <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="addr-postcode" className="label">Postcode</label>
          <input
            id="addr-postcode"
            className="input"
            placeholder="e.g. SW1A 1AA"
            autoComplete="postal-code"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            aria-invalid={!valid && postcode.length > 0}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="status" aria-live="polite"><p style={{ color: '#b91c1c', marginTop: 8 }}>{error}</p></div>
        )}

        {/* Address select */}
        {!selected && !manual && addresses.length > 0 && (
          <div className="result" aria-live="polite">
            <label htmlFor="addr-select" className="label">Select address</label>
            <select id="addr-select" className="select" onChange={(e) => { void onSelect(e.target.value); }} defaultValue="">
              <option value="" disabled>Choose your address…</option>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn-link" onClick={() => setManual(true)}>Can’t find it? Enter manually</button>
            </div>
          </div>
        )}

        {/* Manual or selected details */}
        {current && (
          <div className="result" aria-live="polite">
            <div className="field">
              <label htmlFor="addr-line1" className="label">Address line 1</label>
              <input id="addr-line1" className="input" value={current.line1}
                onChange={(e) => setSelected({ ...(current as Address), line1: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="addr-line2" className="label">Address line 2</label>
              <input id="addr-line2" className="input" value={current.line2 || ''}
                onChange={(e) => setSelected({ ...(current as Address), line2: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="addr-city" className="label">Town/City</label>
              <input id="addr-city" className="input" value={current.city || ''}
                onChange={(e) => setSelected({ ...(current as Address), city: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="addr-county" className="label">County</label>
              <input id="addr-county" className="input" value={current.county || ''}
                onChange={(e) => setSelected({ ...(current as Address), county: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="addr-pc" className="label">Postcode</label>
              <input id="addr-pc" className="input" value={current.postcode}
                onChange={(e) => setSelected({ ...(current as Address), postcode: e.target.value })} />
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save address'}</button>
              {!manual && (
                <button type="button" className="btn-link" onClick={() => setManual(true)}>
                  Edit manually
                </button>
              )}
              <button type="button" className="btn-link" onClick={clearSaved}>Clear saved</button>
            </div>
            {savedMsg && (
              <div className="status" aria-live="polite"><p style={{ color: '#2563eb', marginTop: 8 }}>{savedMsg}</p></div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
