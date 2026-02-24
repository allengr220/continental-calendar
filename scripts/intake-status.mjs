import fs from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const intakeDir = path.join(process.cwd(), "intake");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function nyMonthDay() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!m || !d) throw new Error("Failed to compute NY month/day");
  return { m, d };
}

function publishIsoTodayMapped() {
  const { m, d } = nyMonthDay();
  const month = Number(m);
  const day = Number(d);
  const afterJul4 = month > 7 || (month === 7 && day >= 4);
  const year = afterJul4 ? 1775 : 1776;
  return `${year}-${m}-${d}`;
}

function findEarliestMissingSoldiers() {
  if (!fs.existsSync(dataDir)) return null;

  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  for (const f of files) {
    const iso = path.basename(f, ".json");
    const fp = path.join(dataDir, f);
    try {
      const data = readJson(fp);
      const soldiers = Array.isArray(data.soldiers_day) ? data.soldiers_day : [];
      if (soldiers.length === 0) return iso;
    } catch {
      continue;
    }
  }
  return null;
}

function soldiersEmpty(dataPath) {
  try {
    const d = readJson(dataPath);
    const soldiers = Array.isArray(d.soldiers_day) ? d.soldiers_day : [];
    return soldiers.length === 0;
  } catch {
    return null; // parse error
  }
}

function statusLine(label, iso) {
  const dataPath = path.join(dataDir, `${iso}.json`);
  const intakePath = path.join(intakeDir, `${iso}.rag.json`);

  const hasData = fs.existsSync(dataPath);
  const hasIntake = fs.existsSync(intakePath);

  const emptySoldiers = hasData ? soldiersEmpty(dataPath) : null;

  console.log(`\n=== ${label} ===`);
  console.log(`Target date: ${iso}`);
  console.log(`Data:   ${hasData ? "OK" : "MISSING"}  (${path.relative(process.cwd(), dataPath)})`);
  console.log(`Intake: ${hasIntake ? "OK" : "MISSING"}  (${path.relative(process.cwd(), intakePath)})`);

  if (hasData) {
    if (emptySoldiers === true) console.log(`Soldiers Day: EMPTY (must curate ≥ 1)`);
    else if (emptySoldiers === false) console.log(`Soldiers Day: OK`);
    else console.log(`Soldiers Day: ERROR (data JSON parse problem)`);
  }

  // Recommend next commands
  console.log("\nNext actions:");
  if (!hasIntake) {
    if (label === "PUBLISH") console.log(`  1) npm run seed:intake:publish -- --open`);
    else console.log(`  1) npm run seed:intake:backfill -- --open`);
    console.log(`  2) Run your RAG to fill intake/${iso}.rag.json`);
  } else {
    if (label === "PUBLISH") console.log(`  1) npm run promote:publish -- --list`);
    else console.log(`  1) npm run promote:backfill -- --list`);
    console.log(`  2) Promote picks (must include at least one soldier entry)`);
    if (label === "PUBLISH") console.log(`     npm run promote:publish -- --soldiers 1 --open`);
    else console.log(`     npm run promote:backfill -- --soldiers 1 --open`);
  }

  console.log(`  (Page URL) http://localhost:3000/${iso.replace(/-/g, "/")}`);
}

function main() {
  if (!fs.existsSync(intakeDir)) fs.mkdirSync(intakeDir, { recursive: true });

  const publishIso = publishIsoTodayMapped();
  const backfillIso = findEarliestMissingSoldiers();

  statusLine("PUBLISH", publishIso);

  if (backfillIso) statusLine("BACKFILL", backfillIso);
  else {
    console.log(`\n=== BACKFILL ===`);
    console.log("No missing Soldiers Day dates found. Backfill is complete (or data missing).");
  }

  console.log("\nTip: run `npm run audit` for the full violations list.");
}

main();
