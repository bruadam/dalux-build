// ============================================
// Database Types for SaaS Webhook Platform
// ============================================

// ============================================
// USER TYPES
// Using Supabase Auth instead of Clerk
// ============================================

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface User {
  id: string;
  auth_user_id: string; // References auth.users.id from Supabase Auth
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  subscription_tier: SubscriptionTier;
  webhook_limit: number;
  custom_webhook_limit: number | null;
  stripe_customer_id: string | null;
  webhook_count: number;
}

export interface UserInsert {
  auth_user_id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  subscription_tier?: SubscriptionTier;
  webhook_limit?: number;
  custom_webhook_limit?: number | null;
  stripe_customer_id?: string | null;
}

export interface UserUpdate {
  email?: string;
  name?: string | null;
  avatar_url?: string | null;
  subscription_tier?: SubscriptionTier;
  webhook_limit?: number;
  custom_webhook_limit?: number | null;
  stripe_customer_id?: string | null;
}

// Supabase Auth User (from auth.users table)
export interface SupabaseAuthUser {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  phone: string | null;
  phone_confirmed_at: string | null;
  last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// DALUX CREDENTIAL TYPES
// ============================================

export interface DaluxCredential {
  id: string;
  user_id: string;
  name: string;
  dalux_user_id: string | null;
  api_key: string; // Encrypted in database
  base_url: string;
  is_active: boolean;
  is_default: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface DaluxCredentialInsert {
  user_id: string;
  name: string;
  dalux_user_id?: string | null;
  api_key: string;
  base_url?: string;
  is_active?: boolean;
  is_default?: boolean;
  description?: string | null;
}

export interface DaluxCredentialUpdate {
  name?: string;
  dalux_user_id?: string | null;
  api_key?: string;
  base_url?: string;
  is_active?: boolean;
  is_default?: boolean;
  description?: string | null;
}

// ============================================
// WEBHOOK TYPES
// ============================================

export type JobType = 'change' | 'freshness';
export type ScheduleType = 'manual' | 'hourly' | 'daily' | 'weekly' | 'custom';
export type WebhookMethod = 'POST' | 'PUT' | 'PATCH';

export interface Webhook {
  id: string;
  user_id: string;
  credential_id: string;
  name: string;
  job_type: JobType;
  project_id: string;
  file_area_id: string;
  file_ids: string[] | null; // Array of file IDs to monitor
  folder_ids: string[] | null; // Array of folder IDs to monitor
  schedule_type: ScheduleType;
  schedule_cron: string | null;
  schedule_interval_hours: number | null;
  webhook_url: string;
  test_webhook_url: string | null;
  webhook_method: WebhookMethod;
  webhook_headers: Record<string, string>;
  webhook_payload_template: Record<string, unknown> | null;
  event_types: string[]; // Types of events to monitor
  is_active: boolean;
  is_verified: boolean;
  last_triggered_at: string | null;
  description: string | null;
  tags: string[];
  monitor_job_id: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookInsert {
  user_id: string;
  credential_id: string;
  name: string;
  job_type: JobType;
  project_id: string;
  file_area_id: string;
  file_ids?: string[] | null;
  folder_ids?: string[] | null;
  schedule_type: ScheduleType;
  schedule_cron?: string | null;
  schedule_interval_hours?: number | null;
  webhook_url: string;
  test_webhook_url?: string | null;
  webhook_method?: WebhookMethod;
  webhook_headers?: Record<string, string>;
  webhook_payload_template?: Record<string, unknown> | null;
  event_types?: string[];
  is_active?: boolean;
  description?: string | null;
  tags?: string[];
  monitor_job_id?: string | null;
  next_run_at?: string | null;
}

export interface WebhookUpdate {
  credential_id?: string;
  name?: string;
  job_type?: JobType;
  project_id?: string;
  file_area_id?: string;
  file_ids?: string[] | null;
  folder_ids?: string[] | null;
  schedule_type?: ScheduleType;
  schedule_cron?: string | null;
  schedule_interval_hours?: number | null;
  webhook_url?: string;
  test_webhook_url?: string | null;
  webhook_method?: WebhookMethod;
  webhook_headers?: Record<string, string>;
  webhook_payload_template?: Record<string, unknown> | null;
  event_types?: string[];
  is_active?: boolean;
  description?: string | null;
  tags?: string[];
  monitor_job_id?: string | null;
  next_run_at?: string | null;
}

// ============================================
// JOB TYPES
// ============================================

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  webhook_id: string;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  files_changed: number;
  files_added: number;
  files_removed: number;
  files_modified: number;
  freshness_status: string | null;
  error_message: string | null;
  error_stack: string | null;
  retry_count: number;
  monitor_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobInsert {
  webhook_id: string;
  user_id: string;
  job_type: JobType;
  status?: JobStatus;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  files_changed?: number;
  files_added?: number;
  files_removed?: number;
  files_modified?: number;
  freshness_status?: string | null;
  error_message?: string | null;
  error_stack?: string | null;
  retry_count?: number;
  monitor_job_id?: string | null;
}

export interface JobUpdate {
  status?: JobStatus;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  files_changed?: number;
  files_added?: number;
  files_removed?: number;
  files_modified?: number;
  freshness_status?: string | null;
  error_message?: string | null;
  error_stack?: string | null;
  retry_count?: number;
  monitor_job_id?: string | null;
}

// ============================================
// JOB LOG TYPES
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface JobLog {
  id: string;
  job_id: string;
  webhook_id: string;
  user_id: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
}

export interface JobLogInsert {
  job_id: string;
  webhook_id: string;
  user_id: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

// ============================================
// WEBHOOK DELIVERY TYPES
// ============================================

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'retrying';

export interface WebhookDelivery {
  id: string;
  job_id: string;
  webhook_id: string;
  user_id: string;
  url: string;
  method: WebhookMethod;
  status_code: number | null;
  request_headers: Record<string, string>;
  request_body: string | null;
  response_headers: Record<string, string>;
  response_body: string | null;
  delivered_at: string;
  response_time_ms: number | null;
  status: DeliveryStatus;
  error_message: string | null;
  retry_count: number;
}

export interface WebhookDeliveryInsert {
  job_id: string;
  webhook_id: string;
  user_id: string;
  url: string;
  method: WebhookMethod;
  status_code?: number | null;
  request_headers?: Record<string, string>;
  request_body?: string | null;
  response_headers?: Record<string, string>;
  response_body?: string | null;
  response_time_ms?: number | null;
  status?: DeliveryStatus;
  error_message?: string | null;
  retry_count?: number;
}

// ============================================
// SUBSCRIPTION TYPES
// ============================================

export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'unpaid' | 'incomplete';

export interface Subscription {
  id: string;
  user_id: string;
  stripe_subscription_id: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  plan_name: string;
  webhook_limit: number;
  price_decimal: number;
  currency: string;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionInsert {
  user_id: string;
  stripe_subscription_id: string;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  plan_name: string;
  webhook_limit: number;
  price_decimal: number;
  currency?: string;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  cancel_at_period_end?: boolean;
  current_period_start?: string | null;
  current_period_end?: string | null;
}

// ============================================
// AUDIT LOG TYPES
// ============================================

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogInsert {
  user_id?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============================================
// PRICING TIER CONFIGURATION
// ============================================

export interface PricingTier {
  tier: SubscriptionTier;
  name: string;
  description: string;
  basePrice: number;
  currency: string;
  webhookLimit: number;
  pricePerAdditionalWebhook: number | null; // For tiers with per-webhook pricing
  features: string[];
}

export const PRICING_TIERS: PricingTier[] = [
  {
    tier: 'free',
    name: 'Free',
    description: 'Get started with webhook monitoring',
    basePrice: 0,
    currency: 'EUR',
    webhookLimit: 1,
    pricePerAdditionalWebhook: 1, // 1 EUR per additional webhook
    features: [
      '1 webhook included',
      '1 EUR per additional webhook (up to 10)',
      'Basic monitoring',
      'Job logs',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    description: 'Scale your monitoring',
    basePrice: 15,
    currency: 'EUR',
    webhookLimit: 50,
    pricePerAdditionalWebhook: null,
    features: [
      'Up to 50 webhooks',
      '15 EUR/month',
      'Priority support',
      'Advanced monitoring',
      'Extended retention',
    ],
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    description: 'Custom pricing for large-scale usage',
    basePrice: 0, // Negotiated
    currency: 'EUR',
    webhookLimit: 0, // Unlimited or negotiated
    pricePerAdditionalWebhook: null,
    features: [
      'Unlimited webhooks (negotiated)',
      'Custom pricing',
      'Dedicated support',
      'SLA guarantees',
      'Custom integrations',
    ],
  },
];

// Helper to calculate price for a given webhook count
export function calculatePrice(webhookCount: number): { tier: SubscriptionTier; price: number; nextTier?: SubscriptionTier } {
  if (webhookCount <= 1) {
    return { tier: 'free', price: 0 };
  } else if (webhookCount <= 10) {
    // 1 free + (count - 1) * 1 EUR
    return { tier: 'free', price: (webhookCount - 1) * 1 };
  } else if (webhookCount <= 50) {
    return { tier: 'pro', price: 15 };
  } else {
    return { tier: 'enterprise', price: 0 }; // Contact for pricing
  }
}

// Helper to get max webhooks for a tier
export function getMaxWebhooks(tier: SubscriptionTier, customLimit?: number | null): number {
  if (customLimit !== undefined && customLimit !== null) {
    return customLimit;
  }
  switch (tier) {
    case 'free':
      return 1;
    case 'pro':
      return 50;
    case 'enterprise':
      return Infinity; // Unlimited
    default:
      return 1;
  }
}

// ============================================
// WEBHOOK EXTENDED TYPES (with relations)
// ============================================

export interface WebhookWithCredential extends Webhook {
  credential: DaluxCredential;
}

export interface WebhookWithStats extends Webhook {
  jobCount: number;
  lastJob?: Job;
  successRate: number;
}

// ============================================
// JOB EXTENDED TYPES
// ============================================

export interface JobWithWebhook extends Job {
  webhook: Webhook;
  credential: DaluxCredential;
}

export interface JobWithLogs extends Job {
  logs: JobLog[];
  deliveries: WebhookDelivery[];
}
