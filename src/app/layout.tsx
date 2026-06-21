import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'tazkar.co — Event Operations',
  description: 'AI-powered event operations for GCC live event operators',
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
