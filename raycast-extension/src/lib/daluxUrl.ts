/** Validates the "API Base URL" preference: must be an https://*.dalux.com URL. */
export function validateBaseUrl(raw: string): { baseUrl: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: "The API Base URL is not a valid URL." };
  }
  const host = parsed.hostname;
  if (parsed.protocol !== "https:" || !(host === "dalux.com" || host.endsWith(".dalux.com"))) {
    return { error: "The API Base URL must be an https://….dalux.com URL." };
  }
  return { baseUrl: parsed.toString().replace(/\/+$/, "") };
}
