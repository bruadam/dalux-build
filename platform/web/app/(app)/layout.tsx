import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { requireActor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const USER_LINKS = [
  { href: '/', label: 'My access' },
  { href: '/memory', label: 'My memory' },
  { href: '/agents', label: 'My agents' },
  { href: '/tokens', label: 'My tokens' },
  { href: '/oauth', label: 'Connected apps' },
];

const ADMIN_LINKS = [
  { href: '/admin/accounts', label: 'Accounts' },
  { href: '/admin/robots', label: 'Robots' },
  { href: '/admin/groups', label: 'Groups' },
  { href: '/admin/connections', label: 'Connections' },
  { href: '/admin/grants', label: 'Grants' },
  { href: '/admin/indexes', label: 'Indexes' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/dalux-users', label: 'Dalux users' },
  { href: '/admin/settings', label: 'Settings' },
];

function NavList({ links }: { links: { href: string; label: string }[] }) {
  return (
    <ul className="space-y-1">
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href} className="block rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent">
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 text-sidebar-foreground">
        <div className="font-semibold">Dalux MCP</div>
        <NavList links={USER_LINKS} />
        {actor.role === 'admin' && (
          <div className="space-y-2">
            <div className="px-2 text-xs font-medium text-muted-foreground uppercase">Admin</div>
            <NavList links={ADMIN_LINKS} />
          </div>
        )}
        <div className="mt-auto space-y-2 text-sm">
          <div className="truncate px-2 text-muted-foreground">{actor.email}</div>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
