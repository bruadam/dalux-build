-- ============================================
-- SaaS Webhook Platform - Clean Schema with Supabase Auth
-- This is a complete replacement migration using Supabase's built-in authentication
-- ============================================

-- Enable necessary extensions
SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA extensions;

-- ============================================
-- 1. USERS TABLE
-- Stores additional user information (authentication handled by Supabase Auth)
-- The user_id in all tables references this table's id
-- auth_user_id links to auth.users.id for reference
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
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

-- Trigger to update updated_at on row update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. DALUX CREDENTIALS TABLE
-- Stores Dalux API credentials (name + API key + userId pairs)
-- ============================================
CREATE TABLE dalux_credentials (
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

CREATE TRIGGER update_dalux_credentials_updated_at 
    BEFORE UPDATE ON dalux_credentials 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Ensure only one default credential per user
CREATE UNIQUE INDEX idx_dalux_credentials_default 
    ON dalux_credentials (user_id) 
    WHERE is_default = TRUE;

-- ============================================
-- 3. WEBHOOKS TABLE
-- Defines webhook configurations for monitoring Dalux files
-- ============================================
CREATE TABLE webhooks (
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

CREATE TRIGGER update_webhooks_updated_at 
    BEFORE UPDATE ON webhooks 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Index for user's webhooks
CREATE INDEX idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX idx_webhooks_credential_id ON webhooks(credential_id);

-- ============================================
-- 4. JOBS TABLE
-- Tracks each execution/trigger of a webhook
-- ============================================
CREATE TABLE jobs (
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

CREATE TRIGGER update_jobs_updated_at 
    BEFORE UPDATE ON jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_jobs_webhook_id ON jobs(webhook_id);
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);

-- ============================================
-- 5. JOB LOGS TABLE
-- Detailed logs for debugging job executions
-- ============================================
CREATE TABLE job_logs (
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

CREATE INDEX idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX idx_job_logs_user_id ON job_logs(user_id);
CREATE INDEX idx_job_logs_timestamp ON job_logs(timestamp DESC);
CREATE INDEX idx_job_logs_webhook_id ON job_logs(webhook_id);

-- ============================================
-- 6. WEBHOOK DELIVERIES TABLE
-- Tracks the actual HTTP deliveries to the webhook URL
-- ============================================
CREATE TABLE webhook_deliveries (
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

CREATE INDEX idx_webhook_deliveries_job_id ON webhook_deliveries(job_id);
CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);

-- ============================================
-- 7. SUBSCRIPTIONS TABLE
-- Stripe subscription tracking (for future integration)
-- ============================================
CREATE TABLE subscriptions (
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

CREATE TRIGGER update_subscriptions_updated_at 
    BEFORE UPDATE ON subscriptions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. AUDIT LOG TABLE
-- Audit trail for user actions on the platform
-- ============================================
CREATE TABLE audit_logs (
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

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Using Supabase Auth - auth.uid() returns the authenticated user's UUID
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

-- RLS Policies for Users
CREATE POLICY "Users can view their own profile" ON users
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

CREATE POLICY "Users can update their own profile" ON users
    FOR UPDATE
    TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- RLS Policies for Dalux Credentials
CREATE POLICY "Users can manage their own credentials" ON dalux_credentials
    FOR ALL
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()))
    WITH CHECK (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- RLS Policies for Webhooks
CREATE POLICY "Users can manage their own webhooks" ON webhooks
    FOR ALL
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()))
    WITH CHECK (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- RLS Policies for Jobs
CREATE POLICY "Users can view their own jobs" ON jobs
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can update their own jobs" ON jobs
    FOR UPDATE
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()))
    WITH CHECK (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- RLS Policies for Job Logs
CREATE POLICY "Users can view their own job logs" ON job_logs
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- RLS Policies for Webhook Deliveries
CREATE POLICY "Users can view their own deliveries" ON webhook_deliveries
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- RLS Policies for Subscriptions
CREATE POLICY "Users can view their own subscriptions" ON subscriptions
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- RLS Policies for Audit Logs
CREATE POLICY "Users can view their own audit logs" ON audit_logs
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

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
    FOR EACH ROW
    EXECUTE FUNCTION update_user_webhook_count();

CREATE TRIGGER trigger_update_user_webhook_count_delete
    AFTER DELETE ON webhooks
    FOR EACH ROW
    EXECUTE FUNCTION update_user_webhook_count();

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

CREATE OR REPLACE VIEW user_webhook_usage WITH (security_invoker = true) AS
SELECT
    u.id AS user_id,
    u.auth_user_id,
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

CREATE OR REPLACE VIEW recent_jobs WITH (security_invoker = true) AS
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
-- FUNCTION TO ENSURE USER EXISTS IN APP USERS TABLE
-- This function creates an app user record when a user signs up via Supabase Auth
-- ============================================

CREATE OR REPLACE FUNCTION ensure_app_user_exists()
RETURNS UUID AS $$
DECLARE
    app_user_id UUID;
BEGIN
    -- Check if user already exists in app users table
    SELECT id INTO app_user_id 
    FROM users 
    WHERE auth_user_id = auth.uid();
    
    IF app_user_id IS NOT NULL THEN
        RETURN app_user_id;
    END IF;
    
    -- Create new user in app users table from auth.users
    INSERT INTO users (auth_user_id, email, name, subscription_tier, webhook_limit, webhook_count)
    SELECT 
        auth.uid(),
        COALESCE(
            (SELECT email FROM auth.users WHERE id = auth.uid()),
            auth.uid() || '@supabase.com'
        ),
        COALESCE(
            (SELECT raw_user_meta_data->>'name' FROM auth.users WHERE id = auth.uid()),
            (SELECT raw_user_meta_data->>'user_name' FROM auth.users WHERE id = auth.uid())
        ),
        'free',
        1,
        0
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE auth_user_id = auth.uid())
    RETURNING id INTO app_user_id;
    
    RETURN app_user_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Grant execute on the function to authenticated users
GRANT EXECUTE ON FUNCTION ensure_app_user_exists() TO authenticated;

-- ============================================
-- GRANT PUBLIC ACCESS FOR DATA API
-- ============================================

GRANT SELECT ON user_webhook_usage TO authenticated;
GRANT SELECT ON recent_jobs TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE users IS 'Stores user information synced from Supabase authentication';
COMMENT ON COLUMN users.auth_user_id IS 'References auth.users.id from Supabase Auth';
COMMENT ON TABLE dalux_credentials IS 'Stores Dalux API credentials (name + API key + userId pairs)';
COMMENT ON TABLE webhooks IS 'Defines webhook configurations for monitoring Dalux files';
COMMENT ON TABLE jobs IS 'Tracks each execution/trigger of a webhook';
COMMENT ON TABLE job_logs IS 'Detailed logs for debugging job executions';
COMMENT ON TABLE webhook_deliveries IS 'Tracks HTTP deliveries to the configured webhook URLs';
COMMENT ON TABLE subscriptions IS 'Stripe subscription information for paid tiers';
COMMENT ON TABLE audit_logs IS 'Audit trail for user actions on the platform';
COMMENT ON FUNCTION update_updated_at_column IS 'Automatically updates the updated_at column on row update';
COMMENT ON FUNCTION update_user_webhook_count IS 'Updates user webhook count when webhooks are created or deleted';
COMMENT ON FUNCTION ensure_app_user_exists IS 'Creates app user record if it does not exist, syncing from auth.users';
