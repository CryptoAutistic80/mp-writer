import styles from './landing.module.css';

export function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className={styles.steps}>
        <div className={styles.step}>
          <span className={styles.stepIcon} role="img" aria-label="Map pin">📍</span>
          <div>
            <div className={styles.stepTitle}>Look up your MP</div>
            <div className={styles.stepText}>Enter your postcode, we handle the rest.</div>
          </div>
        </div>
        <div className={styles.step}>
          <span className={styles.stepIcon} role="img" aria-label="Speech bubble">💬</span>
          <div>
            <div className={styles.stepTitle}>Describe your issue</div>
            <div className={styles.stepText}>Tell us what matters to you.</div>
          </div>
        </div>
        <div className={styles.step}>
          <span className={styles.stepIcon} role="img" aria-label="Envelope">✉️</span>
          <div>
            <div className={styles.stepTitle}>Get your letter</div>
            <div className={styles.stepText}>AI crafts drafts with citations, ready to send.</div>
          </div>
        </div>
      </div>
    </section>
  );
}
