import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'AutoPost — Your photography, out in the world', description: 'A private, local photography curation studio.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
