import styles from './landing.module.css';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { BrandStory } from './BrandStory';
import { Screenshot } from './Screenshot';
import { Payment } from './Payment';
import { Footer } from './Footer';
import { GoogleSignInButton } from './GoogleSignInButton';

export function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <BrandStory />
      <Screenshot />
      <Payment />
      <Footer />
      <div className={styles.stickyCta}>
        <GoogleSignInButton />
      </div>
    </>
  );
}
