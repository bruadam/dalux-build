import { randomBytes } from 'node:crypto';
import type { Db } from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../db/test/testDatabase';
import type { Actor } from '../lib/server/actor';
import { auditCsv, auditJson, listAudit, listOwnActivity, ownActivityExport, parseAuditFilter } from '../lib/server/auditLog';
import { getAuditRetentionDays, setAuditRetentionDays } from '../lib/server/settings';

process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString('base64');

let t: TestDatabase;
let db: Db;
const ids: Record<string, string> = {};
let admin: Actor;
let user: Actor;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  );
  return rows[0].id;
}

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.as('web');
  ids.admin = await insert('accounts', { type: 'personal', email: 'admin@example.com', name: 'Ada', role: 'admin' });
  ids.user = await insert('accounts', { type: 'personal', email: 'uma@example.com', name: 'Uma' });
  ids.main = await insert('connections', { name: 'Main', slug: 'main', base_url: 'https://a.dalux.com', api_key_encrypted: 'x', api_key_last4: 'abcd' });
  ids.other = await insert('connections', { name: 'Other', slug: 'other', base_url: 'https://b.dalux.com', api_key_encrypted: 'x', api_key_last4: 'abcd' });
  admin = { accountId: ids.admin, role: 'admin', name: 'Ada', email: 'admin@example.com' };
  user = { accountId: ids.user, role: 'user', name: 'Uma', email: 'uma@example.com' };

  const tool = (at: string, accountId: string, connectionId: string, action: string, status: string, client = 'laptop') =>
    insert('audit_log', { at, kind: 'tool', account_id: accountId, connection_id: connectionId, action, status, client, project_id: 'p1', capability: 'files:read', duration_ms: 12, dalux_user_id: 'DU1' });
  await tool('2026-01-10T10:00:00Z', ids.user, ids.main, 'search_file_area', 'ok');
  await tool('2026-01-11T10:00:00Z', ids.user, ids.main, 'get_file', 'denied');
  await tool('2026-01-12T10:00:00Z', ids.admin, ids.other, 'search_file_area', 'ok');
  await tool('2026-01-12T12:00:00Z', ids.admin, ids.other, 'list_files', 'error', '=HYPERLINK("http://evil.example")');
  await insert('audit_log', { at: '2026-01-13T10:00:00Z', kind: 'admin', account_id: ids.admin, action: 'grant.create', target_type: 'grant', target_id: 'g1' });
});

afterAll(() => t.drop());

const actions = async (filter: Parameters<typeof listAudit>[2]) => (await listAudit(db, admin, filter)).items.map((row) => row.action).sort();

describe('audit log filter', () => {
  it('filters by time (the end day is included), account, tool, connection, status and kind', async () => {
    expect(await actions({})).toHaveLength(5);
    expect(await actions(parseAuditFilter({ from: '2026-01-11', to: '2026-01-12' }))).toEqual(['get_file', 'list_files', 'search_file_area']);
    expect(await actions({ accountId: ids.user })).toEqual(['get_file', 'search_file_area']);
    expect(await actions({ action: 'search' })).toEqual(['search_file_area', 'search_file_area']);
    expect(await actions({ connectionId: ids.other })).toEqual(['list_files', 'search_file_area']);
    expect(await actions({ status: 'denied' })).toEqual(['get_file']);
    expect(await actions({ kind: 'admin' })).toEqual(['grant.create']);
    expect(await actions({ accountId: ids.user, status: 'ok' })).toEqual(['search_file_area']);
  });

  it('treats % and _ in the tool filter literally and ignores malformed parameters', async () => {
    expect(await actions({ action: '%' })).toEqual([]);
    expect(parseAuditFilter({ account: 'x; drop table', from: 'yesterday', kind: 'other', type: 'ghost' })).toEqual({
      from: undefined, to: undefined, accountId: undefined, connectionId: undefined, action: undefined, status: undefined, kind: undefined,
    });
  });

  it('is for admins only', async () => {
    await expect(listAudit(db, user, {})).rejects.toThrow('Only admins');
    await expect(auditCsv(db, user, {})).rejects.toThrow('Only admins');
  });

  it('pages newest first', async () => {
    const { items, total } = await listAudit(db, admin, {}, 0);
    expect(total).toBe(5);
    expect(items[0].action).toBe('grant.create');
  });
});

