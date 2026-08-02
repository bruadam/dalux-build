# Supabase Database Setup for Dalux Webhook SaaS Platform

## Overview

This directory contains the database schema and migrations for the Dalux Webhook SaaS platform.

## Project Structure

```
supabase/
├── migrations/
│   └── 20260802103932_init.sql      # Initial schema migration
├── config.toml                      # Local Supabase configuration
└── README.md                        # This file
```

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (v2.80.0+ recommended)
- Node.js (v18+)
- Docker (for local development)
- A Supabase project (remote)

## Quick Start

### 1. Install Supabase CLI

```bash
npm install -g supabase
```

### 2. Link to Remote Supabase Project

Navigate to the `webhook-ui` directory and link to your remote project:

```bash
cd /Users/brunoadam/Documents/development/github/dalux-build/webhook-ui

# Login to Supabase
supabase login

# Link to your project (replace with your project ref)
supabase link --project-ref your-project-ref
```

You can find your project ref in:
- Supabase Dashboard URL: `https://app.supabase.com/project/your-project-ref`
- Or run: `supabase projects list`

### 3. Push the Migration

```bash
# Apply the migration to your remote database
supabase migration up
```

This will apply `20260802103932_init.sql` to your Supabase project.

### 4. Verify the Migration

```bash
# List applied migrations
supabase migration list

# Check database status
supabase status
```

## Local Development

### Start Local Supabase

```bash
# Start Supabase services (Postgres, Studio, etc.)
supabase start

# Apply migrations to local database
supabase migration up

# Open local studio at http://localhost:54323
supabase studio
```

### Working with Migrations

#### Create a New Migration

```bash
# Create a new empty migration
supabase migration new add_something

# This creates: supabase/migrations/YYYYMMDDHHMMSS_add_something.sql
```

#### Apply Migrations

```bash
# Apply all pending migrations
supabase migration up

# Apply a specific migration
supabase migration up --file 20260802103932_init.sql
```

#### Reset Database

```bash
# Reset local database (CAUTION: destroys all data!)
supabase db reset

# Re-apply all migrations
supabase migration up
```

## Clerk Integration

The schema is designed to work with Clerk authentication. The key points:

1. **User Table**: Stores Clerk user ID (`clerk_user_id`) which matches the JWT `sub` claim
2. **RLS Policies**: Use `auth.uid()` which returns the Clerk user ID from the JWT
3. **Helper Function**: `get_user_id_from_clerk()` translates Clerk user ID to internal user ID

### Configure Clerk JWT in Supabase

1. In Supabase Dashboard → Authentication → Settings:
   - Enable "Custom JWT"
   - Set JWT Secret to match your Clerk JWT secret
   - Or use the Supabase-provided JWT secret

2. In your Next.js app, ensure Clerk is configured to pass the JWT to Supabase:
   ```ts
   // lib/supabase/client.ts
   import { createClient } from '@supabase/supabase-js'
   import { auth } from '@clerk/nextjs/server'
   
   export async function createClientWithAuth() {
     const { getToken } = auth()
     const token = await getToken()
     
     return createClient(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
       {
         global: {
           headers: {
             Authorization: `Bearer ${token}`
           }
         }
       }
     )
   }
   ```

## Database Schema Overview

### Tables

| Table | Description | Key Fields |
|-------|-------------|------------|
| `users` | User profiles from Clerk | clerk_user_id, subscription_tier, webhook_limit |
| `dalux_credentials` | Dalux API credentials | user_id, name, api_key, base_url |
| `webhooks` | Webhook configurations | user_id, credential_id, job_type, webhook_url |
| `jobs` | Job execution records | webhook_id, user_id, status, files_changed |
| `job_logs` | Detailed execution logs | job_id, level, message, context |
| `webhook_deliveries` | HTTP delivery tracking | job_id, url, status_code, response |
| `subscriptions` | Stripe subscription info | user_id, stripe_subscription_id, plan_name |
| `audit_logs` | User action audit trail | user_id, action, resource_type, old/new_values |

### Row Level Security (RLS)

All tables have RLS enabled with policies that:
- Restrict access to authenticated users only
- Ensure users can only access their own data
- Use Clerk JWT integration via `auth.uid()`

### Triggers

- **updated_at**: Automatically updates timestamp on row updates
- **webhook_count**: Updates user's webhook count when webhooks are created/deleted

### Views

- **user_webhook_usage**: Shows webhook usage per user with remaining count
- **recent_jobs**: Shows recent jobs with webhook and credential info

Both views use `security_invoker = true` to properly enforce RLS.

## Environment Variables

Add these to your `.env.local` file:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# For server-side operations (keep secret!)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

You can find these in:
- Supabase Dashboard → Project Settings → API

## Troubleshooting

### Migration Errors

If you get errors when applying migrations:

1. **Check migration list**:
   ```bash
   supabase migration list
   ```

2. **View migration history**:
   ```bash
   supabase migration history
   ```

3. **Fix and retry**:
   ```bash
   # Make corrections to the migration file
   # Then apply again
   supabase migration up
   ```

### RLS Issues

If queries return no results or permission errors:

1. Verify Clerk JWT is being passed to Supabase
2. Check that `clerk_user_id` in the users table matches the JWT `sub` claim
3. Test with direct SQL in Supabase Studio:
   ```sql
   SELECT * FROM users WHERE clerk_user_id = 'your-clerk-user-id';
   ```

### Connection Issues

1. Verify Supabase CLI is logged in:
   ```bash
   supabase status
   ```

2. Check project linkage:
   ```bash
   supabase status --project-ref your-project-ref
   ```

3. Re-link if needed:
   ```bash
   supabase link --project-ref your-project-ref
   ```

## Best Practices

1. **Always test migrations locally first**:
   ```bash
   supabase start
   supabase migration up
   ```

2. **Use transactions for multiple changes**:
   ```sql
   BEGIN;
   -- Your changes
   COMMIT;
   ```

3. **Add indexes for foreign keys**:
   ```sql
   CREATE INDEX idx_table_foreign_key ON table(foreign_key_id);
   ```

4. **Use `security_invoker = true` for views**:
   ```sql
   CREATE VIEW my_view WITH (security_invoker = true) AS ...
   ```

5. **Test RLS policies**:
   - Use Supabase Studio with different user roles
   - Verify policies with `supabase db advisors` (CLI v2.81.3+)

## Useful Commands

```bash
# Show applied migrations
supabase migration list

# Show migration history
supabase migration history

# Show project status
supabase status

# Generate a new migration from current state
supabase db pull --local

# Reset local database (CAUTION!)
supabase db reset

# Run SQL query directly
supabase db psql -c "SELECT * FROM users;"

# Open PSQL shell
supabase db psql

# Run database advisors (security checks)
supabase db advisors

# Start Supabase services
supabase start

# Stop Supabase services
supabase stop
```

## Resources

- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/managing-migrations)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [Clerk + Supabase Integration](https://supabase.com/docs/guides/auth/clerk)

## Schema Version

This migration (`20260802103932_init.sql`) represents the initial schema for the SaaS platform.

- **Version**: 1.0.0
- **Created**: 2026-08-02
- **Author**: Generated for Dalux Webhook SaaS Platform
- **Dependencies**: Supabase CLI v2.80.0+, PostgreSQL 15+
