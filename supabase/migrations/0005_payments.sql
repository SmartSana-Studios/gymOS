create table payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  subscription_id uuid references subscriptions(id),
  amount integer not null,
  currency text not null default 'XAF',
  method payment_method not null,
  status payment_status not null,
  -- Nullable + unique: cash/manual payments have no provider reference; unique still
  -- holds since Postgres allows multiple NULLs in a unique column. The idempotency
  -- constraint this column exists for (FR-035) is exercised by Epic 4's webhook work,
  -- not this story.
  provider_transaction_ref text unique,
  actor_id uuid references users(id),
  reason text,
  created_at timestamptz not null default now()
);

create index idx_payments_gym_id on payments(gym_id);
create index idx_payments_member_id on payments(member_id);

alter table payments enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on payments to authenticated, service_role;
