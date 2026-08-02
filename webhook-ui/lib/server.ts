// ============================================
// Server Utilities for SaaS Webhook Platform
// Extended with Supabase integration and new features
// ============================================

import { readFile } from "node:fs/promises";
import { createClient } from "./supabase/server";
import { getOrCreateAuthUser, getAuthUserId, getUserSubscription, canCreateWebhook } from "./supabase/auth";
import { 
  DaluxCredentialInsert, 
  DaluxCredentialUpdate,
  WebhookInsert, 
  WebhookUpdate,
  JobInsert,
  JobUpdate,
  JobLogInsert,
  PaginationParams,
  calculatePrice,
  getMaxWebhooks,
  SubscriptionTier
} from "@/types/database";

// Re-export existing constants
export const DEFAULT_DALUX_BASE_URL = "https://node1.field.dalux.com/service/api/";

// ============================================
// ERROR HANDLING
// ============================================

export function errorResponse(error: unknown, fallbackStatus = 500) {
  const status = Number.isInteger((error as { status?: number }).status) 
    ? (error as { status: number }).status 
    : fallbackStatus;
  return Response.json(
    { ok: false, error: { message: (error as { message?: string }).message || String(error) } },
    { status },
  );
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class BadRequestError extends ApiError {
  constructor(message = "Bad request") {
    super(message, 400, "BAD_REQUEST");
  }
}

export class RateLimitError extends ApiError {
  constructor(message = "Rate limit exceeded") {
    super(message, 429, "RATE_LIMIT_EXCEEDED");
  }
}

export class SubscriptionError extends ApiError {
  constructor(message = "Subscription limit reached") {
    super(message, 402, "SUBSCRIPTION_REQUIRED");
  }
}

// ============================================
// VALIDATION UTILITIES
// ============================================

export function requireString(value: unknown, name: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    const error = new BadRequestError(`${name} is required`);
    throw error;
  }
  return result;
}

export function requireObject<T>(value: unknown, name: string): T {
  if (typeof value !== "object" || value === null) {
    const error = new BadRequestError(`${name} must be an object`);
    throw error;
  }
  return value as T;
}

export function requireArray<T>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) {
    const error = new BadRequestError(`${name} must be an array`);
    throw error;
  }
  return value as T[];
}

export function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    const error = new BadRequestError(`${name} must be a boolean`);
    throw error;
  }
  return value;
}

export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || isNaN(value)) {
    const error = new BadRequestError(`${name} must be a number`);
    throw error;
  }
  return value;
}

export function validateEmail(email: string): string {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new BadRequestError("Invalid email format");
  }
  return email;
}

export function validateUrl(url: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    throw new BadRequestError("Invalid URL format");
  }
}

// ============================================
// AUTHENTICATION
// Using Supabase Auth
// ============================================

/**
 * Requires authentication and returns the Supabase auth user ID.
 * Throws UnauthorizedError if not authenticated.
 */
export async function requireAuth(): Promise<string> {
  const userId = await getAuthUserId();
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}

/**
 * Requires authentication and returns the app user ID.
 * Creates the app user in Supabase if they don't exist.
 */
export async function requireAuthUser() {
  const { userId, appUserId, userData } = await getOrCreateAuthUser();
  
  if (!userId || !appUserId) {
    throw new UnauthorizedError();
  }
  
  return { userId, appUserId, userData };
}

/**
 * Checks if the current user has access to a specific resource (by user_id)
 */
export async function requireResourceAccess(resourceAppUserId: string) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  if (!currentAppUserId) {
    throw new UnauthorizedError();
  }
  
  if (resourceAppUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to access this resource");
  }
  
  return currentAppUserId;
}

// ============================================
// DALUX BASE URL VALIDATION
// ============================================

const ALLOWED_BASE_URL_HOST_SUFFIX = ".dalux.com";
const ALLOWED_BASE_URL_HOST = "dalux.com";

export function resolveBaseUrl(value: unknown): string {
  const raw = (
    (typeof value === "string" && value.trim()) ||
    process.env.DALUX_BASE_URL ||
    DEFAULT_DALUX_BASE_URL
  );
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    const error = new BadRequestError("Dalux base URL must be a valid URL");
    throw error;
  }
  if (parsed.protocol !== "https:") {
    const error = new BadRequestError("Dalux base URL must use HTTPS");
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname !== ALLOWED_BASE_URL_HOST &&
    !hostname.endsWith(ALLOWED_BASE_URL_HOST_SUFFIX)
  ) {
    const error = new BadRequestError(
      `Dalux base URL host must be ${ALLOWED_BASE_URL_HOST} or a subdomain of it`,
    );
    throw error;
  }
  return raw;
}

