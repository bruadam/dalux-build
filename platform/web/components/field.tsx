import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none';
