'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';

type CreditPackage = {
  id: string;
  name: string;
  description: string;
  credits: number;
  amount: number;
  currency: string;
};

type CreditShopState = {
  credits: number | null;
  packages: CreditPackage[];
  status: 'idle' | 'loading' | 'error';
  message: string | null;
  pendingPackageId: string | null;
  fetching: boolean;
};

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');

export default function CreditShopPage() {
  const [state, setState] = useState<CreditShopState>({
    credits: null,
    packages: [],
    status: 'idle',
    message: null,
    pendingPackageId: null,
    fetching: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [creditsRes, packagesRes] = await Promise.all([
          fetch('/api/user/credits', { cache: 'no-store' }),
          fetch('/api/user/credits/packages', { cache: 'no-store' }),
        ]);

        let credits: number | null = null;
        if (creditsRes.ok) {
          const creditData = await creditsRes.json();
          if (typeof creditData?.credits === 'number') {
            credits = Math.round(creditData.credits * 100) / 100;
          }
        }

        let packages: CreditPackage[] = [];
        if (packagesRes.ok) {
          const packageData = await packagesRes.json();
          packages = normalisePackages(packageData?.packages);
        }

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            credits,
            packages,
            fetching: false,
            status: packages.length === 0 ? 'error' : 'idle',
            message:
              packages.length === 0
                ? 'Credit packages are temporarily unavailable. Please check back soon.'
                : null,
          }));
        }
      } catch {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            fetching: false,
            status: 'error',
            message: 'We were unable to load the credit packages. Please try again shortly.',
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePurchase = async (selectedPackage: CreditPackage) => {
    setState((prev) => ({
      ...prev,
      status: 'loading',
      message: null,
      pendingPackageId: selectedPackage.id,
    }));

    try {
      const stripe = await stripePromise;
      if (!stripe) {
        throw new Error('Stripe failed to initialise');
      }

      const res = await fetch('/api/user/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: selectedPackage.id }),
      });

      if (!res.ok) {
        throw new Error('Unable to start checkout session');
      }

      const data = await res.json();
      const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : null;
      if (!sessionId) {
        throw new Error('Invalid session response from server');
      }

      const { error } = await stripe.redirectToCheckout({ sessionId });
      if (error) {
        throw new Error(error.message || 'Stripe redirect failed');
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        pendingPackageId: null,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to complete your purchase right now. Please try again shortly.',
      }));
    }
  };

  const packageCards = useMemo(() => {
    if (state.fetching) {
      return (
        <p style={{ margin: 0 }}>Loading packages…</p>
      );
    }

    if (state.packages.length === 0) {
      return (
        <p style={{ margin: 0 }}>No credit packages are available at the moment.</p>
      );
    }

    return state.packages.map((creditPackage) => {
      const isProcessing =
        state.status === 'loading' && state.pendingPackageId === creditPackage.id;
      return (
        <div
          key={creditPackage.id}
          className="card"
          style={{
            border: '1px solid #e2e8f0',
            background: '#fff',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{creditPackage.credits} credits</h2>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {formatPrice(creditPackage)}
          </p>
          <p style={{ margin: 0, color: '#475569', minHeight: 48 }}>{creditPackage.description}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => handlePurchase(creditPackage)}
            disabled={state.status === 'loading'}
            style={{ marginTop: 'auto' }}
          >
            {isProcessing ? 'Redirecting to checkout…' : `Buy for ${formatPrice(creditPackage)}`}
          </button>
        </div>
      );
    });
  }, [state.fetching, state.packages, state.pendingPackageId, state.status]);

  return (
    <main className="hero-section">
      <section className="card">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <header>
            <h1 className="section-title">Credit shop</h1>
            <p>Purchase additional credits to continue crafting powerful letters to your MP.</p>
          </header>
          <div className="card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div
              className="container"
              style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}
            >
              <p style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: '#2563eb' }}>
                Choose your top-up
              </p>
              <p style={{ margin: 0, fontSize: '1.125rem' }}>Pick the package that suits your writing needs.</p>
              <div
                style={{
                  display: 'grid',
                  gap: 16,
                  width: '100%',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                {packageCards}
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
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
          >
            <Link href="/dashboard" className="btn-secondary">
              Exit shop
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function normalisePackages(raw: unknown): CreditPackage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((pkg) => {
      if (
        !pkg ||
        typeof pkg !== 'object' ||
        typeof (pkg as any).id !== 'string' ||
        typeof (pkg as any).name !== 'string' ||
        typeof (pkg as any).credits !== 'number' ||
        typeof (pkg as any).amount !== 'number' ||
        typeof (pkg as any).currency !== 'string'
      ) {
        return null;
      }
      return {
        id: (pkg as any).id,
        name: (pkg as any).name,
        description: typeof (pkg as any).description === 'string' ? (pkg as any).description : '',
        credits: Math.round((pkg as any).credits * 100) / 100,
        amount: Math.round((pkg as any).amount),
        currency: ((pkg as any).currency as string).toLowerCase(),
      } satisfies CreditPackage;
    })
    .filter((pkg): pkg is CreditPackage => Boolean(pkg))
    .sort((a, b) => a.credits - b.credits);
}

function formatPrice(creditPackage: CreditPackage) {
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: creditPackage.currency.toUpperCase(),
  });
  return formatter.format(creditPackage.amount / 100);
}

function formatCredits(value: number) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
