'use client';

import MpFetch from '../../components/mpFetch';
import AddressForm from '../../components/AddressForm';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  // AnimatedBackground is rendered globally in layout.tsx.
  const [sharedPostcode, setSharedPostcode] = useState('');
  const [firstName, setFirstName] = useState('User');
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) return;
        const user = await res.json();
        if (!cancelled && user) {
          const name = (user.name || '').split(' ')[0] || user.email || 'User';
          setFirstName(name);
          if (typeof user.credits === 'number') setCredits(user.credits);
        }
      } catch {
        // Ignore fetch errors silently
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="hero-section">
      <section className="card">
        <div className="container dashboard-welcome">
          <h2 className="section-title">
            Welcome to your dashboard {firstName}!
          </h2>
          <div className="credits-info">
            <span className="credits-count">{credits} credits</span>
            <button type="button" className="btn-primary">
              Credit shop
            </button>
          </div>
        </div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <MpFetch onPostcodeChange={setSharedPostcode} />
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <AddressForm seedPostcode={sharedPostcode} />
      </section>
    </main>
  );
}
