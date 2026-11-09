import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepo, checkZone, isValidName, parseZone, GRAMMAR_PATH, LIST_PATH, ZONE_PATH } from "../check-reserved-labels.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const SCRIPT = join(here, "..", "check-reserved-labels.mjs");
const list = { labels: ["mail", "www", "owner", "gym-os"], prefixes: ["gymos"] };
const zone = (body) => `$ORIGIN gymosapps.com.\n$TTL 14400\n${body}\n`;

test("the committed zone export passes against the committed list (24.2)", () => {
  const r = checkRepo(REPO);
  assert.deepEqual(r.problems, []);
  assert.ok(r.checked.includes("webmail") && r.checked.includes("cpanel"));
  assert.ok(r.ignored > 0, "underscore labels are counted as ignored");
});

test("an unreserved zone label fails and names the label and its zone line", () => {
  const r = checkZone(zone("shop IN A 1.2.3.4"), list);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /:3: label "shop"/);
});

test("the gymos prefix reserves gymos-anything", () => {
  assert.deepEqual(checkZone(zone("gymos-demo IN A 1.2.3.4"), list).problems, []);
});

test("non-name owners are ignored and counted, not failures", () => {
  const r = checkZone(
    zone(['@ IN A 1.2.3.4', '* IN CNAME x.example.', '_tcp IN TXT "a"', 'default._domainkey IN TXT "v=DKIM1; k=rsa;"', '_caldav._tcp IN SRV 0 0 1 h.'].join("\n")),
    list,
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.ignored, 4);
  assert.deepEqual(r.checked, []);
});

test("zone syntax: comments, FQDN and relative owners, TTL/class forms, blank owner inherits the previous", () => {
  const { records, errors } = parseZone(
    [
      "$ORIGIN gymosapps.com.",
      "; a comment",
      'mail 300 IN A 1.1.1.1 ; trailing',
      "  IN MX 0 mail",
      "www.gymosapps.com. IN CNAME x.example.",
      "gymosapps.com. IN A 1.1.1.1",
      "a.b IN A 1.1.1.1",
      'txt IN TXT "has ; semicolon"',
    ].join("\n"),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    records.map((r) => r.label),
    ["mail", "mail", "www", null, "b", "txt"],
  );
});

test("multi-line parenthesised records parse as one", () => {
  const { records, errors } = parseZone(zone("@ IN SOA ns. host. (\n 1 ; serial\n 2 3 4 5 )\nmail IN A 1.1.1.1"));
  assert.deepEqual(errors, []);
  assert.deepEqual(records.map((r) => r.label), [null, "mail"]);
});

test("an unparseable line fails with its line number", () => {
  const r = checkZone(zone("this is not a record"), list);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /:3: cannot parse/);
});

test("a bad list entry fails: uppercase, duplicate, grammar-invalid", () => {
  assert.match(checkZone(zone("mail IN A 1.1.1.1"), { labels: ["Mail"], prefixes: [] }).problems[0], /"Mail" is not lowercase/);
  assert.match(checkZone(zone("mail IN A 1.1.1.1"), { labels: ["mail", "mail"], prefixes: [] }).problems[0], /"mail" is listed twice/);
  assert.match(checkZone(zone("mail IN A 1.1.1.1"), { labels: ["mail", "a--b"], prefixes: [] }).problems[0], /"a--b" fails the name grammar/);
  assert.match(checkZone(zone("mail IN A 1.1.1.1"), { labels: ["_dmarc", "mail"], prefixes: [] }).problems[0], /"_dmarc" fails/);
});

test("a missing zone export or list fails with the path", () => {
  const root = mkdtempSync(join(tmpdir(), "reserved-"));
  const r = checkRepo(root);
  assert.equal(r.problems.length, 2);
  assert.ok(r.problems.some((p) => p.includes(ZONE_PATH)) && r.problems.some((p) => p.includes(LIST_PATH)));
});

test("the real CLI exits 0 on the clean fixture and 1 on an unreserved label", () => {
  const root = mkdtempSync(join(tmpdir(), "reserved-cli-"));
  for (const p of ["scripts", dirname(ZONE_PATH), dirname(LIST_PATH), dirname(GRAMMAR_PATH)]) mkdirSync(join(root, p), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts/check-reserved-labels.mjs"));
  copyFileSync(join(REPO, GRAMMAR_PATH), join(root, GRAMMAR_PATH));
  copyFileSync(join(REPO, LIST_PATH), join(root, LIST_PATH));
  const run = () => spawnSync(process.execPath, [join(root, "scripts/check-reserved-labels.mjs")], { encoding: "utf8" });
  writeFileSync(join(root, ZONE_PATH), zone("mail IN A 1.2.3.4"));
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  writeFileSync(join(root, ZONE_PATH), zone("shop IN A 1.2.3.4"));
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /"shop"/);
});

test("name grammar", () => {
  for (const ok of ["abc", "gym-os", "a1b", "a".repeat(30)]) assert.ok(isValidName(ok), ok);
  for (const bad of ["ab", "-abc", "abc-", "a--b", "xn--abc", "123", "_dmarc", "ABC", "a".repeat(31), "a.b"]) assert.ok(!isValidName(bad), bad);
});

test("the TS module and the script read the same data", () => {
  const json = JSON.parse(readFileSync(join(REPO, LIST_PATH), "utf8"));
  const ts = readFileSync(join(REPO, "packages/types/src/constants/reservedLabels.ts"), "utf8");
  assert.match(ts, /from "\.\/reservedLabels\.json"/, "the TS module imports the JSON, no second copy");
  assert.ok(!json.labels.some((l) => ts.includes(`"${l}"`)), "no label is duplicated in the TS source");
  assert.deepEqual(checkRepo(REPO).problems, []);
});

test("the list contains FR-202, the zone labels and smtp/imap/pop/test", () => {
  const { labels, prefixes } = JSON.parse(readFileSync(join(REPO, LIST_PATH), "utf8"));
  const need = "owner portal www api app admin support mail staging dev gymos gym-os auth cdn status docs help login signin account billing pay payment tara taramoney smtp imap pop test".split(" ");
  for (const l of need) assert.ok(labels.includes(l), l);
  assert.ok(prefixes.includes("gymos"));
});

// Story 24.7 (AD-45): the database seeds `page_name_words` (kind zone) from the same list. The migration that creates the table is
// the one whose seed must cover every label and prefix; a label added to the JSON without a migration (or a later seeding
// migration) fails here, and so does a seed that disagrees with the JSON.
test("the page_names migration seeds every label and prefix of the reserved list as zone words", () => {
  const dir = join(REPO, "supabase/migrations");
  const file = readdirSync(dir).find((f) => /^\d{4}_page_names\.sql$/.test(f));
  assert.ok(file, "a migration named NNNN_page_names.sql exists");
  const sql = readFileSync(join(dir, file), "utf8");
  const { labels, prefixes } = JSON.parse(readFileSync(join(REPO, LIST_PATH), "utf8"));
  for (const l of labels) assert.ok(sql.includes(`('zone', '${l}', false)`), `zone label ${l} is seeded`);
  for (const p of prefixes) assert.ok(sql.includes(`('zone', '${p}', true)`), `zone prefix ${p} is seeded`);
  const seeded = [...sql.matchAll(/\('zone', '([a-z0-9-]+)', (false|true)\)/g)];
  assert.equal(seeded.length, labels.length + prefixes.length, "the seed holds no zone word that is not in the JSON");
});