// ============================================
// MONITOR TOKEN
// ============================================

export async function monitorToken(): Promise<string> {
  if (process.env.MONITOR_API_TOKEN_FILE) {
    return (await readFile(process.env.MONITOR_API_TOKEN_FILE, "utf8")).trim();
  }
  return requireString(process.env.MONITOR_API_TOKEN, "MONITOR_API_TOKEN");
}

// ============================================
// PAGINATION UTILITIES
// ============================================

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export function paginate<T>(
  data: T[],
  total: number,
  params: PaginationParams = {}
): PaginationResult<T> {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const totalPages = Math.ceil(total / pageSize);
  
  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

// ============================================
// SUBSCRIPTION & PRICING UTILITIES
// ============================================

/**
 * Checks if user can create a new webhook based on their subscription
 */
export async function checkWebhookLimit(): Promise<{
  canCreate: boolean;
  currentCount: number;
  limit: number;
  tier: SubscriptionTier;
  error?: string;
}> {
  const subscription = await getUserSubscription();
  
  if (!subscription) {
    return {
      canCreate: false,
      currentCount: 0,
      limit: 0,
      tier: 'free',
      error: 'Not authenticated',
    };
  }
  
  const limit = getMaxWebhooks(subscription.tier, subscription.customWebhookLimit);
  const canCreate = subscription.currentWebhookCount < limit;
  
  return {
    canCreate,
    currentCount: subscription.currentWebhookCount,
    limit: limit === Infinity ? 9999 : limit,
    tier: subscription.tier,
    error: canCreate ? undefined : `You have reached your limit of ${limit} webhooks`,
  };
}

/**
 * Calculates the price for adding a new webhook
 */
export async function calculateNewWebhookPrice(): Promise<{
  currentPrice: number;
  nextPrice: number;
  tier: SubscriptionTier;
  currency: string;
}> {
  const subscription = await getUserSubscription();
  
  if (!subscription) {
    return { currentPrice: 0, nextPrice: 1, tier: 'free', currency: 'EUR' };
  }
  
  const currentCount = subscription.currentWebhookCount + 1; // +1 for the new one
  const priceInfo = calculatePrice(currentCount);
  
  return {
    currentPrice: calculatePrice(subscription.currentWebhookCount).price,
    nextPrice: priceInfo.price,
    tier: priceInfo.tier,
    currency: 'EUR',
  };
}

// ============================================
// AUDIT LOGGING
// ============================================

export async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | null = null,
  oldValues: Record<string, unknown> | null = null,
  newValues: Record<string, unknown> | null = null
): Promise<void> {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    const client = await createClient();

    await client.from('audit_logs').insert({
      user_id: appUserId || null,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_values: oldValues,
      new_values: newValues,
    });
  } catch (error) {
    // Don't fail the main operation if audit logging fails
    console.error('Failed to log audit:', error);
  }
}

// ============================================
// DATA ACCESS LAYER - DALUX CREDENTIALS
// ============================================

export async function getDaluxCredentials(appUserId: string) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  // Verify access to this user's credentials
  if (appUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to access these credentials");
  }
  
  const client = await createClient();
  
  const { data, error } = await client
    .from('dalux_credentials')
    .select('*')
    .eq('user_id', appUserId)
    .order('created_at', { ascending: false });
  
  if (error) {
    throw error;
  }
  
  return data;
}

export async function getDaluxCredentialById(id: string, appUserId: string) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  // Verify access to this credential
  if (appUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to access this credential");
  }
  
  const client = await createClient();
  
  const { data, error } = await client
    .from('dalux_credentials')
    .select('*')
    .eq('id', id)
    .eq('user_id', appUserId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Dalux credential not found');
    }
    throw error;
  }
  
  return data;
}

