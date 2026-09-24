import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'SRE.ai', template: '%s · SRE.ai' },
  description: 'Your AI Site Reliability Engineer — cited diagnoses, confidence-gated actions.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#042642' },
    { media: '(prefers-color-scheme: light)', color: '#f6f3eb' },
  ],
};

// Applies a saved theme choice before first paint (no flash). Without one,
// the OS preference decides via CSS.
const themeScript = `try{var t=localStorage.getItem('sreai-theme');if(t==='blueprint'||t==='whiteprint')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
