import { redirect } from "next/navigation";
import { getWebhooks } from "@/lib/server";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";
import { WebhooksTable } from "@/components/webhooks/webhooks-table";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const { appUserId } = await getOrCreateAuthUser();
  if (!appUserId) {
    redirect("/login");
  }

  const { data: webhooks } = await getWebhooks(appUserId, { pageSize: 100 });

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <WebhooksTable initialWebhooks={webhooks} />
    </div>
  );
}
