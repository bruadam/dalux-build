// ============================================
// Auth Helpers
// Business logic built on top of the server Supabase client. The matching
// public.users row is guaranteed to exist by the on_auth_user_created DB
// trigger (see supabase/migrations/*_add_handle_new_user_trigger.sql), so
// none of these helpers need to insert into `users` themselves.
// ============================================

import { createClient } from "./server";

/**
 * Gets the authenticated user's Supabase auth ID from the session.
 * Returns null if not authenticated.
 */
export async function getAuthUserId(): Promise<string | null> {
  try {
    const client = await createClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();

    if (error) {
      console.error("Error getting user:", error);
      return null;
    }

    return user?.id || null;
  } catch (error) {
    console.error("Error in getAuthUserId:", error);
    return null;
  }
}

/**
 * Looks up the authenticated user's app-level user row (public.users).
 * The row is created automatically at signup by the on_auth_user_created
 * trigger, so this is a lookup only.
 */
export async function getOrCreateAuthUser() {
  const authUserId = await getAuthUserId();

  if (!authUserId) {
    return { userId: null, appUserId: null, userData: null };
  }

  const client = await createClient();

  const { data: appUser, error } = await client
    .from("users")
    .select("*")
    .eq("auth_user_id", authUserId)
    .single();

  if (error) {
    console.error("Error fetching app user:", error);
    return { userId: authUserId, appUserId: null, userData: null };
  }

  return {
    userId: authUserId,
    appUserId: appUser.id,
    userData: appUser,
  };
}

/**
 * Gets the current user's subscription information
 */
export async function getUserSubscription() {
  const { appUserId } = await getOrCreateAuthUser();

  if (!appUserId) {
    return null;
  }

  const client = await createClient();

  const { data: user, error: userError } = await client
    .from("users")
    .select("subscription_tier, webhook_limit, webhook_count, custom_webhook_limit")
    .eq("id", appUserId)
    .single();

  if (userError) {
    console.error("Error fetching user subscription:", userError);
    throw userError;
  }

  return {
    tier: user.subscription_tier,
    webhookLimit: user.webhook_limit,
    currentWebhookCount: user.webhook_count,
    customWebhookLimit: user.custom_webhook_limit,
    remaining: Math.max(0, user.webhook_limit - user.webhook_count),
    isAtLimit: user.webhook_count >= user.webhook_limit,
  };
}

/**
 * Checks if the current user can create a new webhook (not at limit)
 */
export async function canCreateWebhook() {
  const subscription = await getUserSubscription();

  if (!subscription) {
    return false;
  }

  // Free tier with custom limit (negotiated)
  if (subscription.customWebhookLimit !== null) {
    return subscription.currentWebhookCount < subscription.customWebhookLimit;
  }

  // Free tier: max 1 webhook
  if (subscription.tier === "free") {
    return subscription.currentWebhookCount < 1;
  }

  // Pro tier: max 50 webhooks
  if (subscription.tier === "pro") {
    return subscription.currentWebhookCount < 50;
  }

  // Enterprise: unlimited
  return true;
}
