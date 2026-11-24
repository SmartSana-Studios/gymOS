// Rewrite this month's visit days of the 14 board members. full = 14 ranked, two = 2 ranked (under 3 ranked the board shows no names), none = 0.
//   node scripts/epic30-31-qa/board.mjs full|two|none
import { seedBoard, boardIds } from "./lib.mjs";
const mode = process.argv[2];
if (!["full", "two", "none"].includes(mode)) { console.error("usage: board.mjs full|two|none"); process.exit(1); }
const r = seedBoard(mode, boardIds());
console.log(`board = ${mode}: ${r.ranked} other member(s) ranked this month (day ${r.dom} of the month caps each count). The phone member counts too if they have visit days this month.`);
