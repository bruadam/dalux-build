import { readFile } from "node:fs/promises";
import { auth } from "@clerk/nextjs/server";

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

// Dalux is a multi-node SaaS (node1.field.dalux.com, node2..., etc.), so the
// base URL can't be pinned to one host — but it's also attacker-controlled
// input on this route (POST body from the browser), so it must stay
// constrained to Dalux's own domain. Without this, a caller could point the
// server at an arbitrary internal host (SSRF) and have the response, plus
// whatever API key they supplied, relayed back through this proxy.
const ALLOWED_BASE_URL_HOST_SUFFIX = ".dalux.com";
const ALLOWED_BASE_URL_HOST = "dalux.com";

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
  if (parsed.protocol !== "https:") {
    const error = new Error("Dalux base URL must use HTTPS");
    error.status = 400;
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname !== ALLOWED_BASE_URL_HOST &&
    !hostname.endsWith(ALLOWED_BASE_URL_HOST_SUFFIX)
  ) {
    const error = new Error(
      `Dalux base URL host must be ${ALLOWED_BASE_URL_HOST} or a subdomain of it`,
    );
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

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  return userId;
}
