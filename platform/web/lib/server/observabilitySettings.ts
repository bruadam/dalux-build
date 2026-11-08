import { settings, type Db, type IpLogging } from '@dalux-platform/db';
import type { Actor } from './actor';
import { UserError } from './errors';
import { upsertSettings } from './settings';

export interface ObservabilitySettings {
  logQueryText: boolean;
  ipLogging: IpLogging;
  ipRetentionDays: number;
}

export async function getObservabilitySettings(db: Db): Promise<ObservabilitySettings> {
  const [row] = await db
    .select({ logQueryText: settings.logQueryText, ipLogging: settings.ipLogging, ipRetentionDays: settings.ipRetentionDays })
    .from(settings);
  return row ? { ...row, ipLogging: row.ipLogging as IpLogging } : { logQueryText: false, ipLogging: 'full', ipRetentionDays: 90 };
}

export async function setObservabilitySettings(db: Db, actor: Actor, values: ObservabilitySettings): Promise<void> {
  if (!['full', 'truncated', 'off'].includes(values.ipLogging)) throw new UserError('Choose full, truncated or off for IP logging');
  if (!Number.isInteger(values.ipRetentionDays) || values.ipRetentionDays < 1 || values.ipRetentionDays > 3650) {
    throw new UserError('Enter a whole number of days from 1 to 3650 for IP retention');
  }
  await upsertSettings(db, actor, 'settings.observability.set', values);
}
