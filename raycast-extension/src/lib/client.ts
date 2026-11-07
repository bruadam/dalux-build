import { pbkdf2Sync } from "node:crypto";
import { getPreferenceValues } from "@raycast/api";
import { createClient, type DaluxClient } from "dalux-build-api";
import { validateBaseUrl } from "./daluxUrl";

export class PreferencesError extends Error {
  name = "PreferencesError";
}

let current: { signature: string; client: DaluxClient } | undefined;

function settings(): { baseUrl: string; apiKey: string } {
  const preferences = getPreferenceValues<Preferences>();
  const result = validateBaseUrl(preferences.baseUrl);
  if ("error" in result) throw new PreferencesError(result.error);
  return { baseUrl: result.baseUrl, apiKey: preferences.apiKey.trim() };
}

export function getClient(): DaluxClient {
  const { baseUrl, apiKey } = settings();
  const signature = `${baseUrl}\n${apiKey}`;
  if (current?.signature !== signature) current = { signature, client: createClient({ baseUrl, apiKey }) };
  return current.client;
}

/** Short, non-reversible id of the configured account, used to keep caches of different accounts apart. */
export function accountId(): string {
  const { baseUrl, apiKey } = settings();
  return pbkdf2Sync(apiKey, baseUrl, 210000, 32, "sha512").toString("hex").slice(0, 12);
}
