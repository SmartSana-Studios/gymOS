#!/usr/bin/env python3
"""Refuse unless a fresh, GREEN db-backup run exists (docs/decisions.md, "V1.6 release runbook", section 3: trigger db-backup
immediately before each production migration and confirm it green). The deploy scripts call this before they apply anything.

  uv run --no-project python scripts/lib/require-db-backup.py

Behaviour:
  1. A successful db-backup run that started within --max-age-minutes (default 30) is reused. One backup before a batch of
     migrations is enough; the check is not repeated per migration inside one script.
  2. Otherwise a db-backup run already in flight (started within the same window) is waited for.
  3. Otherwise a new run is triggered (workflow_dispatch) and waited for. A run that ends in anything but success, or does not
     finish within --timeout-seconds, makes this exit 1 and the deploy does not start.
  Skipping on purpose: SKIP_DB_BACKUP="<why, at least 10 characters>" (printed as a warning). An empty or one-word value is refused.

The local clock is only used to decide whether an EXISTING run is fresh; a run this script triggers is found by its id, not by
time, so a skewed clock cannot make it accept a stale run as the new one (it can only make it trigger a new run when unsure).
Needs the gh CLI logged in with permission to run workflows. Exit 0 = go ahead, 1 = do not deploy, 2 = misuse.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

WORKFLOW = "db-backup.yaml"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--gh", default=os.environ.get("GH_BIN", "gh"))
    p.add_argument("--max-age-minutes", type=float, default=float(os.environ.get("BACKUP_MAX_AGE_MINUTES", "30")))
    p.add_argument("--timeout-seconds", type=float, default=float(os.environ.get("BACKUP_WAIT_SECONDS", "900")))
    p.add_argument("--find-seconds", type=float, default=120, help="how long to wait for a triggered run to appear")
    p.add_argument("--poll-seconds", type=float, default=15)
    return p.parse_args()


def say(msg):
    print(f"db-backup: {msg}", flush=True)


def run_gh(gh, args):
    try:
        return subprocess.run([gh, *args], capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        say(f"the GitHub CLI '{gh}' is not installed; cannot check or trigger the backup. Refusing.")
        sys.exit(1)
    except subprocess.TimeoutExpired:
        say("the GitHub CLI timed out. Refusing.")
        sys.exit(1)


def list_runs(gh):
    r = run_gh(gh, ["run", "list", "--workflow", WORKFLOW, "--limit", "15", "--json", "databaseId,status,conclusion,createdAt,event"])
    if r.returncode != 0:
        say(f"could not list db-backup runs ({r.stderr.strip()[:200]}). Refusing.")
        sys.exit(1)
    try:
        return json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        say("could not read the run list. Refusing.")
        sys.exit(1)


def started(run):
    return datetime.fromisoformat(run["createdAt"].replace("Z", "+00:00"))


def main():
    a = parse_args()

    skip = os.environ.get("SKIP_DB_BACKUP", "").strip()
    if skip:
        if len(skip) < 10 or " " not in skip:
            say("SKIP_DB_BACKUP needs a real reason (at least 10 characters and more than one word). Refusing.")
            sys.exit(1)
        say(f"WARNING: SKIPPED ON PURPOSE. Reason given: {skip}")
        sys.exit(0)

    window = timedelta(minutes=a.max_age_minutes)
    now = datetime.now(timezone.utc)
    runs = list_runs(a.gh)

    fresh = [r for r in runs if r["status"] == "completed" and r.get("conclusion") == "success" and now - started(r) <= window]
    if fresh:
        r = fresh[0]
        say(f"using green run {r['databaseId']} from {r['createdAt']} (within {a.max_age_minutes:g} minutes).")
        return 0

    inflight = [r for r in runs if r["status"] != "completed" and now - started(r) <= window]
    if inflight:
        target = inflight[0]["databaseId"]
        say(f"run {target} is already in progress; waiting for it.")
    else:
        before = {r["databaseId"] for r in runs}
        say("no fresh green run; triggering one (workflow_dispatch).")
        t = run_gh(a.gh, ["workflow", "run", WORKFLOW])
        if t.returncode != 0:
            say(f"could not trigger the workflow ({t.stderr.strip()[:200]}). Refusing.")
            return 1
        deadline = time.monotonic() + a.find_seconds
        target = None
        while time.monotonic() < deadline:
            time.sleep(min(a.poll_seconds, 5))
            new = [r for r in list_runs(a.gh) if r["databaseId"] not in before and r.get("event") == "workflow_dispatch"]
            if new:
                target = new[0]["databaseId"]
                break
        if target is None:
            say(f"the triggered run did not appear within {a.find_seconds:g}s. Refusing.")
            return 1
        say(f"triggered run {target}; waiting for it.")

    deadline = time.monotonic() + a.timeout_seconds
    while time.monotonic() < deadline:
        run = next((r for r in list_runs(a.gh) if r["databaseId"] == target), None)
        if run and run["status"] == "completed":
            if run.get("conclusion") == "success":
                say(f"run {target} finished green. Safe to deploy.")
                return 0
            say(f"run {target} finished '{run.get('conclusion')}'. NOT deploying: fix the backup first.")
            return 1
        time.sleep(a.poll_seconds)
    say(f"run {target} did not finish within {a.timeout_seconds:g}s. NOT deploying.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
