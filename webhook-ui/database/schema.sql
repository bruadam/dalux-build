-- ============================================
-- SUPERSEDED — kept for historical reference only.
-- This is the original Clerk-based draft schema. The applied schema lives
-- in supabase/migrations/ (Supabase Auth-based, auth_user_id/auth.users).
-- Do not run this file against the project.
-- ============================================

-- ============================================
-- SaaS Webhook Platform - Supabase Database Schema
-- ============================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================
-- 1. USERS TABLE (References Clerk users)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clerk_user_id VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Subscription info
    subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free', -- 'free', 'pro', 'enterprise'
    webhook_limit INT NOT NULL DEFAULT 1, -- Max webhooks allowed
    custom_webhook_limit INT, -- For negotiated prices
    stripe_customer_id VARCHAR(255), -- For future Stripe integration
    
    -- Usage tracking
    webhook_count INT NOT NULL DEFAULT 0
);

-- Update updated_at on row update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. DALUX CREDENTIALS TABLE
-- Stores Dalux API credentials for each user
-- ============================================
CREATE TABLE IF NOT EXISTS dalux_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Credential details
    name VARCHAR(255) NOT NULL,
    dalux_user_id VARCHAR(255), -- The Dalux user ID
    api_key VARCHAR(255) NOT NULL,
    base_url VARCHAR(512) NOT NULL DEFAULT 'https://node1.field.dalux.com/service/api/',
    
    -- Metadata
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_dalux_credentials_updated_at BEFORE UPDATE ON dalux_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Ensure only one default credential per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_dalux_credentials_default 
    ON dalux_credentials (user_id) 
    WHERE is_default = TRUE;

-- ============================================
-- 3. WEBHOOKS TABLE
-- Defines the webhook configurations
-- ============================================
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id UUID NOT NULL REFERENCES dalux_credentials(id) ON DELETE CASCADE,
    
    -- Webhook configuration
    name VARCHAR(255) NOT NULL,
    job_type VARCHAR(20) NOT NULL CHECK (job_type IN ('change', 'freshness')),
    
    -- Target configuration (what to monitor)
    project_id VARCHAR(255) NOT NULL,
    file_area_id VARCHAR(255) NOT NULL,
    file_ids JSONB, -- Array of file IDs to monitor, null for all
    folder_ids JSONB, -- Array of folder IDs to monitor
    
    -- Schedule configuration
    schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('manual', 'hourly', 'daily', 'weekly', 'custom')),
    schedule_cron VARCHAR(100), -- Cron expression for custom schedules
    schedule_interval_hours INT, -- For simple intervals
    
    -- Notification configuration
    webhook_url VARCHAR(1024) NOT NULL, -- URL to call when changes detected
    webhook_method VARCHAR(10) NOT NULL DEFAULT 'POST' CHECK (webhook_method IN ('POST', 'PUT', 'PATCH')),
    webhook_headers JSONB DEFAULT '{}', -- Custom headers
    webhook_payload_template JSONB, -- Template for the payload
    
    -- Filtering
    event_types JSONB DEFAULT '[]', -- Types of events to monitor
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_triggered_at TIMESTAMPTZ,
    
    -- Metadata
    description TEXT,
    tags VARCHAR(255)[],
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index for user's webhooks
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_credential_id ON webhooks(credential_id);

