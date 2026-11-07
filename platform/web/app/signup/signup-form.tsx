'use client';

import { useActionState } from 'react';
import { signUpAction } from '@/app/actions';
import { Field } from '@/components/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SignupForm({ invite, email, name }: { invite?: string; email?: string; name?: string }) {
  const [state, action, pending] = useActionState(signUpAction, {});
  return (
    <form action={action} className="space-y-4">
      {invite && <input type="hidden" name="invite" value={invite} />}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" defaultValue={email} readOnly={!!email} required />
      </Field>
      <Field label="Name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} required />
      </Field>
      <Field label="Password (at least 8 characters)" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        Create account
      </Button>
    </form>
  );
}
