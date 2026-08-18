-- Story 4.14: Flow A Explicit Gym-Account Routing & Auditability. New enum
-- value for the reconciliation job's 4th discrepancy category
-- (wrong_account_settlement, FR-137) -- kept in its own migration file
-- because Postgres cannot reference a newly-added enum value inside the same
-- transaction that adds it, and this codebase's migration runner applies
-- each file as one transaction (confirmed against every other multi-
-- statement migration in this directory applying cleanly as a single unit).
-- The dependent 0054 migration (run_payment_reconciliation_job()'s new
-- detection block) is the first to actually reference this value.

alter type payment_discrepancy_type add value 'wrong_account_settlement';
