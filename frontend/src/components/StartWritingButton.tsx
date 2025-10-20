"use client";

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Toast } from './Toast';

export default function StartWritingButton() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleClick() {
    if (checking) return;
    setChecking(true);
    try {
      const missing: string[] = [];

      // Check credits
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) throw new Error('auth');
        const me = await res.json();
        const credits = Number(me?.credits ?? 0);
        if (!(credits > 0)) missing.push('add at least 1 credit');
      } catch {
        missing.push('sign in and have credits');
      }

      // Check MP
      try {
        const res = await fetch('/api/user/mp', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) throw new Error('mp');
        const doc = await res.json();
        if (!(doc && (doc.constituency || doc.mp))) missing.push('select your MP');
      } catch {
        missing.push('select your MP');
      }

      // Check address
      try {
        const res = await fetch('/api/user/address', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) throw new Error('address');
        const doc = await res.json();
        const a = doc?.address;
        if (!(a && (a.line1 || a.postcode))) missing.push('save your address');
      } catch {
        missing.push('save your address');
      }

      if (missing.length === 0) {
        router.push('/writingDesk');
        return;
      }

      const msg = `Before you can start writing, please ${formatList(missing)}.`;
      setToast(msg);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setChecking(false);
    }
  }

  function formatList(items: string[]) {
    const unique = Array.from(new Set(items));
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  }

  return (
    <div className="container start-writing-panel">
      <div className="start-writing-actions">
        <button
          type="button"
          className="start-writing-btn"
          aria-label="Start writing"
          aria-busy={checking}
          onClick={handleClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/start_writing.png"
            alt="Start writing"
            className="start-writing-img"
          />
        </button>
        <button type="button" className="btn-secondary start-writing-my-letters-btn">
          My Letters
        </button>
      </div>

      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
