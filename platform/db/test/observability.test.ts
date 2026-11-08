import { auditLog, authEvents } from '../src/schema';
import { withAccount } from '../src/db';
import { recordAuthEvent } from '../src/authEvents';
import { applyIpLogging, resolveClientAddress, truncateIp } from '../src/clientIp';
import { clearExpiredIps } from '../src/retention';
import { createTestDatabase, type TestDatabase } from './testDatabase';

let t: TestDatabase;
const ids: Record<string, string> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  );
  return rows[0].id;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeAll(async () => {
  t = await createTestDatabase();
  ids.admin = await insert('accounts', { type: 'personal', email: 'admin@example.com', name: 'Admin', role: 'admin' });
  ids.alice = await insert('accounts', { type: 'personal', email: 'alice@example.com', name: 'Alice' });
  ids.bob = await insert('accounts', { type: 'personal', email: 'bob@example.com', name: 'Bob' });
  for (const [owner, ip] of [['alice', '203.0.113.1'], ['alice', '203.0.113.2'], ['bob', '198.51.100.1']] as const) {
    await t.as('mcp').insert(auditLog).values({ kind: 'tool', accountId: ids[owner], action: 'list_projects', status: 'ok', clientIp: ip, forwardedFor: ip });
  }
  await recordAuthEvent(t.as('mcp'), { source: 'mcp', reason: 'revoked_token', accountId: ids.alice, address: { ip: '203.0.113.1' } }, 'full');
  await recordAuthEvent(t.as('mcp'), { source: 'mcp', reason: 'unknown_token', address: { ip: '203.0.113.5' } }, 'full');
});

afterAll(async () => {
  await t?.drop();
});

describe('who reads the activity log', () => {
  const readAudit = (account: string) => withAccount(t.as('web'), ids[account], (tx) => tx.select().from(auditLog));

  it('shows people their own rows only', async () => {
    const rows = await readAudit('alice');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.accountId === ids.alice)).toBe(true);
  });

  it('shows admins every row', async () => {
    expect(await readAudit('admin')).toHaveLength(3);
  });

  it('shows nothing when no account is set', async () => {
    expect(await t.as('web').select().from(auditLog)).toHaveLength(0);
  });

  it('shows people their own auth events and admins all of them', async () => {
    const events = (account: string) => withAccount(t.as('web'), ids[account], (tx) => tx.select().from(authEvents));
    expect((await events('alice')).map((row) => row.reason)).toEqual(['revoked_token']);
    expect(await events('bob')).toHaveLength(0);
    expect(await events('admin')).toHaveLength(2);
  });

  it('lets the mcp role write but not read', async () => {
    await expect(t.as('mcp').select().from(auditLog)).rejects.toThrow();
  });
});

describe('IP retention', () => {
  it('clears IP columns past the retention period and keeps the rows', async () => {
    await t.owner.query(`INSERT INTO settings (id, ip_retention_days) VALUES (true, 30) ON CONFLICT (id) DO UPDATE SET ip_retention_days = 30`);
    const old = await insert('audit_log', { kind: 'tool', action: 'old_call', at: daysAgo(40), client_ip: '203.0.113.9', forwarded_for: '203.0.113.9', user_agent: 'ua' });
    const recent = await insert('audit_log', { kind: 'tool', action: 'recent_call', at: daysAgo(5), client_ip: '203.0.113.9' });
    const oldEvent = await insert('auth_events', { source: 'mcp', reason: 'unknown_token', at: daysAgo(40), client_ip: '203.0.113.9' });

    expect(await clearExpiredIps(t.as('worker'))).toBe(2);

    const rows = (await t.owner.query('SELECT id, client_ip, forwarded_for, user_agent, action FROM audit_log WHERE id = ANY($1)', [[old, recent]])).rows;
    expect(rows.find((row) => row.id === old)).toMatchObject({ client_ip: null, forwarded_for: null, user_agent: 'ua', action: 'old_call' });
    expect(rows.find((row) => row.id === recent)).toMatchObject({ client_ip: '203.0.113.9' });
    expect((await t.owner.query('SELECT client_ip FROM auth_events WHERE id = $1', [oldEvent])).rows[0].client_ip).toBeNull();
    expect(await clearExpiredIps(t.as('worker'))).toBe(0);
  });

  it('keeps the other roles from changing or deleting audit rows', async () => {
    await expect(t.as('mcp').update(auditLog).set({ clientIp: null })).rejects.toThrow();
    await expect(t.as('web').delete(auditLog)).rejects.toThrow();
  });
});

describe('client address', () => {
  it('counts X-Forwarded-For from the right, as far as the trusted proxies', () => {
    expect(resolveClientAddress({ forwardedFor: '6.6.6.6, 203.0.113.9', peer: '172.18.0.4', trustedHops: 1 }).ip).toBe('203.0.113.9');
    expect(resolveClientAddress({ forwardedFor: '6.6.6.6, 203.0.113.9, 10.0.0.2', peer: '172.18.0.4', trustedHops: 2 }).ip).toBe('203.0.113.9');
    expect(resolveClientAddress({ forwardedFor: '203.0.113.9', trustedHops: 1 }).ip).toBe('203.0.113.9');
  });

  it('uses the peer when no proxy is trusted, and rejects junk', () => {
    expect(resolveClientAddress({ forwardedFor: '6.6.6.6', peer: '::ffff:192.0.2.1', trustedHops: 0 }).ip).toBe('192.0.2.1');
    expect(resolveClientAddress({ forwardedFor: 'not-an-ip', peer: '10.0.0.1', trustedHops: 1 }).ip).toBeUndefined();
  });

  it('truncates to /24 and /48 and drops everything when off', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(truncateIp('::1')).toBe('0:0:0::/48');
    expect(applyIpLogging({ ip: '203.0.113.77', forwardedFor: 'x' }, 'truncated')).toEqual({ ip: '203.0.113.0/24' });
    expect(applyIpLogging({ ip: '203.0.113.77' }, 'off')).toEqual({});
  });
});
