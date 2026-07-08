-- Core enum types shared across the schema.
-- gen_random_uuid() is built into Postgres core since v13 (this project runs Postgres 17,
-- confirmed via supabase/config.toml [db] major_version = 17), so no pgcrypto/uuid-ossp
-- extension is required for UUID primary keys.

create type gym_status as enum ('active', 'suspended', 'deactivated');

-- Gym-scoped staff/member roles only. Super Admin is a platform-level flag on `users`,
-- not a gym-scoped role, since Super Admin is not tied to any single gym (FR-004).
create type member_role as enum ('member', 'coach', 'receptionist', 'manager', 'owner');

create type subscription_status as enum ('active', 'expiring_soon', 'grace_period', 'expired');

create type plan_type as enum ('pay_per_session', 'monthly', 'coach_inclusive', 'class_only');

create type billing_interval as enum ('monthly', 'annual');

create type payment_method as enum ('mtn_momo', 'orange_money', 'cash', 'bank_transfer', 'manual_momo');

create type payment_status as enum ('pending', 'processing', 'verified', 'flagged');

create type job_status as enum ('success', 'failure');
