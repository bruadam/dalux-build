import { setEmbeddingKeyAction, setHeaderModeAction, setObservabilityAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';
import { getObservabilitySettings } from '@/lib/server/observabilitySettings';
import { getSettings } from '@/lib/server/settings';

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings(db());
  const logging = await getObservabilitySettings(db());
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Embedding key (Mistral)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              With a key set, document text from indexed scopes is sent to Mistral to compute embeddings. Without a key,
              no document text leaves this server. Status: <strong>{settings.embeddingKeySet ? 'key set' : 'no key'}</strong>.
            </p>
            <ActionForm action={setEmbeddingKeyAction}>
              <Field label="New key" htmlFor="embedding-key">
                <Input id="embedding-key" name="apiKey" type="password" autoComplete="off" required />
              </Field>
              <Button type="submit">Save key</Button>
            </ActionForm>
            {settings.embeddingKeySet && (
              <ActionForm action={setEmbeddingKeyAction} confirm="Remove the embedding key?">
                <input type="hidden" name="clear" value="1" />
                <Button type="submit" variant="outline">
                  Remove key
                </Button>
              </ActionForm>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Activity logging and privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Every tool call is logged: who, which tool, connection, project and files, client, outcome and size. Tool
              results and document text are never logged. IP addresses and search text are personal data, so you choose
              what is kept.
            </p>
            <ActionForm action={setObservabilityAction} className="space-y-3">
              <Field label="IP logging" htmlFor="ip-logging">
                <select id="ip-logging" name="ipLogging" className={selectClass} defaultValue={logging.ipLogging}>
                  <option value="full">Full address and forwarded chain</option>
                  <option value="truncated">Truncated (IPv4 /24, IPv6 /48)</option>
                  <option value="off">Off: no address is stored</option>
                </select>
              </Field>
              <Field label="Clear IP addresses after (days)" htmlFor="ip-retention">
                <Input id="ip-retention" name="ipRetentionDays" type="number" min={1} max={3650} defaultValue={logging.ipRetentionDays} required />
              </Field>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="logQueryText" defaultChecked={logging.logQueryText} className="mt-1" />
                <span>
                  <strong>Log search text.</strong> Records the text of searches and name filters in the audit log. Off by
                  default, because queries can name people, companies and projects. Document and task content is never
                  logged either way.
                </span>
              </label>
              <Button type="submit">Save</Button>
            </ActionForm>
            <p className="text-muted-foreground">
              A separate job clears IP addresses (and the forwarded chain) from rows older than the number of days above.
              The rows stay; the audit retention period decides when they are deleted. Keep the IP period shorter.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dalux header mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              When on, MCP clients may also connect with their own Dalux base URL and API key in request headers, without a
              platform account. Off by default. Status: <strong>{settings.headerModeEnabled ? 'on' : 'off'}</strong>.
            </p>
            <ActionForm action={setHeaderModeAction}>
              <input type="hidden" name="enabled" value={settings.headerModeEnabled ? '' : 'on'} />
              <Button type="submit" variant="outline">
                {settings.headerModeEnabled ? 'Turn off' : 'Turn on'}
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
