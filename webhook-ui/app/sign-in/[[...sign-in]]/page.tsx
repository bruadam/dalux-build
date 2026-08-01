"use client"

import { SignIn } from "@clerk/nextjs"
import { RowsIcon } from "@phosphor-icons/react"

export default function SignInPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <RowsIcon className="size-4" />
          </div>
          Dalux Webhooks
        </a>
        <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" />
      </div>
    </div>
  )
}
