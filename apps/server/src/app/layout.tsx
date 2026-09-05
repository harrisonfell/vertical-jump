import type { ReactNode } from 'react';

export const metadata = {
  title: 'Vert server',
  description: 'Whoop OAuth, webhooks, and sync for Vert.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
