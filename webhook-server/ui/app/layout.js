import "./globals.css";

export const metadata = {
  title: "Dalux webhook registration",
  description: "Register change and freshness monitors for Dalux Build files.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
