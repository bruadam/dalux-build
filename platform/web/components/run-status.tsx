import { Badge } from '@/components/ui/badge';

export const dateTime = (value: Date | null) => (value ? `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—');

/** Status of an index run: running, ok, partial (failed files or pending), failed. */
export function RunStatus({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">never run</span>;
  const variant = status === 'ok' ? 'secondary' : status === 'running' ? 'outline' : 'destructive';
  return <Badge variant={variant}>{status}</Badge>;
}
