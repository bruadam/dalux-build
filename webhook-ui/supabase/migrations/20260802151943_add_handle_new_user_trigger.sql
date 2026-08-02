-- ============================================
-- Consolidate app-user provisioning into a single DB trigger.
--
-- Previously, three separate places tried to create the matching
-- public.users row for a new Supabase Auth user (a SQL helper function,
-- a TS "get or create" helper, and a manual insert in the OAuth callback
-- page) — none of them worked, because `users` only had SELECT/UPDATE RLS
-- policies and no INSERT policy. This migration replaces all of that with
-- a SECURITY DEFINER trigger on auth.users, which is the standard Supabase
-- pattern and bypasses RLS entirely for the provisioning insert.
-- ============================================

-- The old RLS-blocked helper is superseded by the trigger below.
drop function if exists public.ensure_app_user_exists();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.users (
        auth_user_id, email, name, avatar_url,
        subscription_tier, webhook_limit, webhook_count
    )
    values (
        new.id,
        coalesce(new.email, new.id::text || '@supabase.com'),
        coalesce(
            new.raw_user_meta_data->>'name',
            new.raw_user_meta_data->>'full_name',
            new.raw_user_meta_data->>'user_name'
        ),
        new.raw_user_meta_data->>'avatar_url',
        'free', 1, 0
    )
    on conflict (auth_user_id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Defense-in-depth: keep RLS internally consistent with the existing
-- SELECT/UPDATE policies, even though app code no longer inserts directly.
create policy "Users can insert their own profile" on users
    for insert
    to authenticated
    with check (auth_user_id = auth.uid());

-- Backfill safety net for any auth.users rows that predate this trigger.
insert into public.users (auth_user_id, email, subscription_tier, webhook_limit, webhook_count)
select au.id, coalesce(au.email, au.id::text || '@supabase.com'), 'free', 1, 0
from auth.users au
where not exists (select 1 from public.users u where u.auth_user_id = au.id)
on conflict (auth_user_id) do nothing;

comment on function public.handle_new_user is 'Creates a public.users row for every new auth.users signup (email/password or OAuth), replacing the old app-level get-or-create logic.';
