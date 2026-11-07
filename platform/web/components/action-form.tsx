'use client';

import { useActionState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { FormState } from '@/lib/form-state';
import { cn } from '@/lib/utils';

/** A form bound to a server action; shows its error or a one-time secret. */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className={className}
    >
      <fieldset disabled={pending} className="flex flex-wrap items-end gap-2">
        {children}
      </fieldset>
      {state.error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.secret && (
        <Alert className="mt-2">
          <AlertDescription>
            <p>{state.secret.label}</p>
            <code className="mt-1 block break-all rounded bg-muted p-2 text-xs select-all">{state.secret.value}</code>
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}
