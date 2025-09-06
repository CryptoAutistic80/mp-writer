import styles from './landing.module.css';

export function Payment() {
  return (
    <section className={`${styles.section} ${styles.payment}`}>
      <p>One credit = one research & draft. Buy only what you use.</p>
      <img src="/stripe-badge.svg" alt="Stripe" />
    </section>
  );
}
