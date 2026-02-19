import fs from "fs";
import path from "path";

const PROJECT_START = "1775-07-04";
const PROJECT_END = "1776-07-04";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(dt) {
  const y = dt.getUTCFullYear();
  const m = pad2(dt.getUTCMonth() + 1);
  const d = pad2(dt.getUTCDate());
  return `${y}-${m}-${d}`;
}

function addDays(dt, n) {
  const copy = new Date(dt.getTime());
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

function emptyDay(iso) {
  return {
    date: iso,
    continental_congress: [],
    battles: [],
    letters_and_deeds: [],
  };
}

const root = process.cwd();
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const start = parseIso(PROJECT_START);
const end = parseIso(PROJECT_END);

let created = 0;
let skipped = 0;

for (let dt = start; dt <= end; dt = addDays(dt, 1)) {
  const iso = toIso(dt);
  const filePath = path.join(dataDir, `${iso}.json`);

  if (fs.existsSync(filePath)) {
    skipped += 1;
    continue;
  }

  fs.writeFileSync(filePath, JSON.stringify(emptyDay(iso), null, 2) + "\n", "utf8");
  created += 1;
}

console.log(
  `Done. Created ${created} files. Skipped ${skipped} existing files. Range: ${PROJECT_START} → ${PROJECT_END}`
);
