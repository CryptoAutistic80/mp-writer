'use client';

import MpFetch from '../../components/mpFetch';
import AddressForm from '../../components/AddressForm';
import DashboardWelcome from '../../components/DashboardWelcome';
import StartWritingButton from '../../components/StartWritingButton';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  // AnimatedBackground is rendered globally in layout.tsx.
  const [sharedPostcode, setSharedPostcode] = useState('');
  const [firstName, setFirstName] = useState('User');
  const [credits, setCredits] = useState(0);
  const [purchaseStatus, setPurchaseStatus] = useState<string | null>(null);
  const [purchaseStatusType, setPurchaseStatusType] = useState<'success' | 'error' | null>(null);

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

  async function handleCreditShopClick(planId: string) {
    if (!planId) return;
    setPurchaseStatus(null);
    setPurchaseStatusType(null);
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      if (!res.ok) {
        const text = await res.text();
        setPurchaseStatus(text || 'Unable to complete purchase. Please try again.');
        setPurchaseStatusType('error');
        return;
      }
      const data = await res.json();
      if (typeof data?.credits === 'number') {
        setCredits(data.credits);
        setPurchaseStatus('Credits added to your account.');
        setPurchaseStatusType('success');
      }
    } catch {
      setPurchaseStatus('Unable to connect to the server. Please try again.');
      setPurchaseStatusType('error');
    }
  }

  return (
    <main className="hero-section">
      <DashboardWelcome firstName={firstName} credits={credits} onAddCredit={handleCreditShopClick} />
      {purchaseStatus && (
        <section className="card" style={{ marginTop: 8 }}>
          <div className="container" role="status" aria-live="polite">
            <p className={purchaseStatusType === 'success' ? 'notice-text' : 'error-text'}>{purchaseStatus}</p>
          </div>
        </section>
      )}
      <section className="card" style={{ marginTop: 16 }}>
        <MpFetch onPostcodeChange={setSharedPostcode} />
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <AddressForm seedPostcode={sharedPostcode} />
      </section>
      <section className="card card-compact" style={{ marginTop: 16 }}>
        <StartWritingButton />
      </section>
    </main>
  );
}