-- ============================================
-- 4. JOBS TABLE
-- Tracks each execution of a webhook
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Job details
    job_type VARCHAR(20) NOT NULL CHECK (job_type IN ('change', 'freshness')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    
    -- Execution info
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    
    -- Result
    files_changed INT DEFAULT 0,
    files_added INT DEFAULT 0,
    files_removed INT DEFAULT 0,
    files_modified INT DEFAULT 0,
    freshness_status VARCHAR(20), -- For freshness jobs
    
    -- Error tracking
    error_message TEXT,
    error_stack TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    
    -- External references
    monitor_job_id VARCHAR(255), -- ID from the monitor service
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_jobs_webhook_id ON jobs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

-- ============================================
-- 5. JOB LOGS TABLE
-- Detailed logs for each job execution
-- ============================================
CREATE TABLE IF NOT EXISTS job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Log level and message
    level VARCHAR(10) NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    
    -- Context
    context JSONB DEFAULT '{}', -- Additional structured data
    
    -- Timing
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_user_id ON job_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_timestamp ON job_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_job_logs_webhook_id ON job_logs(webhook_id);

-- ============================================
-- 6. WEBHOOK DELIVERIES TABLE
-- Tracks the actual HTTP deliveries to the webhook URL
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Delivery details
    url VARCHAR(1024) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INT,
    
    -- Request/Response
    request_headers JSONB DEFAULT '{}',
    request_body TEXT,
    response_headers JSONB DEFAULT '{}',
    response_body TEXT,
    
    -- Timing
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response_time_ms INT,
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_job_id ON webhook_deliveries(job_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);

-- ============================================
-- 7. SUBSCRIPTIONS TABLE (for future Stripe integration)
-- ============================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Stripe info
    stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
    stripe_product_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    
    -- Plan info
    plan_name VARCHAR(255) NOT NULL,
    webhook_limit INT NOT NULL,
    price_decimal DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid', 'incomplete')),
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timing
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. AUDIT LOG TABLE
-- For tracking user actions
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Action details
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    
    -- Metadata
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE dalux_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create a function to get the authenticated user's Clerk ID
CREATE OR REPLACE FUNCTION get_clerk_user_id()
RETURNS VARCHAR AS $$
    SELECT raw_jwt claim ->> 'sub' AS clerk_user_id
    FROM request_jwt()
    WHERE raw_jwt claim ->> 'sub' IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER;

-- Create a function to get the user's internal ID from Clerk ID
CREATE OR REPLACE FUNCTION get_user_id()
RETURNS UUID AS $$
    SELECT id FROM users 
    WHERE clerk_user_id = get_clerk_user_id();
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS Policies for Users
CREATE POLICY "Users can view their own profile" ON users
    FOR SELECT USING (clerk_user_id = get_clerk_user_id());

CREATE POLICY "Users can update their own profile" ON users
    FOR UPDATE USING (clerk_user_id = get_clerk_user_id());

-- RLS Policies for Dalux Credentials
CREATE POLICY "Users can manage their own credentials" ON dalux_credentials
    FOR ALL USING (user_id = get_user_id());

-- RLS Policies for Webhooks
CREATE POLICY "Users can manage their own webhooks" ON webhooks
    FOR ALL USING (user_id = get_user_id());

-- RLS Policies for Jobs
CREATE POLICY "Users can view their own jobs" ON jobs
    FOR SELECT USING (user_id = get_user_id());

CREATE POLICY "Users can update their own jobs" ON jobs
    FOR UPDATE USING (user_id = get_user_id());

-- RLS Policies for Job Logs
CREATE POLICY "Users can view their own job logs" ON job_logs
    FOR SELECT USING (user_id = get_user_id());

-- RLS Policies for Webhook Deliveries
CREATE POLICY "Users can view their own deliveries" ON webhook_deliveries
    FOR SELECT USING (user_id = get_user_id());

-- RLS Policies for Subscriptions
CREATE POLICY "Users can view their own subscriptions" ON subscriptions
    FOR SELECT USING (user_id = get_user_id());

-- RLS Policies for Audit Logs (admin only, or users can see their own actions)
CREATE POLICY "Users can view their own audit logs" ON audit_logs
    FOR SELECT USING (user_id = get_user_id());

-- ============================================
-- TRIGGERS FOR COUNTERS
-- ============================================

-- Update user's webhook count when webhooks are created/deleted
CREATE OR REPLACE FUNCTION update_user_webhook_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users 
        SET webhook_count = webhook_count + 1, updated_at = NOW()
        WHERE id = NEW.user_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users 
        SET webhook_count = webhook_count - 1, updated_at = NOW()
        WHERE id = OLD.user_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_webhook_count_insert
    AFTER INSERT ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_user_webhook_count();

CREATE TRIGGER trigger_update_user_webhook_count_delete
    AFTER DELETE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_user_webhook_count();

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- View for getting user's webhook usage
CREATE OR REPLACE VIEW user_webhook_usage AS
SELECT 
    u.id AS user_id,
    u.clerk_user_id,
    u.subscription_tier,
    u.webhook_limit,
    u.webhook_count,
    u.custom_webhook_limit,
    CASE 
        WHEN u.custom_webhook_limit IS NOT NULL THEN u.custom_webhook_limit
        WHEN u.webhook_count < u.webhook_limit THEN u.webhook_limit - u.webhook_count
        ELSE 0
    END AS remaining_webhooks,
    u.webhook_count >= u.webhook_limit AS is_at_limit
FROM users u;

-- View for getting recent jobs
CREATE OR REPLACE VIEW recent_jobs AS
SELECT 
    j.*,
    w.name AS webhook_name,
    w.project_id,
    w.file_area_id,
    dc.name AS credential_name
FROM jobs j
JOIN webhooks w ON j.webhook_id = w.id
JOIN dalux_credentials dc ON w.credential_id = dc.id
ORDER BY j.created_at DESC
LIMIT 100;

-- ============================================
-- PRE-DEFINED SUBSCRIPTION TIERS
-- ============================================

-- Insert default subscription tiers (run this once after schema creation)
-- Uncomment to populate initial tiers
/*
INSERT INTO users (clerk_user_id, email, name, subscription_tier, webhook_limit)
VALUES 
    ('free-tier-template', 'free@template.com', 'Free Tier', 'free', 1)
ON CONFLICT (clerk_user_id) DO NOTHING;

-- This would be managed by your application logic
-- Free: 1 webhook, 1 EUR per additional up to 10
-- Pro: 15 EUR for up to 50 webhooks
-- Enterprise: Negotiated
*/

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE users IS 'Stores user information synced from Clerk authentication';
COMMENT ON TABLE dalux_credentials IS 'Stores Dalux API credentials (name + API key + userId pairs)';
COMMENT ON TABLE webhooks IS 'Defines webhook configurations for monitoring Dalux files';
COMMENT ON TABLE jobs IS 'Tracks each execution/trigger of a webhook';
COMMENT ON TABLE job_logs IS 'Detailed logs for debugging job executions';
COMMENT ON TABLE webhook_deliveries IS 'Tracks HTTP deliveries to the configured webhook URLs';
COMMENT ON TABLE subscriptions IS 'Stripe subscription information for paid tiers';
COMMENT ON TABLE audit_logs IS 'Audit trail for user actions on the platform';
