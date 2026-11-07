export function formatDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatBytes(bytes: number | null | undefined): string | undefined {
  if (bytes == null) return undefined;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Sorts newest first by an ISO timestamp; items without one go last. */
export function byNewest<T>(timestampOf: (item: T) => string | undefined): (a: T, b: T) => number {
  return (a, b) => (timestampOf(b) ?? "").localeCompare(timestampOf(a) ?? "");
}
