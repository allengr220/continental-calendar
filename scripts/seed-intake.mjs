import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const dataDir = path.join(process.cwd(), "data");
const intakeDir = path.join(process.cwd(), "intake");

const KEYS = [
  "soldiers_day",
  "men_of_command",
  "continental_congress_committees",
  "voices_beyond_the_line",
];

function usage() {
  console.log(`
Usage:
  node scripts/seed-intake.mjs <YYYY-MM-DD> [options]

Options:
  --publish        target today's mapped date (America/New_York)
  --backfill       target earliest date where data soldiers_day is empty
  --overwrite      overwrite existing intake file if it exists
  --from-data      initialize intake by copying current curated data file (data/YYYY-MM-DD.json)
  --open           open the intake file in VS Code (code)
  --print          print chosen date + file path (no editor)
`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function ensureArray(obj, key) {
  if (!Object.prototype.hasOwnProperty.call(obj, key) || !Array.isArray(obj[key])) obj[key] = [];
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

function emptyIntake(iso) {
  return {
    date: iso,
    soldiers_day: [],
    men_of_command: [],
    continental_congress_committees: [],
    voices_beyond_the_line: [],
  };
}

function openInEditor(filePath) {
  try {
    execSync(`code "${filePath}"`, { stdio: "ignore" });
  } catch {
    console.log("Note: Could not open VS Code automatically. Open manually:");
    console.log(filePath);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    usage();
    process.exit(2);
  }

  const hasFlag = (f) => args.includes(f);

  const publishMode = hasFlag("--publish");
  const backfillMode = hasFlag("--backfill");
  const overwrite = hasFlag("--overwrite");
  const fromData = hasFlag("--from-data");
  const openAfter = hasFlag("--open");
  const printOnly = hasFlag("--print");

  fs.mkdirSync(intakeDir, { recursive: true });

  let iso = args[0];

  if (publishMode) {
    iso = publishIsoTodayMapped();
    console.log(`Seed intake target (publish / NY mapped): ${iso}`);
  } else if (backfillMode) {
    const next = findEarliestMissingSoldiers();
    if (!next) {
      console.log("Backfill: no missing Soldier’s Day dates found.");
      process.exit(0);
    }
    iso = next;
    console.log(`Seed intake target (backfill / earliest missing): ${iso}`);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      console.error("ERROR: date must be YYYY-MM-DD (or use --publish/--backfill).");
      usage();
      process.exit(2);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    console.error("ERROR: computed date is invalid. Aborting.");
    process.exit(2);
  }

  const intakePath = path.join(intakeDir, `${iso}.rag.json`);
  const dataPath = path.join(dataDir, `${iso}.json`);

  if (fs.existsSync(intakePath) && !overwrite) {
    console.log(`Intake already exists (no overwrite): intake/${iso}.rag.json`);
    if (printOnly) {
      console.log(intakePath);
      process.exit(0);
    }
    if (openAfter) openInEditor(intakePath);
    process.exit(0);
  }

  let payload = emptyIntake(iso);

  if (fromData) {
    if (!fs.existsSync(dataPath)) {
      console.error(`ERROR: --from-data requested but data file not found: data/${iso}.json`);
      process.exit(2);
    }
    const data = readJson(dataPath);
    payload.date = iso;
    for (const k of KEYS) {
      payload[k] = Array.isArray(data[k]) ? data[k] : [];
      ensureArray(payload, k);
    }
  }

  // Ensure keys exist as arrays even if fromData was weird
  payload.date = iso;
  for (const k of KEYS) ensureArray(payload, k);

  writeJson(intakePath, payload);
  console.log(`Wrote intake: intake/${iso}.rag.json`);

  if (printOnly) console.log(intakePath);
  if (openAfter) openInEditor(intakePath);
}

main();
