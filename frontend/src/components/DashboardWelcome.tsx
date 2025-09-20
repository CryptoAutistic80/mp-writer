"use client";

type Props = {
  firstName: string;
  credits: number;
  onAddCredit: (planId: string) => void;
};

export default function DashboardWelcome({ firstName, credits, onAddCredit }: Props) {
  return (
    <section className="card">
      <div className="container dashboard-welcome">
        <div className="welcome-copy">
          <h2 className="section-title">Welcome to your dashboard {firstName}!</h2>
          <p>Please enter your postcode below to locate your MP and select your address.</p>
          <p>Then you are ready to write your letter!</p>
          <p><em className="fineprint">(Saved addresses are encrypted and can only be read by you.)</em></p>
        </div>
        <div className="credits-info">
          <button
            type="button"
            className="btn-primary btn-wide"
            onClick={() => onAddCredit('single')}
            aria-label="Buy one credit"
          >
            Buy 1 credit (£5.00)
          </button>
          <span className="credits-count">{credits} credits</span>
        </div>
      </div>
    </section>
  );
}
