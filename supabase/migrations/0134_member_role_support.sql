-- Story 23.1: adds the 'support' value to member_role (GymOS Support staff, FR-178).
--
-- Deliberately the ONLY statement in this migration. Postgres forbids using a newly added enum value in the
-- transaction that added it (precedent: 0060 'supervisor'), so every use of 'support' lives in 0135, which
-- runs as a separate, already-committed transaction after this one.
-- Rollback note: scripts/rollback-0134-member-role-support.sql (an enum value cannot be dropped in place).
alter type member_role add value 'support';
