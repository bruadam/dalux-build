import { createOwnTokenAction, createRobotTokenAction, revokeTokenAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { Cell, Table } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { listConnections } from '@/lib/server/connections';
import type { listApiTokens } from '@/lib/server/tokens';

type Token = Awaited<ReturnType<typeof listApiTokens>>[number];
type Connection = Awaited<ReturnType<typeof listConnections>>[number];

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '—');

/** Create and revoke API tokens. `robotId` set: an admin manages a robot's tokens. */
export function TokenSection({ tokens, connections, robotId }: { tokens: Token[]; connections: Connection[]; robotId?: string }) {
  return (
    <div className="space-y-4">
      <ActionForm action={robotId ? createRobotTokenAction : createOwnTokenAction}>
        {robotId && <input type="hidden" name="accountId" value={robotId} />}
        <Field label="Token name" htmlFor="token-name">
          <Input id="token-name" name="name" placeholder="e.g. Claude Desktop" required />
        </Field>
        <Field label="Connection" htmlFor="token-connection">
          <select id="token-connection" name="connectionId" className={selectClass}>
            <option value="">Any connection</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expires after (days, empty = never)" htmlFor="token-expiry">
          <Input id="token-expiry" name="expiresInDays" type="number" min={1} className="w-28" />
        </Field>
        <Button type="submit">Create token</Button>
      </ActionForm>
      <Table head={['Name', 'Token', 'Connection', 'Created', 'Expires', 'Last used', '']} empty={!tokens.length}>
        {tokens.map((token) => (
          <tr key={token.id}>
            <Cell>{token.name}</Cell>
            <Cell>
              <code>{token.prefix}…</code>
            </Cell>
            <Cell>{token.connectionName ?? 'Any'}</Cell>
            <Cell>{date(token.createdAt)}</Cell>
            <Cell>{date(token.expiresAt)}</Cell>
            <Cell>{date(token.lastUsedAt)}</Cell>
            <Cell>
              {token.revokedAt ? (
                <Badge variant="secondary">Revoked</Badge>
              ) : (
                <ActionForm action={revokeTokenAction} confirm="Revoke this token?">
                  <input type="hidden" name="tokenId" value={token.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Revoke
                  </Button>
                </ActionForm>
              )}
            </Cell>
          </tr>
        ))}
      </Table>
    </div>
  );
}
