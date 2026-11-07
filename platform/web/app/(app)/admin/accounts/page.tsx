import Link from 'next/link';
import { inviteAccountAction, reissueInviteAction, setAccountRoleAction, setAccountStatusAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Cell, Table } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listAccounts } from '@/lib/server/accounts';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';

export default async function AccountsPage() {
  const actor = await requireAdmin();
  const accounts = (await listAccounts(db())).filter((a) => a.type === 'personal');
  return (
    <>
      <PageHeader title="Accounts">Invite people, change roles, and disable accounts.</PageHeader>
      <section className="mb-8 space-y-2">
        <h2 className="font-medium">Invite a person</h2>
        <ActionForm action={inviteAccountAction}>
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required />
          </Field>
          <Field label="Name" htmlFor="invite-name">
            <Input id="invite-name" name="name" />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <select id="invite-role" name="role" className={selectClass}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Button type="submit">Create invite link</Button>
        </ActionForm>
      </section>
      <Table head={['Name', 'Email', 'Role', 'Status', '']} empty={!accounts.length}>
        {accounts.map((account) => (
          <tr key={account.id}>
            <Cell>
              <Link className="underline" href={`/admin/accounts/${account.id}`}>
                {account.name}
              </Link>
            </Cell>
            <Cell>{account.email}</Cell>
            <Cell>
              <Badge variant={account.role === 'admin' ? 'default' : 'secondary'}>{account.role}</Badge>
            </Cell>
            <Cell>{account.status}</Cell>
            <Cell className="flex flex-wrap gap-2">
              {account.status === 'invited' ? (
                <ActionForm action={reissueInviteAction}>
                  <input type="hidden" name="accountId" value={account.id} />
                  <Button type="submit" variant="outline" size="sm">
                    New invite link
                  </Button>
                </ActionForm>
              ) : (
                <ActionForm
                  action={setAccountStatusAction}
                  confirm={account.status === 'active' ? `Disable ${account.name}? Their sessions end now.` : undefined}
                >
                  <input type="hidden" name="accountId" value={account.id} />
                  <input type="hidden" name="status" value={account.status === 'active' ? 'disabled' : 'active'} />
                  <Button type="submit" variant="outline" size="sm" disabled={account.id === actor.accountId}>
                    {account.status === 'active' ? 'Disable' : 'Enable'}
                  </Button>
                </ActionForm>
              )}
              <ActionForm action={setAccountRoleAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="role" value={account.role === 'admin' ? 'user' : 'admin'} />
                <Button type="submit" variant="outline" size="sm">
                  {account.role === 'admin' ? 'Make user' : 'Make admin'}
                </Button>
              </ActionForm>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
