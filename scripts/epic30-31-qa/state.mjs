// Put a phone member in an engagement state. Re-run any time; the phone then pull-to-refreshes (or reopens the app).
//   node scripts/epic30-31-qa/state.mjs <persona> [A|B]
//   node scripts/epic30-31-qa/state.mjs --list
import { PERSONAS, applyPersona, memberByPhone, summary, personaDates } from "./lib.mjs";

const [name, letter = "A"] = process.argv.slice(2);
if (!name || name === "--list") {
  console.table(Object.entries(PERSONAS).map(([k, p]) => ({ persona: k, what: p.about })));
  process.exit(name ? 0 : 1);
}
const m = await memberByPhone(letter.toUpperCase());
const r = applyPersona(m.id, name);
console.log(`Phone ${letter.toUpperCase()} (${m.phone}) is now "${name}": ${r.p.about}`);
console.log(`visit days written: ${r.days.length}${r.todayVisit ? " + today" : ""}${r.goal ? `; goal in force this week: ${r.goal}` : ""}`);
console.table(await summary(m.client));
console.log("Sign out and in again on the phone if the Shield notices were dismissed before (sign-out clears them); otherwise pull to refresh.");
