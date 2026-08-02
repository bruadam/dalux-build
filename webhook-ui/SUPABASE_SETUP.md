# Supabase Database Setup - Complete Guide

## ✅ What Has Been Created

The following files have been created for your Dalux Webhook SaaS Platform:

### Database Migration
```
supabase/
├── migrations/
│   └── 20260802103932_init.sql      # ✅ Complete schema with 8 tables, RLS, triggers, views
├── config.toml                      # ✅ Local Supabase configuration template
└── README.md                        # ✅ Comprehensive setup documentation
```

### Application Files Updated/Created
```
webhook-ui/
├── .env.local.example               # ✅ Updated with Supabase environment variables
├── types/
│   └── database.ts                  # ✅ Complete TypeScript type definitions
├── lib/
│   ├── server.ts                    # ✅ Extended server utilities (replaces server.js)
│   └── supabase/
│       └── client.ts                # ✅ Supabase client with Clerk JWT integration
└── database/
    └── schema.sql                   # ⚠️ Original schema (kept for reference)
```

## 🚀 Quick Start Commands

### 1. Navigate to your project
```bash
cd /Users/brunoadam/Documents/development/github/dalux-build/webhook-ui
```

### 2. Login to Supabase
```bash
supabase login
```

### 3. Link to your project
```bash
# Find your project ref in Supabase Dashboard URL
# https://app.supabase.com/project/YOUR-PROJECT-REF
supabase link --project-ref YOUR-PROJECT-REF
```

### 4. Apply the migration
```bash
supabase migration up
```

### 5. Verify
```bash
# List applied migrations
supabase migration list

# Check project status
supabase status
```

## 📋 Step-by-Step Setup Guide

### Step 1: Prerequisites

Ensure you have:
- ✅ Node.js v18+
- ✅ Docker running (for local development)
- ✅ Supabase CLI installed (`npm install -g supabase`)
- ✅ A Supabase project created at https://app.supabase.com
- ✅ Clerk account with JWT secret configured

### Step 2: Configure Environment Variables

Add to your `.env.local` file:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Find these values:**
1. Go to https://app.supabase.com/project/YOUR-PROJECT-REF/settings/api
2. Copy `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
3. Copy `anon key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Copy `service_role key` → `SUPABASE_SERVICE_ROLE_KEY`

### Step 3: Configure Clerk JWT in Supabase

1. In Supabase Dashboard → Authentication → Settings
2. Scroll to **JWT Settings**
3. **Enable Custom JWT**
4. Set **JWT Secret** to match your Clerk JWT Secret
   - Find in Clerk Dashboard → Settings → API Keys → JWT Key
5. Click **Save**

### Step 4: Link Supabase Project

```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR-PROJECT-REF

# Verify linkage
supabase status
```

### Step 5: Apply Migration

```bash
# Apply the initial schema
supabase migration up

# Verify migration was applied
supabase migration list
```

Expected output:
```
Version     | Name                    | Status    | Executed At
-----------+-------------------------+------------+---------------
20260802103932 | init                   | applied   | 2026-08-02...
```

### Step 6: Test the Database

You can test the database by:

1. **Using Supabase Studio**:
   - Go to https://app.supabase.com/project/YOUR-PROJECT-REF/table-editor
   - Verify tables exist: users, dalux_credentials, webhooks, jobs, etc.

2. **Using CLI**:
   ```bash
   # Run a test query
   supabase db psql -c "SELECT * FROM users;"
   ```

3. **Using API**:
   ```bash
   # Test with curl (replace with your URL and key)
   curl -H "apikey: YOUR_ANON_KEY" \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     https://YOUR-PROJECT-REF.supabase.co/rest/v1/users -v
   ```

## 🛠️ Local Development

### Start Local Supabase

```bash
# Start local Supabase services
supabase start

# Apply migrations
supabase migration up

# Open local studio at http://localhost:54323
supabase studio
```

### Common Local Commands

```bash
# Stop local services
supabase stop

# Reset local database (CAUTION: destroys all data!)
supabase db reset

# Open PSQL shell
supabase db psql

# Run a query
supabase db psql -c "SELECT * FROM webhooks;"
```

## 📊 Database Schema Summary

### Tables (8)

| # | Table | Purpose | Key Fields |
|---|-------|---------|------------|
| 1 | `users` | User profiles from Clerk | clerk_user_id, subscription_tier, webhook_limit |
| 2 | `dalux_credentials` | Dalux API credentials | user_id, name, api_key, base_url |
| 3 | `webhooks` | Webhook configurations | user_id, credential_id, job_type, webhook_url |
| 4 | `jobs` | Job execution records | webhook_id, user_id, status, files_changed |
| 5 | `job_logs` | Detailed execution logs | job_id, level, message, context |
| 6 | `webhook_deliveries` | HTTP delivery tracking | job_id, url, status_code, response |
| 7 | `subscriptions` | Stripe subscription info | user_id, stripe_subscription_id, plan_name |
| 8 | `audit_logs` | User action audit trail | user_id, action, resource_type |

### Row Level Security (RLS)

