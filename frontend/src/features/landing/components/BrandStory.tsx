import styles from './landing.module.css';

export function BrandStory() {
  return (
    <section className={`${styles.section} ${styles.brandStory}`}>
      <p>
        For years, people have said: ‘write to your MP.’ Most of us never did. MP Writer
        makes it effortless. Powered by AI research, you can now send a perfectly
        articulated, evidence-based letter every time your voice needs to be heard.
      </p>
    </section>
  );
}
