import { setEmbeddingKeyAction, setHeaderModeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';
import { getSettings } from '@/lib/server/settings';

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings(db());
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
