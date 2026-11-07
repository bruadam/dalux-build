import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 space-y-1">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
