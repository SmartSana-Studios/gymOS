# Restore test (V1.6 gate for 0115)

Purpose: prove that a `db-backup` dump can actually be decrypted and restored, and record the date.
Until it has been done once, the runbook line "last tested restore" stays **never tested**
(`docs/decisions.md`, V1.6 release runbook, section 3). Nothing here touches production: the dump
is read from R2 and restored into a throwaway local database.

You need, on your own machine (not the devcontainer's containers, which have no network):

- the **age private key** (the owner's; only the public key is a repo secret),
- R2 read access (the same R2 credentials as the workflow) with the `aws` CLI or `rclone`,
- PostgreSQL 17 client tools (`pg_restore`, `psql`), or use the local Supabase DB container's copies.

## 1. Fetch and decrypt the newest dump

```bash
export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_DEFAULT_REGION=auto
EP="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
aws s3 ls "s3://<R2_BUCKET>/db/" --endpoint-url "$EP" | sort | tail -4      # db.<stamp>.dump.age, roles.<stamp>.sql.age
aws s3 cp "s3://<R2_BUCKET>/db/db.<stamp>.dump.age" . --endpoint-url "$EP"
age -d -i ~/path/to/age-private-key.txt -o db.dump db.<stamp>.dump.age
pg_restore --list db.dump | head -20                                         # must list schemas/tables, no error
```

Record: dump timestamp, size, and that `--list` worked.

## 2. Restore into a scratch database (local Supabase container)

```bash
docker cp db.dump supabase_db_gym_os:/tmp/db.dump
docker exec supabase_db_gym_os psql -U postgres -c "drop database if exists restore_test"
docker exec supabase_db_gym_os psql -U postgres -c "create database restore_test"
docker exec supabase_db_gym_os pg_restore -U postgres -d restore_test --no-owner --no-privileges /tmp/db.dump 2>&1 | tail -20
```

Expected: some errors about pre-existing Supabase-managed objects (extensions, `auth`/`storage`
internals) are normal for a restore into a non-Supabase database. Note them; stop on anything else.
It is a **schema + data** proof, not a running app.

## 3. Verify

```bash
docker exec supabase_db_gym_os psql -U postgres -d restore_test -At -c "
select 'head', max(version) from supabase_migrations.schema_migrations;
select 'gyms', count(*) from public.gyms;
select 'members', count(*) from public.members;
select 'payments', count(*) from public.payments;
select 'subscriptions', count(*) from public.subscriptions;
select 'audit_log', count(*) from public.audit_log;
select 'guest_sessions table', count(*) from information_schema.tables where table_name='guest_sessions';"
```

Compare with production (read-only): the counts should match or be slightly behind the dump time.
The head must equal the production head (`0116` at the time of writing).

## 4. Known limits to write down

- **Vault secrets (per-gym Tara credentials) do not decrypt in another instance.** The Vault key
  belongs to the project. After any restore into a *new* project, every gym must reconnect Tara
  under Settings -> Payment account. A dump alone is not enough to recover payments.
- **Storage files** are not in the dump; they are copied to `R2:<bucket>/storage` by the same
  workflow (plain, bucket is private). Check one file exists there.
- **RTO** is not measured by this test; note how long steps 1-3 took.

## 5. Clean up and record

```bash
rm -f db.dump db.*.age
docker exec supabase_db_gym_os psql -U postgres -c "drop database restore_test"
docker exec supabase_db_gym_os rm -f /tmp/db.dump
```

Then edit `docs/decisions.md`, V1.6 release runbook, section 3: replace "Last tested restore:
never tested" with the date, dump stamp and the counts, and tell Claude so the gate is closed.
