import { readFile } from "node:fs/promises";

export const DEFAULT_DALUX_BASE_URL =
  "https://node1.field.dalux.com/service/api/";

export function errorResponse(error, fallbackStatus = 500) {
  const status = Number.isInteger(error?.status) ? error.status : fallbackStatus;
  return Response.json(
    { ok: false, error: { message: error?.message || String(error) } },
    { status },
  );
}

export function requireString(value, name) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    const error = new Error(`${name} is required`);
    error.status = 400;
    throw error;
  }
  return result;
}

export function resolveBaseUrl(value) {
  const raw =
    (typeof value === "string" && value.trim()) ||
    process.env.DALUX_BASE_URL ||
    DEFAULT_DALUX_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const error = new Error("Dalux base URL must be a valid URL");
    error.status = 400;
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error("Dalux base URL must use HTTP or HTTPS");
    error.status = 400;
    throw error;
  }
  return raw;
}

export async function monitorToken() {
  if (process.env.MONITOR_API_TOKEN_FILE) {
    return (await readFile(process.env.MONITOR_API_TOKEN_FILE, "utf8")).trim();
  }
  return requireString(process.env.MONITOR_API_TOKEN, "MONITOR_API_TOKEN");
}
