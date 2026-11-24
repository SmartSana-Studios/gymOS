// Epics 30 + 31 local QA seed. LOCAL Supabase only. Idempotent: wipes and recreates "Epic19 QA Gym", turns the engagement epoch ON (14 weeks back),
// adds 14 leaderboard members and two phone members (A, B) in the persona `new`.
//   node scripts/epic30-31-qa/seed.mjs
import { buildWorld } from "../epic19-qa/lib.mjs";
import { PW } from "../epic19-qa/constants.mjs";
import { setEpoch, epochMonday, seedBoardMembers, seedBoard, applyPersona, gymToday, weekStart, gymHour } from "./lib.mjs";

const w = await buildWorld();
const A = await w.member("Amina Njoya", { plan: "monthly", phone: "237699000001" });
const B = await w.member("Boris Ekani", { plan: "monthly", phone: "237670000001" });
const ids = await seedBoardMembers(w);
setEpoch(epochMonday());
const board = seedBoard("full", ids);
applyPersona(A.id, "new");
applyPersona(B.id, "new");

console.log(`\nEpics 30/31 QA ready on "Epic19 QA Gym" (id ${w.gym.id}).`);
console.log(`Engagement epoch: ${epochMonday()} (14 weeks before this week's Monday). Gym-local today: ${gymToday()}, this week starts ${weekStart(gymToday())}, gym-local hour ${gymHour()}.`);
console.log(`Dashboard logins (staff, not needed for most steps), password ${PW}: owner@ supervisor@ manager@ receptionist@ coach@ + epic19qa.test`);
console.log(`Phone members, OTP 123456: A = +237699000001 (Amina Njoya), B = +237670000001 (Boris Ekani). Both start as persona "new".`);
console.log(`Leaderboard: 14 other members seeded${board.dom < 18 ? ` (day ${board.dom} of the month, so the biggest counts are capped at ${board.dom})` : ""}: two hidden, one who has not seen the notice.`);
console.log(`Next: node scripts/epic30-31-qa/state.mjs <persona> [A|B]   (node scripts/epic30-31-qa/state.mjs --list)  — see README.md`);
