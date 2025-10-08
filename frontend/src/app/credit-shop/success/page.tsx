'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function CreditShopSuccessPage() {
  const searchParams = useSearchParams();
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/credits', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && typeof data?.credits === 'number') {
            setCredits(Math.round(data.credits * 100) / 100);
          }
        }
      } catch {
        // Ignore fetch errors silently and show fallback copy below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionId = searchParams.get('session_id');

  return (
    <main className="hero-section">
      <section className="card">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 className="section-title">Payment successful</h1>
          <p style={{ margin: 0 }}>
            Thank you! Your payment has been processed and the credits are now available in your account.
          </p>
          {sessionId && (
            <p style={{ margin: 0, color: '#475569' }}>
              Stripe session reference: <strong>{sessionId}</strong>
            </p>
          )}
          <p style={{ margin: 0, color: '#475569' }}>
            A receipt has been sent to your email address. If you have any questions please contact support with the
            reference above.
          </p>
          <div style={{ padding: 16, background: '#ecfdf5', border: '1px solid #86efac', borderRadius: 8 }}>
            {loading && <p style={{ margin: 0 }}>Updating your balance…</p>}
            {!loading && typeof credits === 'number' ? (
              <p style={{ margin: 0 }}>
                You now have <strong>{formatCredits(credits)}</strong> credits available. Happy writing!
              </p>
            ) : null}
            {!loading && credits === null && (
              <p style={{ margin: 0 }}>
                We could not refresh your balance automatically, but it should appear on your dashboard momentarily.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/dashboard" className="btn-primary">
              Go to dashboard
            </Link>
            <Link href="/credit-shop" className="btn-secondary">
              Return to credit shop
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatCredits(value: number) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
