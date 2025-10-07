'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type StatusState = {
  status: 'loading' | 'success' | 'pending' | 'error';
  message: string;
  credits: number | null;
  failureMessage: string | null;
};

export default function CreditShopReturnPage() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [state, setState] = useState<StatusState>({
    status: 'loading',
    message: 'Checking your payment status…',
    credits: null,
    failureMessage: null,
  });

  useEffect(() => {
    if (!sessionId) {
      setState({
        status: 'error',
        message: 'We could not find a payment session to verify. Please return to the shop and try again.',
        credits: null,
        failureMessage: null,
      });
      return;
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/purchases/checkout-session/${sessionId}`, {
          cache: 'no-store',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error('Unable to verify payment status.');
        }
        const data = await res.json();
        if (cancelled) return;
        if (data?.status === 'succeeded') {
          setState({
            status: 'success',
            message: `Payment successful! ${formatCredits(data.credits ?? 0)} credits have been added to your account.`,
            credits: typeof data?.credits === 'number' ? data.credits : null,
            failureMessage: null,
          });
          await refreshCredits();
        } else if (data?.status === 'pending') {
          setState({
            status: 'pending',
            message: 'Your payment is processing. This usually takes a few seconds…',
            credits: null,
            failureMessage: null,
          });
          timeout = setTimeout(checkStatus, 4000);
        } else if (data?.status === 'failed' || data?.status === 'refunded') {
          setState({
            status: 'error',
            message: data?.status === 'refunded' ? 'Your payment was refunded.' : 'We could not complete your payment.',
            credits: null,
            failureMessage: data?.failureMessage ?? null,
          });
        } else {
          setState({
            status: 'error',
            message: 'We could not verify your payment. Please contact support with your session ID.',
            credits: null,
            failureMessage: null,
          });
        }
      } catch (error) {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to verify your payment at the moment. Please try again shortly.',
          credits: null,
          failureMessage: null,
        });
      }
    };

    checkStatus();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [sessionId]);

  const statusColour = useMemo(() => {
    switch (state.status) {
      case 'success':
        return '#166534';
      case 'error':
        return '#b91c1c';
      case 'pending':
        return '#2563eb';
      default:
        return '#1e293b';
    }
  }, [state.status]);

  return (
    <main className="hero-section">
      <section className="card">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <header>
            <h1 className="section-title">Payment status</h1>
            <p>We&apos;re checking the outcome of your recent credit purchase.</p>
          </header>
          <div className="card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: statusColour }}>{state.message}</p>
              {state.failureMessage && (
                <p style={{ margin: 0, color: '#475569' }}>{state.failureMessage}</p>
              )}
              {typeof state.credits === 'number' && state.status === 'success' && (
                <p style={{ margin: 0 }}>
                  You now have {formatCredits(state.credits)} credits available. Return to your dashboard to continue writing.
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Link href="/dashboard" className="btn-primary">
                  Go to dashboard
                </Link>
                <Link href="/credit-shop" className="btn-secondary">
                  Back to shop
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

async function refreshCredits() {
  try {
    await fetch('/api/user/credits', { cache: 'no-store', credentials: 'include' });
  } catch {
    // Ignore refresh errors; the dashboard will re-fetch on load.
  }
}

function formatCredits(value: number) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
