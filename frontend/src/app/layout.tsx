import './global.css';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import AnimatedBackground from '../components/AnimatedBackground';
import { Providers } from './providers';

export const metadata = {
  title: 'MPWriter — Your voice, clearly heard.',
  description:
    'Craft researched, respectful letters to your MP in minutes with MPWriter.',
};

// Ensure this layout (and header) renders dynamically per request
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AnimatedBackground />
        <div className="page-wrap">
          <SiteHeader />
          <Providers>{children}</Providers>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
