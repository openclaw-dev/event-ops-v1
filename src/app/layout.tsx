import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Event Ops',
  description: 'AI customer support and revenue recovery for live event operators.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