describe('activity filters on the new columns', () => {
  let robotId: string;
  beforeAll(async () => {
    robotId = await insert('accounts', { type: 'robot', name: 'Bot', owner_account_id: ids.user });
    const call = (extra: Record<string, unknown>) =>
      insert('audit_log', { at: '2026-02-01T10:00:00Z', kind: 'tool', action: 'list_files', status: 'ok', project_id: 'p7', ...extra });
    await call({ account_id: ids.user, client_ip: '203.0.113.5', client: 'Claude Desktop', auth_method: 'dxm', request_id: 'req-1', denial_reason: null });
    await call({ account_id: ids.user, client_ip: '198.51.100.9', client: 'OAuth: ChatGPT', auth_method: 'dxo', status: 'denied', denial_reason: 'missing_capability' });
    await call({ account_id: robotId, client_ip: '203.0.113.77', client: 'ci', auth_method: 'dxm' });
    await call({ account_id: ids.user, client: 'hosted agent: Weekly', auth_method: 'agent', agent_id: ids.main, agent_name: 'Weekly' });
  });

  const found = async (filter: Parameters<typeof listAudit>[2]) =>
    (await listAudit(db, admin, { projectId: 'p7', ...filter })).items.map((row) => row.client).sort();

  it('filters by project, IP prefix, client and caller type', async () => {
    expect(await found({})).toHaveLength(4);
    expect(await found({ ip: '203.0.113.' })).toEqual(['Claude Desktop', 'ci']);
    expect(await found({ client: 'chatgpt' })).toEqual(['OAuth: ChatGPT']);
    expect(await found({ accountType: 'robot' })).toEqual(['ci']);
    expect(await found({ accountType: 'agent' })).toEqual(['hosted agent: Weekly']);
    expect(await found({ accountType: 'personal' })).toEqual(['Claude Desktop', 'OAuth: ChatGPT']);
    expect(await found({ status: 'denied' })).toEqual(['OAuth: ChatGPT']);
  });

  it('shows the new columns and exports them as CSV and JSON', async () => {
    const [denied] = (await listAudit(db, admin, { projectId: 'p7', status: 'denied' })).items;
    expect(denied).toMatchObject({ clientIp: '198.51.100.9', authMethod: 'dxo', denialReason: 'missing_capability' });
    expect(await auditCsv(db, admin, { projectId: 'p7', status: 'denied' })).toContain('198.51.100.9,dxo,,missing_capability');
    const json = JSON.parse(await auditJson(db, admin, { projectId: 'p7', accountType: 'agent' }));
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ agentName: 'Weekly', authMethod: 'agent' });
  });
});

describe('my activity', () => {
  it('shows people their own calls and nobody else\'s, in the list and in the export', async () => {
    const own = await listOwnActivity(db, user, {});
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((row) => row.accountEmail === 'uma@example.com')).toBe(true);
    const csv = await ownActivityExport(db, user, {}, 'csv');
    expect(csv).not.toContain('admin@example.com');
    expect(JSON.parse(await ownActivityExport(db, user, {}, 'json')).every((row: { accountEmail: string }) => row.accountEmail === 'uma@example.com')).toBe(true);
  });

  it('does not let a person filter their way to someone else\'s rows', async () => {
    const { items } = await listOwnActivity(db, user, { accountId: ids.admin });
    expect(items.every((row) => row.accountEmail === 'uma@example.com')).toBe(true);
  });

  it('narrows an admin to their own rows too', async () => {
    const { items } = await listOwnActivity(db, admin, {});
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((row) => row.accountEmail === 'admin@example.com')).toBe(true);
  });
});

describe('audit log CSV export', () => {
  it('exports the filtered rows with a header, and stops spreadsheet formulas', async () => {
    const csv = await auditCsv(db, admin, { connectionId: ids.other });
    const [header, ...lines] = csv.trim().split('\n');
    expect(header).toBe(
      'time,kind,account,dalux_user_id,client,connection,project_id,action,target,capability,status,duration_ms,client_ip,auth_method,agent,denial_reason,error_code,result_items,result_bytes,request_id',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('2026-01-12T10:00:00.000Z,tool,admin@example.com,DU1,laptop,Other,p1,search_file_area');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

describe('audit retention setting', () => {
  it('defaults to 180 days, can be changed by an admin, and rejects nonsense', async () => {
    expect(await getAuditRetentionDays(db)).toBe(180);
    await setAuditRetentionDays(db, admin, 90);
    expect(await getAuditRetentionDays(db)).toBe(90);
    await expect(setAuditRetentionDays(db, user, 30)).rejects.toThrow('Only admins');
    for (const days of [0, -5, 1.5, 100000]) await expect(setAuditRetentionDays(db, admin, days)).rejects.toThrow('whole number');
    expect(await getAuditRetentionDays(db)).toBe(90);
  });
});
