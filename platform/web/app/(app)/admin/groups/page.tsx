import { addMemberAction, createGroupAction, deleteGroupAction, removeMemberAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { listAccounts } from '@/lib/server/accounts';
import { db } from '@/lib/server/db';
import { listGroups } from '@/lib/server/groups';
import { requireAdmin } from '@/lib/server/session';

export default async function GroupsPage() {
  await requireAdmin();
  const [groups, accounts] = await Promise.all([listGroups(db()), listAccounts(db())]);
  return (
    <>
      <PageHeader title="Groups">Grants given to a group apply to all its members, people and robots.</PageHeader>
      <section className="mb-8 space-y-2">
        <h2 className="font-medium">Create a group</h2>
        <ActionForm action={createGroupAction}>
          <Field label="Name" htmlFor="group-name">
            <Input id="group-name" name="name" required />
          </Field>
          <Field label="Description" htmlFor="group-description">
            <Input id="group-description" name="description" />
          </Field>
          <Button type="submit">Create group</Button>
        </ActionForm>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const memberIds = new Set(group.members.map((m) => m.accountId));
          return (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle>{group.name}</CardTitle>
                {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1 text-sm">
                  {group.members.map((member) => (
                    <li key={member.accountId} className="flex items-center justify-between gap-2">
                      <span>
                        {member.name} {member.type === 'robot' && <span className="text-muted-foreground">(robot)</span>}
                      </span>
                      <ActionForm action={removeMemberAction}>
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="accountId" value={member.accountId} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </ActionForm>
                    </li>
                  ))}
                  {!group.members.length && <li className="text-muted-foreground">No members.</li>}
                </ul>
                <ActionForm action={addMemberAction}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <select name="accountId" aria-label="Account to add" className={selectClass} required>
                    {accounts
                      .filter((a) => !memberIds.has(a.id))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} {a.type === 'robot' ? '(robot)' : ''}
                        </option>
                      ))}
                  </select>
                  <Button type="submit" variant="outline" size="sm">
                    Add member
                  </Button>
                </ActionForm>
                <ActionForm action={deleteGroupAction} confirm={`Delete group ${group.name} and its grants?`}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <Button type="submit" variant="destructive" size="sm">
                    Delete group
                  </Button>
                </ActionForm>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