export async function getDefaultCredential(appUserId: string) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  // Verify access to this user's credentials
  if (appUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to access these credentials");
  }
  
  const client = await createClient();
  
  const { data, error } = await client
    .from('dalux_credentials')
    .select('*')
    .eq('user_id', appUserId)
    .eq('is_default', true)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    throw error;
  }
  
  return data || null;
}

export async function createDaluxCredential(input: DaluxCredentialInsert) {
  const { appUserId } = await getOrCreateAuthUser();
  
  if (!appUserId) {
    throw new UnauthorizedError();
  }
  
  // Ensure the credential belongs to the current user
  const credentialData: DaluxCredentialInsert = {
    ...input,
    user_id: appUserId,
  };
  
  // Validate base URL
  const validatedBaseUrl = resolveBaseUrl(credentialData.base_url);
  
  const client = await createClient();
  
  const { data, error } = await client
    .from('dalux_credentials')
    .insert({
      ...credentialData,
      base_url: validatedBaseUrl,
    })
    .select('*')
    .single();
  
  if (error) {
    throw error;
  }
  
  await logAudit(
    'create',
    'dalux_credential',
    data.id,
    null,
    data
  );
  
  return data;
}

export async function updateDaluxCredential(
  id: string,
  input: DaluxCredentialUpdate,
  appUserId: string
) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  if (appUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to update this credential");
  }
  
  const client = await createClient();
  
  // Get old values for audit logging
  const oldCredential = await getDaluxCredentialById(id, appUserId);
  
  // Validate base URL if provided
  const updateData: DaluxCredentialUpdate = { ...input };
  if (input.base_url) {
    updateData.base_url = resolveBaseUrl(input.base_url);
  }
  
  const { data, error } = await client
    .from('dalux_credentials')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', appUserId)
    .select('*')
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Dalux credential not found');
    }
    throw error;
  }
  
  await logAudit(
    'update',
    'dalux_credential',
    data.id,
    oldCredential,
    data
  );
  
  return data;
}

export async function deleteDaluxCredential(id: string, appUserId: string) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  if (appUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to delete this credential");
  }
  
  const client = await createClient();
  
  // Get old values for audit logging
  const oldCredential = await getDaluxCredentialById(id, appUserId);
  
  const { error } = await client
    .from('dalux_credentials')
    .delete()
    .eq('id', id)
    .eq('user_id', appUserId);
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Dalux credential not found');
    }
    throw error;
  }
  
  await logAudit(
    'delete',
    'dalux_credential',
    id,
    oldCredential,
    null
  );
}

export async function setDefaultCredential(id: string, appUserId: string) {
  const { appUserId: currentAppUserId } = await getOrCreateAuthUser();
  
  if (appUserId !== currentAppUserId) {
    throw new ForbiddenError("You don't have permission to set default credential");
  }
  
  const client = await createClient();
  
  // First, unset all defaults for this user
  await client
    .from('dalux_credentials')
    .update({ is_default: false })
    .eq('user_id', appUserId);
  
  // Then set the new default
  const { data, error } = await client
    .from('dalux_credentials')
    .update({ is_default: true })
    .eq('id', id)
    .eq('user_id', appUserId)
    .select('*')
    .single();
  
  if (error) {
    throw error;
  }
  
  return data;
}

// ============================================
// DATA ACCESS LAYER - WEBHOOKS
// ============================================

export async function getWebhooks(userId: string, params: PaginationParams = {}) {
  const client = await createClient();
  
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;
  
  const { data, error, count } = await client
    .from('webhooks')
    .select('*, dalux_credentials(name, base_url)', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);
  
  if (error) {
    throw error;
  }
  
  return paginate(data || [], count || 0, params);
}

export async function getWebhookById(id: string, userId: string) {
  const client = await createClient();
  
  const { data, error } = await client
    .from('webhooks')
    .select('*, dalux_credentials(id, name, base_url, dalux_user_id, is_active, is_default, description)')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Webhook not found');
    }
    throw error;
  }
  
  return data;
}

