import styles from './landing.module.css';

export function Screenshot() {
  return (
    <section className={`${styles.section} ${styles.screenshot}`}>
      <div className={styles.phoneMock}>
        <img src="/mock-letter.svg" alt="Draft letter preview" />
      </div>
    </section>
  );
}
