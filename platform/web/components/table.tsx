import type { ReactNode } from 'react';

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {head.map((label) => (
              <th key={label} className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-muted-foreground">
                Nothing here yet.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Cell({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className ?? ''}`}>{children}</td>;
}