export async function createWebhook(input: WebhookInsert) {
  const { appUserId } = await getOrCreateAuthUser();

  if (!appUserId) {
    throw new UnauthorizedError();
  }

  // Check webhook limit
  const limitCheck = await checkWebhookLimit();
  if (!limitCheck.canCreate) {
    throw new SubscriptionError(limitCheck.error || 'Webhook limit reached');
  }

  // Validate credential belongs to user
  const client = await createClient();
  const { data: credential, error: credError } = await client
    .from('dalux_credentials')
    .select('id')
    .eq('id', input.credential_id)
    .eq('user_id', appUserId)
    .single();
  
  if (credError || !credential) {
    throw new BadRequestError('Invalid credential ID');
  }
  
  // Validate webhook URL
  validateUrl(input.webhook_url);

  const { data, error } = await client
    .from('webhooks')
    // Force the authenticated user's own id, regardless of what the caller
    // passed in `input.user_id` — prevents spoofing another user's rows.
    .insert({ ...input, user_id: appUserId })
    .select('*, dalux_credentials(id, name, base_url, dalux_user_id, is_active, is_default, description)')
    .single();
  
  if (error) {
    throw error;
  }
  
  await logAudit(
    'create',
    'webhook',
    data.id,
    null,
    data
  );
  
  return data;
}

export async function updateWebhook(
  id: string,
  input: WebhookUpdate,
  userId: string
) {
  const client = await createClient();
  
  // Get old values for audit logging
  const oldWebhook = await getWebhookById(id, userId);
  
  // If credential_id is being updated, validate it belongs to user
  if (input.credential_id) {
    const { data: credential, error: credError } = await client
      .from('dalux_credentials')
      .select('id')
      .eq('id', input.credential_id)
      .eq('user_id', userId)
      .single();
    
    if (credError || !credential) {
      throw new BadRequestError('Invalid credential ID');
    }
  }
  
  // Validate webhook URL if provided
  if (input.webhook_url) {
    validateUrl(input.webhook_url);
  }
  
  const { data, error } = await client
    .from('webhooks')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*, dalux_credentials(id, name, base_url, dalux_user_id, is_active, is_default, description)')
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Webhook not found');
    }
    throw error;
  }
  
  await logAudit(
    'update',
    'webhook',
    data.id,
    oldWebhook,
    data
  );
  
  return data;
}

export async function deleteWebhook(id: string, userId: string) {
  const client = await createClient();
  
  // Get old values for audit logging
  const oldWebhook = await getWebhookById(id, userId);
  
  const { error } = await client
    .from('webhooks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Webhook not found');
    }
    throw error;
  }
  
  await logAudit(
    'delete',
    'webhook',
    id,
    oldWebhook,
    null
  );
}

export async function toggleWebhookActive(id: string, userId: string) {
  const client = await createClient();
  
  const { data: current, error: fetchError } = await client
    .from('webhooks')
    .select('is_active')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  
  if (fetchError || !current) {
    throw new NotFoundError('Webhook not found');
  }
  
  const { data, error } = await client
    .from('webhooks')
    .update({ is_active: !current.is_active })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*, dalux_credentials(id, name, base_url, dalux_user_id, is_active, is_default, description)')
    .single();
  
  if (error) {
    throw error;
  }
  
  await logAudit(
    'update',
    'webhook',
    data.id,
    { is_active: current.is_active },
    { is_active: data.is_active }
  );
  
  return data;
}

// ============================================
// DATA ACCESS LAYER - JOBS
// ============================================

export async function getJobs(userId: string, webhookId?: string, params: PaginationParams = {}) {
  const client = await createClient();
  
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;
  
  let query = client
    .from('jobs')
    .select('*, webhooks(name, job_type, project_id)', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (webhookId) {
    query = query.eq('webhook_id', webhookId);
  }
  
  const { data, error, count } = await query.range(offset, offset + pageSize - 1);
  
  if (error) {
    throw error;
  }
  
  return paginate(data || [], count || 0, params);
}

export async function getJobById(id: string, userId: string) {
  const client = await createClient();
  
  const { data, error } = await client
    .from('jobs')
    .select('*, webhooks(*, dalux_credentials(name, base_url))')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Job not found');
    }
    throw error;
  }
  
  return data;
}

export async function createJob(input: JobInsert) {
  const client = await createClient();
  
  const { data, error } = await client
    .from('jobs')
    .insert(input)
    .select('*')
    .single();
  
  if (error) {
    throw error;
  }
  
  await logAudit(
    'create',
    'job',
    data.id,
    null,
    data
  );
  
  return data;
}

