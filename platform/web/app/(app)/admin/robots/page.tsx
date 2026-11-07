import Link from 'next/link';
import { createRobotAction, reassignRobotOwnerAction, setAccountStatusAction } from '@/app/actions';
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

export default async function RobotsPage() {
  await requireAdmin();
  const all = await listAccounts(db());
  const robots = all.filter((a) => a.type === 'robot');
  const owners = all.filter((a) => a.type === 'personal' && a.status === 'active');
  const ownerOptions = owners.map((o) => (
    <option key={o.id} value={o.id}>
      {o.name}
    </option>
  ));
  return (
    <>
      <PageHeader title="Robots">
        Accounts for agents and automations. They use API tokens only and need an owner.
      </PageHeader>
      <section className="mb-8 space-y-2">
        <h2 className="font-medium">Create a robot</h2>
        <ActionForm action={createRobotAction}>
          <Field label="Name" htmlFor="robot-name">
            <Input id="robot-name" name="name" required />
          </Field>
          <Field label="Description" htmlFor="robot-description">
            <Input id="robot-description" name="description" />
          </Field>
          <Field label="Owner" htmlFor="robot-owner">
            <select id="robot-owner" name="ownerAccountId" className={selectClass} required>
              {ownerOptions}
            </select>
          </Field>
          <Button type="submit">Create robot</Button>
        </ActionForm>
      </section>
      <Table head={['Name', 'Description', 'Owner', 'Status', '']} empty={!robots.length}>
        {robots.map((robot) => (
          <tr key={robot.id}>
            <Cell>
              <Link className="underline" href={`/admin/accounts/${robot.id}`}>
                {robot.name}
              </Link>
            </Cell>
            <Cell>{robot.description}</Cell>
            <Cell>
              {robot.ownerName}{' '}
              {robot.ownerStatus !== 'active' && robot.status === 'active' && (
                <Badge variant="destructive">Owner {robot.ownerStatus}: reassign or disable</Badge>
              )}
            </Cell>
            <Cell>{robot.status}</Cell>
            <Cell className="flex flex-wrap gap-2">
              <ActionForm action={reassignRobotOwnerAction}>
                <input type="hidden" name="robotId" value={robot.id} />
                <select name="ownerAccountId" aria-label="New owner" className={selectClass} defaultValue={robot.ownerAccountId ?? ''}>
                  {ownerOptions}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Set owner
                </Button>
              </ActionForm>
              <ActionForm action={setAccountStatusAction}>
                <input type="hidden" name="accountId" value={robot.id} />
                <input type="hidden" name="status" value={robot.status === 'active' ? 'disabled' : 'active'} />
                <Button type="submit" variant="outline" size="sm">
                  {robot.status === 'active' ? 'Disable' : 'Enable'}
                </Button>
              </ActionForm>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
