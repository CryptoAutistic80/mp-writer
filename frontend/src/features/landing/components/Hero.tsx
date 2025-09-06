import styles from './landing.module.css';
import { GoogleSignInButton } from './GoogleSignInButton';

export function Hero() {
  return (
    <section className={`${styles.section} ${styles.hero}`}>
      <h1 className={styles.headline}>Your voice, clearly heard.</h1>
      <p className={styles.subheadline}>
        Craft researched, respectful letters to your MP in minutes.
      </p>
      <GoogleSignInButton />
      <p className={styles.trust}>
        Secure login with Google. We’ll never post or email without your consent.
      </p>
    </section>
  );
}
