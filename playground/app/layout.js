import './globals.css';

export const metadata = {
  title: 'Dalux Build API Playground',
  description: 'Interactive console for testing the dalux-build-api JS client',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
