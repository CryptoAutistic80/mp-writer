'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { CREDIT_PACKAGES } from '@mp-writer/shared/credit-packages';

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

type PurchaseState = {
  credits: number | null;
  status: 'idle' | 'loading' | 'error';
  message: string | null;
  activePackageId: string | null;
};

export default function CreditShopPage() {
  const [state, setState] = useState<PurchaseState>({
    credits: null,
    status: 'idle',
    message: null,
    activePackageId: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/credits', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.credits === 'number') {
          setState((prev) => ({ ...prev, credits: data.credits }));
        }
      } catch {
        // Ignore fetch errors silently; user can still attempt a purchase.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stripePromise = useMemo(() => {
    if (!publishableKey) return null;
    return loadStripe(publishableKey);
  }, [publishableKey]);

  const handlePurchase = async (packageId: string) => {
    if (!publishableKey) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        activePackageId: null,
        message: 'Stripe is not configured. Please contact support.',
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: 'loading',
      activePackageId: packageId,
      message: null,
    }));

    try {
      const res = await fetch('/api/purchases/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to start checkout');
      }
      const data = await res.json();
      if (!data?.sessionId) {
        throw new Error('Checkout session response missing');
      }

      const stripe = stripePromise ? await stripePromise : null;
      if (!stripe) {
        throw new Error('Stripe could not be initialised');
      }

      const { error } = await stripe.redirectToCheckout({ sessionId: data.sessionId });
      if (error) {
        throw error;
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        activePackageId: null,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to complete your purchase right now. Please try again shortly.',
      }));
    }
  };

  const disabled = state.status === 'loading';

  return (
    <main className="hero-section">
      <section className="card">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <header>
            <h1 className="section-title">Credit shop</h1>
            <p>Purchase additional credits to continue crafting powerful letters to your MP.</p>
          </header>
          <div
            className="card"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              className="container"
              style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'stretch' }}
            >
              <p style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: '#2563eb' }}>
                Choose your package
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 16,
                  width: '100%',
                }}
              >
                {CREDIT_PACKAGES.map((creditPackage) => {
                  const isLoading = disabled && state.activePackageId === creditPackage.id;
                  const formatter = getCurrencyFormatter(creditPackage.price.currency);
                  return (
                    <article
                      key={creditPackage.id}
                      className="card"
                      style={{
                        border: creditPackage.highlight ? '2px solid #2563eb' : '1px solid #e2e8f0',
                        background: creditPackage.highlight ? '#eff6ff' : 'white',
                        boxShadow: creditPackage.highlight ? '0 10px 30px rgba(37, 99, 235, 0.15)' : undefined,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        padding: 24,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{creditPackage.name}</h2>
                        <p style={{ margin: 0, color: '#475569' }}>
                          {creditPackage.description ?? `${creditPackage.credits} credits`}
                        </p>
                        <p style={{ margin: 0, fontSize: '2rem', fontWeight: 600 }}>
                          {formatter.format(creditPackage.price.unitAmount / 100)}
                        </p>
                        <p style={{ margin: 0, color: '#64748b' }}>
                          {formatCredits(creditPackage.credits)} credits total
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handlePurchase(creditPackage.id)}
                        disabled={isLoading || disabled}
                        style={{ marginTop: 'auto' }}
                      >
                        {isLoading ? 'Redirecting to checkout…' : 'Buy with card'}
                      </button>
                    </article>
                  );
                })}
              </div>
              {state.message && (
                <p
                  role={state.status === 'error' ? 'alert' : undefined}
                  style={{
                    margin: 0,
                    color: state.status === 'error' ? '#b91c1c' : '#166534',
                    fontWeight: 500,
                  }}
                >
                  {state.message}
                </p>
              )}
              {typeof state.credits === 'number' && (
                <p style={{ margin: 0 }}>You currently have {formatCredits(state.credits)} credits available.</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Link href="/dashboard" className="btn-secondary">
              Exit shop
            </Link>
            <Link href="/credit-shop/return" className="btn-text">
              Already paid? Check your payment status
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

function getCurrencyFormatter(currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency });
}
