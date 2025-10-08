import Link from 'next/link';

export default function CreditShopCancelPage() {
  return (
    <main className="hero-section">
      <section className="card">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 className="section-title">Checkout cancelled</h1>
          <p style={{ margin: 0 }}>
            Your Stripe checkout session was cancelled. No charges were made and your credit balance remains unchanged.
          </p>
          <p style={{ margin: 0, color: '#475569' }}>
            If this was a mistake you can restart the purchase below. If the issue persists please contact support.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/credit-shop" className="btn-primary">
              Resume purchase
            </Link>
            <Link href="/dashboard" className="btn-secondary">
              Return to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
