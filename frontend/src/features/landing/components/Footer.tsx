import styles from './landing.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerLinks}>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/contact">Contact</a>
      </div>
      <div>MP Writer</div>
    </footer>
  );
}
