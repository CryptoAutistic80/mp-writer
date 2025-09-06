import styles from './landing.module.css';

type Props = {
  className?: string;
};

export function GoogleSignInButton({ className }: Props) {
  return (
    <a href="/api/auth/google" className={`${styles.googleButton} ${className ?? ''}`.trim()}>
      <span className={styles.googleButtonAvatar} />
      Continue with Google
    </a>
  );
}
