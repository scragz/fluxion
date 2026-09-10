import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Fluxion',
  description:
    'Four channels of temporal rhythm synthesis. Shape, hear, and export every trigger.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
