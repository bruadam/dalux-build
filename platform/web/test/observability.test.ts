import type { Db } from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../db/test/testDatabase';
import type { Actor } from '../lib/server/actor';
import { activityOverview } from '../lib/server/activity';
import { UserError } from '../lib/server/errors';
import { listAuthEvents } from '../lib/server/authEventsLog';
import { getObservabilitySettings, setObservabilitySettings } from '../lib/server/observabilitySettings';

let t: TestDatabase;
let db: Db;
const actors: Record<string, Actor> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0].id;
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

async function call(name: string, row: Record<string, unknown> = {}) {
  await insert('audit_log', { kind: 'tool', account_id: actors[name].accountId, action: 'list_projects', status: 'ok', duration_ms: 100, ...row });
}

async function person(name: string, role: 'admin' | 'user') {
  const accountId = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, role });
  actors[name] = { accountId, role, name, email: `${name}@example.com` };
}

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.as('web');
  await person('ada', 'admin');
  await person('uma', 'user');
  await person('ned', 'user');

  // Ned has history from one address, then a call from a new one.
  await call('ned', { at: hoursAgo(72), client_ip: '198.51.100.1', credential_id: 'c-ned' });
  await call('ned', { at: hoursAgo(1), client_ip: '198.51.100.1', credential_id: 'c-ned' });
  await call('ned', { at: hoursAgo(1), client_ip: '203.0.113.50', credential_id: 'c-ned' });
  // Uma's token is used from five addresses and she is denied twenty times.
  await call('uma', { at: hoursAgo(80), client_ip: '192.0.2.1' });
  for (let i = 1; i <= 5; i++) await call('uma', { at: hoursAgo(2), client_ip: `192.0.2.${i}`, credential_id: 'c-uma' });
  for (let i = 0; i < 20; i++) await call('uma', { at: hoursAgo(0.1), status: 'denied', action: 'get_file', duration_ms: 10 });
  await call('uma', { status: 'error', dalux_rate_limited: 2, duration_ms: 900 });
});

afterAll(async () => {
  await t?.drop();
});

describe('observability settings', () => {
  it('default to full IPs for 90 days and no query text', async () => {
    expect(await getObservabilitySettings(db)).toEqual({ logQueryText: false, ipLogging: 'full', ipRetentionDays: 90 });
  });

  it('are admin-only, validated and audited', async () => {
    await expect(setObservabilitySettings(db, actors.uma, { logQueryText: true, ipLogging: 'off', ipRetentionDays: 30 })).rejects.toThrow('Only admins can do this');
    await expect(setObservabilitySettings(db, actors.ada, { logQueryText: false, ipLogging: 'none' as never, ipRetentionDays: 30 })).rejects.toThrow(UserError);
    await expect(setObservabilitySettings(db, actors.ada, { logQueryText: false, ipLogging: 'full', ipRetentionDays: 0 })).rejects.toThrow(UserError);
    await setObservabilitySettings(db, actors.ada, { logQueryText: true, ipLogging: 'truncated', ipRetentionDays: 30 });
    expect(await getObservabilitySettings(db)).toEqual({ logQueryText: true, ipLogging: 'truncated', ipRetentionDays: 30 });
    const { rows } = await t.owner.query("SELECT 1 FROM audit_log WHERE action = 'settings.observability.set'");
    expect(rows).toHaveLength(1);
  });
});

describe('activity overview', () => {
  it('summarises everything for admins, with rates, latency and flags', async () => {
    const overview = await activityOverview(db, actors.ada);
    expect(overview.totals).toMatchObject({ calls: 30, denied: 20, errors: 1, daluxRateLimited: 2 });
    expect(overview.totals.p50Ms).toBe(10);
    expect(overview.totals.p95Ms).toBe(100);
    expect(overview.topTools).toEqual([
      { tool: 'get_file', calls: 20 },
      { tool: 'list_projects', calls: 10 },
    ]);
    expect(overview.topAccounts[0]).toMatchObject({ name: 'uma', calls: 27 });
    expect(overview.callsPerDay.reduce((sum, day) => sum + day.calls, 0)).toBe(30);
    expect(overview.flags.map((f) => `${f.accountName}:${f.flag}`).sort()).toEqual(['ned:new_ip', 'uma:denial_burst', 'uma:many_ips', 'uma:new_ip']);
    expect(overview.flags.find((f) => f.flag === 'new_ip')?.detail).toContain('203.0.113.50');
  });

  it('shows people only their own numbers and flags', async () => {
    const own = await activityOverview(db, actors.ned);
    expect(own.totals.calls).toBe(3);
    expect(own.topAccounts.map((a) => a.name)).toEqual(['ned']);
    expect(own.flags.map((f) => f.flag)).toEqual(['new_ip']);
  });

  it('flags a burst of calls', async () => {
    for (let i = 0; i < 500; i++) await call('ned', { at: new Date(Date.now() - 1000 * (i % 3000)) });
    const flags = (await activityOverview(db, actors.ada)).flags.filter((f) => f.accountName === 'ned');
    expect(flags.map((f) => f.flag)).toContain('call_burst');
  });
});

describe('own scope and failed attempts', () => {
  it('narrows an admin to their own numbers when asked', async () => {
    expect((await activityOverview(db, actors.ada, { own: true })).totals.calls).toBe(0);
    expect((await activityOverview(db, actors.ned, { own: true })).totals.calls).toBeGreaterThan(0);
  });

  it('shows failed attempts to admins, and people only those that name their account', async () => {
    await insert('auth_events', { source: 'mcp', reason: 'unknown_token', token_prefix: 'dxm_abcd', client_ip: '203.0.113.9' });
    await insert('auth_events', { source: 'mcp', reason: 'revoked_token', account_id: actors.uma.accountId, token_prefix: 'dxm_uma0' });
    expect((await listAuthEvents(db, actors.ada)).map((e) => e.reason).sort()).toEqual(['revoked_token', 'unknown_token']);
    expect((await listAuthEvents(db, actors.uma)).map((e) => e.reason)).toEqual(['revoked_token']);
    expect(await listAuthEvents(db, actors.ned)).toEqual([]);
    expect((await listAuthEvents(db, actors.ada, true))).toEqual([]);
  });
});
