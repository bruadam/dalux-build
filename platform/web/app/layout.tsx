import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Dalux MCP platform',
  description: 'Accounts, connections, and access for the self-hosted Dalux MCP server.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
