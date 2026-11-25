// Put the local database back the way ci-local expects: delete the QA gym and its accounts, and turn the engagement epoch OFF (NULL).
// Run this before scripts/ci-local.sh or any pgTAP run: the engagement tests assume a pristine local database with the epoch unset.
//   node scripts/epic30-31-qa/teardown.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { here } from "../epic19-qa/lib.mjs";
import path from "node:path";
import { psql, setEpoch } from "./lib.mjs";
execFileSync("docker", ["exec", "-i", "supabase_db_gym_os", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: readFileSync(path.join(here, "reset.sql")), stdio: ["pipe", "inherit", "inherit"] });
setEpoch(null);
psql("begin; set local session_replication_role = replica; delete from private.engagement_reminder_dispatches; commit;");
console.log("QA gym removed, epoch NULL.");