All tables have RLS enabled with policies that:
- ✅ Restrict access to **authenticated users only**
- ✅ Ensure users can **only access their own data**
- ✅ Use **Clerk JWT integration** via `auth.uid()`
- ✅ Include proper **WITH CHECK** clauses for updates

### Triggers (3)

1. **update_updated_at_column** - Updates `updated_at` timestamp automatically
2. **trigger_update_user_webhook_count_insert** - Increments webhook count on insert
3. **trigger_update_user_webhook_count_delete** - Decrements webhook count on delete

### Views (2)

1. **user_webhook_usage** - Shows webhook usage with remaining count (security_invoker = true)
2. **recent_jobs** - Shows recent jobs with webhook and credential info (security_invoker = true)

### Indexes (15+)

All foreign keys and frequently queried columns are indexed for performance.

## 🔐 Clerk + Supabase Authentication Flow

### How It Works

1. **User signs in with Clerk** → Receives Clerk JWT
2. **Client passes Clerk JWT to Supabase** → Supabase validates using JWT Secret
3. **Supabase extracts `sub` claim** → This is the Clerk user ID
4. **RLS policies use `auth.uid()`** → Returns the Clerk user ID
5. **Helper function `get_user_id_from_clerk()`** → Looks up internal user ID
6. **All queries filtered by user_id** → Users only see their own data

### Implementation in Next.js

```typescript
// lib/supabase/client.ts
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

export async function createClientWithAuth() {
  const { getToken } = auth();
  const token = await getToken();
  
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
  );
}
```

### User Synchronization

When a user signs in for the first time:

1. **Middleware** (or API route) checks if user exists in Supabase
2. **If not found**, creates a new user record:
   ```sql
   INSERT INTO users (clerk_user_id, email, name, subscription_tier, webhook_limit)
   VALUES ('clerk-user-id', 'user@email.com', 'User Name', 'free', 1);
   ```
3. **User can now access their data** via RLS policies

## 🎯 Next Steps

### After Database Setup

1. **Add the Supabase client to your middleware** (for auto user creation)
2. **Update your API routes** to use the new Supabase client
3. **Create frontend components** for:
   - Credential management
   - Webhook list/create/edit/delete
   - Job history viewing
   - Statistics dashboard
4. **Test thoroughly** with multiple users

### Recommended Order

```
1. Database Setup (DONE ✅)
2. Environment Configuration
3. Middleware for User Sync
4. API Routes
5. Frontend Components
6. Testing
7. Deployment
```

## 📚 Useful Resources

- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/managing-migrations)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [Clerk + Supabase Integration](https://supabase.com/docs/guides/auth/clerk)
- [Supabase Data API](https://supabase.com/docs/guides/api)

## 💡 Tips & Best Practices

### 1. Always Test Migrations Locally
```bash
supabase start
supabase migration up
# Test your app locally
# Then push to remote
supabase migration up --db-url postgresql://postgres:YOUR-PASSWORD@YOUR-PROJECT-REF.supabase.co:5432/postgres
```

### 2. Use Transactions for Multiple Changes
```sql
BEGIN;
  -- Multiple SQL statements
  CREATE TABLE new_table (...);
  CREATE INDEX idx_new_table ON new_table(id);
  ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
COMMIT;
```

### 3. Verify RLS Policies
- Use Supabase Studio signed in as different users
- Test with `supabase db advisors` (CLI v2.81.3+)
- Never use `SECURITY DEFINER` for user-facing functions

### 4. Backup Before Major Changes
```bash
# Create a backup
supabase db dump --db-url postgresql://... > backup.sql

# Restore from backup
supabase db reset
supabase db psql < backup.sql
```

### 5. Monitor Performance
- Check query performance in Supabase Dashboard → Query Editor
- Add indexes for frequently filtered/sorted columns
- Use `EXPLAIN ANALYZE` for slow queries

## 🔧 Troubleshooting

### Problem: Migration fails with syntax error
**Solution**: Check PostgreSQL version compatibility. Supabase uses PostgreSQL 15+.

### Problem: RLS policies not working
**Solution**: 
1. Verify JWT is being passed
2. Check `clerk_user_id` matches JWT `sub` claim
3. Test with `SELECT auth.uid(), clerk_user_id FROM users;`

### Problem: "permission denied for table users"
**Solution**: Ensure you're using the service role key for server-side operations, not the anon key.

### Problem: Migration already applied
**Solution**: 
```bash
# Check migration list
supabase migration list

# If already applied, create a new migration
supabase migration new fix_something
```

### Problem: Supabase CLI not found
**Solution**: 
```bash
npm install -g supabase
# Or use npx
npx supabase --version
```

## 📞 Support

For issues with:
- **Supabase CLI**: Check [CLI Documentation](https://supabase.com/docs/reference/cli/introduction)
- **Database Schema**: Review the migration file carefully
- **Clerk Integration**: Check [Clerk + Supabase Guide](https://supabase.com/docs/guides/auth/clerk)
- **RLS Policies**: Use Supabase Studio to test policies

---

**Database Migration**: `20260802103932_init.sql`  
**Created**: 2026-08-02  
**Status**: Ready to deploy  
**Version**: 1.0.0
