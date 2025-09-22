export default function Hero() {
  return (
    <section className="card">
      <div className="hero-top">
        <div className="hero-copy">
          <h1 className="hero-title">
            Your voice,
            <br />
            <span className="hero-highlight">clearly heard.</span>
          </h1>
          <p className="hero-sub">Craft researched, respectful letters to your MP in minutes.</p>
          <div className="cta">
            <p className="fineprint mobile-only">
              <a className="micro-link" href="/how-it-works">How it works</a>
            </p>
            <p className="fineprint">
              Login is secure and simple with a Google account.
            </p>
          </div>
        </div>
        <div className="hero-graphic" aria-hidden>
          <img src="/assets/hero-graphic.png" alt="" />
        </div>
      </div>

      <div className="value-callout" role="note" aria-label="Key benefits">
        <p className="value-1"><strong>Most of us never write to our MP.</strong></p>
        <p className="value-2">For years, writing to your MP meant long hours researching, drafting, and editing — often leaving important issues unspoken. MP Writer changes that. By combining AI-powered research with clear, structured drafting, it gives you the ability to share perfectly articulated, evidence-based letters in minutes. All you need to do is tell us what matters to you — we’ll handle the heavy lifting, so your voice reaches Parliament with clarity and impact.</p>
        <p className="value-3"><strong>One credit = one research & draft.</strong> Buy only what you use.</p>
      </div>

      <div id="features" className="stepper">
        {/* Step 1 */}
        <div className="step">
          <div className="step-icon" aria-hidden>1</div>
          <div>
            <div className="step-title">Look up your MP</div>
            <div className="step-sub">We’ll find your MP for you from your address.</div>
          </div>
        </div>
        {/* Step 2 */}
        <div className="step">
          <div className="step-icon" aria-hidden>2</div>
          <div>
            <div className="step-title">Describe your issue</div>
            <div className="step-sub">Tell us what matters to you.</div>
          </div>
        </div>
        {/* Step 3 */}
        <div className="step">
          <div className="step-icon" aria-hidden>3</div>
          <div>
            <div className="step-title">Select your tone</div>
            <div className="step-sub">Choose a tone that fits your message.</div>
          </div>
        </div>
        {/* Step 4 */}
        <div className="step">
          <div className="step-icon" aria-hidden>4</div>
          <div>
            <div className="step-title">Get your letter</div>
            <div className="step-sub">AI crafts drafts with citations, ready to send.</div>
          </div>
        </div>
        {/* Step 5 */}
        <div className="step">
          <div className="step-icon" aria-hidden>5</div>
          <div>
            <div className="step-title">Email letters directly (coming soon)</div>
            <div className="step-sub">Send to your MP without leaving MP writer.</div>
          </div>
        </div>

        {/* Phone preview */}
        <div className="phone-mock" aria-hidden>
          <div className="phone-screen">
            <p><strong>Dear [MP Name],</strong></p>
            <p>I’m writing to express my concerns about an issue affecting our community.</p>
            <p>As a resident of [constituency], I believe it’s vital that we address this together.</p>
            <p>AI‑powered research has helped me gather relevant facts and citations.</p>
            <div className="btn-ghost">Copy to clipboard</div>
          </div>
        </div>
      </div>
      <div className="copy" />

      <div className="card-footer">
        <div className="brand-sub"><img src="/assets/header-title.png" alt="MPWriter" /></div>
      </div>
    </section>
  );
}
