import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mtaalam Space — Simple learning',
  description: 'Simple video lessons and practical learning materials from Clanert.',
  openGraph: {
    title: 'Mtaalam Space — Simple learning',
    description: 'Simple video lessons and practical learning materials from Clanert.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mtaalam Space — Simple learning',
    description: 'Simple video lessons and practical learning materials from Clanert.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
