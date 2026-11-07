import { Cell, Table } from '@/components/table';
import { scopeLabel } from '@/components/scope';
import type { effectiveAccessFor } from '@/lib/server/access';

type Row = Awaited<ReturnType<typeof effectiveAccessFor>>[number];

export function AccessTable({ rows }: { rows: Row[] }) {
  return (
    <Table head={['Connection', 'Scope', 'Capability', 'Given by']} empty={!rows.length}>
      {rows.map((row) => (
        <tr key={`${row.grantId}-${row.capability}`}>
          <Cell>{row.connectionName}</Cell>
          <Cell>{scopeLabel(row)}</Cell>
          <Cell>
            <code>{row.capability}</code>
          </Cell>
          <Cell>{row.viaGroup ? `Group ${row.viaGroup}` : 'Direct grant'}</Cell>
        </tr>
      ))}
    </Table>
  );
}
