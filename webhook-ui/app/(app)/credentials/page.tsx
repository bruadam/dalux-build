import { redirect } from "next/navigation";
import { getDaluxCredentials } from "@/lib/server";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";
import { CredentialsTable } from "@/components/credentials/credentials-table";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const { appUserId } = await getOrCreateAuthUser();
  if (!appUserId) {
    redirect("/login");
  }

  const credentials = await getDaluxCredentials(appUserId);
  // Never ship the encrypted-at-rest-but-still-sensitive api_key to the client.
  const publicCredentials = (credentials || []).map(({ api_key: _apiKey, ...rest }) => rest);

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <CredentialsTable initialCredentials={publicCredentials} />
    </div>
  );
}