export async function updateJob(id: string, input: JobUpdate, userId: string) {
  const client = await createClient();
  
  const oldJob = await getJobById(id, userId);
  
  const { data, error } = await client
    .from('jobs')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('Job not found');
    }
    throw error;
  }
  
  await logAudit(
    'update',
    'job',
    data.id,
    oldJob,
    data
  );
  
  return data;
}

// ============================================
// DATA ACCESS LAYER - JOB LOGS
// ============================================

export async function getJobLogs(jobId: string, userId: string, params: PaginationParams = {}) {
  const client = await createClient();
  
  const page = params.page || 1;
  const pageSize = params.pageSize || 50;
  const offset = (page - 1) * pageSize;
  
  const { data, error, count } = await client
    .from('job_logs')
    .select('*', { count: 'exact' })
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .range(offset, offset + pageSize - 1);
  
  if (error) {
    throw error;
  }
  
  return paginate(data || [], count || 0, params);
}

export async function getLogsByWebhook(webhookId: string, userId: string, params: PaginationParams = {}) {
  const client = await createClient();
  
  const page = params.page || 1;
  const pageSize = params.pageSize || 50;
  const offset = (page - 1) * pageSize;
  
  const { data, error, count } = await client
    .from('job_logs')
    .select('*, jobs(*)', { count: 'exact' })
    .eq('webhook_id', webhookId)
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .range(offset, offset + pageSize - 1);
  
  if (error) {
    throw error;
  }
  
  return paginate(data || [], count || 0, params);
}

export async function createJobLog(input: JobLogInsert) {
  const client = await createClient();
  
  const { data, error } = await client
    .from('job_logs')
    .insert(input)
    .select('*')
    .single();
  
  if (error) {
    throw error;
  }
  
  return data;
}

// ============================================
// STATISTICS & ANALYTICS
// ============================================

export async function getWebhookStats(userId: string) {
  const client = await createClient();
  
  // Get total counts
  const [webhooksCount, jobsCount, logsCount] = await Promise.all([
    client.from('webhooks').select('id', { count: 'exact' }).eq('user_id', userId),
    client.from('jobs').select('id', { count: 'exact' }).eq('user_id', userId),
    client.from('job_logs').select('id', { count: 'exact' }).eq('user_id', userId),
  ]);
  
  // Get recent jobs
  const { data: recentJobs } = await client
    .from('jobs')
    .select('status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  
  // Calculate status distribution
  const statusCounts: Record<string, number> = {};
  recentJobs?.forEach(job => {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
  });
  
  // Get webhook success rates
  const { data: webhooksWithStats } = await client
    .from('webhooks')
    .select('id, name, is_active')
    .eq('user_id', userId);
  
  const webhookSuccessRates = await Promise.all(
    webhooksWithStats?.map(async (webhook) => {
      const { count: totalJobs } = await client
        .from('jobs')
        .select('id', { count: 'exact' })
        .eq('webhook_id', webhook.id);
      
      const { count: successfulJobs } = await client
        .from('jobs')
        .select('id', { count: 'exact' })
        .eq('webhook_id', webhook.id)
        .eq('status', 'completed');
      
      return {
        webhookId: webhook.id,
        webhookName: webhook.name,
        totalJobs: totalJobs || 0,
        successfulJobs: successfulJobs || 0,
        successRate: totalJobs > 0 ? Math.round(((successfulJobs || 0) / totalJobs) * 100) : 0,
      };
    }) || []
  );
  
  return {
    totals: {
      webhooks: webhooksCount.count || 0,
      jobs: jobsCount.count || 0,
      logs: logsCount.count || 0,
    },
    jobStatusDistribution: statusCounts,
    webhookSuccessRates,
  };
}

export async function getDailyStats(userId: string, days = 30) {
  const client = await createClient();
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const { data, error } = await client
    .from('jobs')
    .select('created_at, status')
    .eq('user_id', userId)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true });
  
  if (error) {
    throw error;
  }
  
  // Group by date
  const dailyStats: Record<string, { total: number; completed: number; failed: number }> = {};
  
  data?.forEach(job => {
    const date = job.created_at.split('T')[0];
    if (!dailyStats[date]) {
      dailyStats[date] = { total: 0, completed: 0, failed: 0 };
    }
    dailyStats[date].total++;
    if (job.status === 'completed') dailyStats[date].completed++;
    if (job.status === 'failed') dailyStats[date].failed++;
  });
  
  return dailyStats;
}
