import { NextResponse } from 'next/server';

// Report whether the server has default credentials in its environment,
// so the UI can pre-fill the base URL and indicate a key is available —
// WITHOUT ever sending the key itself to the browser.
export async function GET() {
  const baseUrl = process.env.DALUX_BASE_URL || '';
  const hasServerKey = Boolean(process.env.DALUX_API_KEY);
  return NextResponse.json({ baseUrl, hasServerKey });
}
