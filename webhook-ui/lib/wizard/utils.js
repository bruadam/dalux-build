export function padTime(value) {
  return String(value).padStart(2, "0");
}

export async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

export async function jobAction(url, method) {
  const response = await fetch(url, { method });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

export function splitValues(value, { extensions = false } = {}) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (extensions ? item.replace(/^\./, "").toLowerCase() : item));
}

export function buildFilenameFilter({
  contains,
  containsMatch,
  endsWith,
  extensions,
  notContains,
  startsWith,
}) {
  const filter = {
    contains: splitValues(contains),
    contains_match: containsMatch,
    not_contains: splitValues(notContains),
    startswith: splitValues(startsWith),
    endswith: splitValues(endsWith),
    extensions: splitValues(extensions, { extensions: true }),
  };
  for (const key of Object.keys(filter)) {
    if (Array.isArray(filter[key]) && filter[key].length === 0) delete filter[key];
  }
  return filter;
}

export function matchesFilename(fileName, filter) {
  const value = fileName.toLowerCase();
  const lowered = (key) => (filter[key] || []).map((item) => item.toLowerCase());
  const contains = lowered("contains");
  if (contains.length) {
    const checks = contains.map((part) => value.includes(part));
    if (filter.contains_match === "all" ? !checks.every(Boolean) : !checks.some(Boolean)) {
      return false;
    }
  }
  if (lowered("not_contains").some((part) => value.includes(part))) return false;
  const starts = lowered("startswith");
  if (starts.length && !starts.some((part) => value.startsWith(part))) return false;
  const ends = lowered("endswith");
  if (ends.length && !ends.some((part) => value.endsWith(part))) return false;
  const extensions = lowered("extensions").map((part) =>
    part.startsWith(".") ? part : `.${part}`,
  );
  return !extensions.length || extensions.some((part) => value.endsWith(part));
}
