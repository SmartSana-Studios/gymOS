create table plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  name text not null,
  plan_type plan_type not null,
  price integer not null,
  currency text not null default 'XAF',
  billing_interval billing_interval not null,
  annual_discount_percent integer,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  plan_id uuid not null references plans(id),
  status subscription_status not null,
  start_date date not null,
  expiry_date date not null,
  created_at timestamptz not null default now()
);

create index idx_plans_gym_id on plans(gym_id);
create index idx_subscriptions_gym_id on subscriptions(gym_id);
create index idx_subscriptions_member_id on subscriptions(member_id);

alter table plans enable row level security;
alter table subscriptions enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on plans to authenticated, service_role;
grant select, insert, update, delete on subscriptions to authenticated, service_role;
