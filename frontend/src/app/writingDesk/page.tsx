import WritingDeskClient from '../../components/writing-desk/WritingDeskClient';

export const metadata = {
  title: 'Writing Desk — MPWriter',
};

export default function WritingDeskPage() {
  return (
    <main className="hero-section">
      <WritingDeskClient />
    </main>
  );
}
