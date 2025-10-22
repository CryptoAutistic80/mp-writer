import Link from 'next/link';
import { cookies } from 'next/headers';
import Avatar from './Avatar';
import InfoTooltip from './InfoTooltip';

type User = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

async function getCurrentUser(): Promise<User | null> {
  // Forward incoming cookies explicitly to the backend via rewrite
  const store = await cookies();
  const cookie = store.getAll().map(c => `${c.name}=${c.value}`).join('; ');
  try {
    const base = (process.env.NEXT_BACKEND_ORIGIN as string | undefined) || 'http://localhost:4000';
    const url = `${base.replace(/\/$/, '')}/api/auth/me`;
    const res = await fetch(url, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as User;
  } catch {
    return null;
  }
}

export default async function SiteHeader() {
  const user = await getCurrentUser();
  const isAuthed = !!user?.id;
  const firstName = (user?.name || '')?.split(' ')[0] || user?.email || 'Account';

  return (
    <header className="site-header">
      <div className="container">
        <div className="brand">
          <Link href="/">
            <img src="/assets/header-title.png" alt="MPWriter" />
          </Link>
        </div>
        <nav className="nav">
          <Link href="/how-it-works" className="hide-mobile">How it works</Link>
          {isAuthed && (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/myLetters">My Letters</Link>
            </>
          )}

          {!isAuthed ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <a href="/api/auth/google?returnTo=/dashboard" className="google-btn" aria-label="Sign in with Google">
                <svg className="google-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.3 30.3 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.7-.4-3.9H24v8.1h12.8c-.3 2-1.7 5.1-4.9 7.2l7.6 5.9c4.5-4.1 7-10.1 7-17.3z"/>
                  <path fill="#FBBC05" d="M10.5 28.3A14.4 14.4 0 0 1 9.7 24c0-1.5.3-3 .7-4.3l-7.9-6.1A24 24 0 0 0 0 24c0 3.8.9 7.4 2.6 10.4l7.9-6.1z"/>
                  <path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.7l-7.6-5.9c-2.1 1.5-5 2.5-8.4 2.5-6.2 0-11.5-4.1-13.4-9.7l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/>
                  <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
                <span className="google-btn-text">Sign in with Google</span>
              </a>
              <InfoTooltip
                content="We use Google only to verify your identity. After signing in you’ll be redirected straight to your dashboard."
                label="Why we use Google sign-in"
                placement="bottom"
              />
            </div>
          ) : (
            <div className="profile-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <details className="profile-details">
                <summary className="profile-summary">
                  <Avatar
                    src={user?.image ? `/api/auth/avatar/${user.id}` : undefined}
                    alt={firstName}
                    size={28}
                  />
                  <span className="profile-name">{firstName}</span>
                </summary>
                <div className="profile-menu" role="menu">
                  <a role="menuitem" href="/api/auth/logout">Logout</a>
                </div>
              </details>
              <InfoTooltip
                content="Tap your avatar to open account options like logout or switching devices."
                label="How to open account menu"
                placement="bottom"
              />
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
