import fs from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const intakeDir = path.join(process.cwd(), "intake");

const CAPS = {
  soldiers_day: 3,
  men_of_command: 2,
  continental_congress_committees: 2,
  voices_beyond_the_line: 2,
};

function usage() {
  console.log(`
Usage:
  node scripts/promote-intake.mjs <YYYY-MM-DD> [options]

Options:
  --soldiers  <csv>   indices (1-based) from intake.soldiers_day to promote
  --command   <csv>   indices from intake.men_of_command to promote
  --congress  <csv>   indices from intake.continental_congress_committees to promote
  --voices    <csv>   indices from intake.voices_beyond_the_line to promote

  --list              list intake candidates with indices (no writes)
  --overwrite         replace section contents instead of appending (still capped)
  --dry-run           show what would be written, but don't write files
  --next-missing      find earliest date (sorted) where data soldiers_day is empty AND intake exists
`);
}

function parseCsvIndices(s) {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1);
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

function getPathsForDate(iso) {
  return {
    dataPath: path.join(dataDir, `${iso}.json`),
    intakePath: path.join(intakeDir, `${iso}.rag.json`),
  };
}

function listSection(name, arr, cap) {
  console.log(`\n== ${name} (intake candidates: ${arr.length}; cap in data: ${cap}) ==`);
  if (!arr.length) {
    console.log("  (none)");
    return;
  }
  arr.forEach((e, i) => {
    const idx = i + 1;
    const headline = (e.quote || e.title || "").toString().slice(0, 160);
    const cite = (e.citation || "").toString().slice(0, 120);
    console.log(`  [${idx}] ${headline}${headline ? "" : "(no quote/title)"}`);
    if (cite) console.log(`      - ${cite}`);
  });
}

function applyPromotion({ data, intake, key, indices, overwrite }) {
  ensureArray(data, key);
  ensureArray(intake, key);

  const picked = [];
  for (const n of indices) {
    const i = n - 1;
    if (i < 0 || i >= intake[key].length) continue;
    picked.push(intake[key][i]);
  }

  const base = overwrite ? [] : data[key];
  const merged = [...base, ...picked];

  // Cap, preserving order (earlier entries keep priority)
  data[key] = merged.slice(0, CAPS[key]);

  return { pickedCount: picked.length, finalCount: data[key].length };
}

function findNextMissing() {
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  for (const f of files) {
    const iso = path.basename(f, ".json");
    const { dataPath, intakePath } = getPathsForDate(iso);
    if (!fs.existsSync(intakePath)) continue;

    try {
      const data = readJson(dataPath);
      const soldiers = Array.isArray(data.soldiers_day) ? data.soldiers_day : [];
      if (soldiers.length === 0) return iso;
    } catch {
      // ignore parse failures here; audit handles them
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    usage();
    process.exit(2);
  }

  // flags
  const hasFlag = (f) => args.includes(f);
  const getFlagValue = (f) => {
    const i = args.indexOf(f);
    if (i === -1) return null;
    return args[i + 1] ?? null;
  };

  const listOnly = hasFlag("--list");
  const overwrite = hasFlag("--overwrite");
  const dryRun = hasFlag("--dry-run");

  let iso = args[0];

  if (hasFlag("--next-missing")) {
    const next = findNextMissing();
    if (!next) {
      console.log("No eligible next-missing date found (either none missing or no intake files present).");
      process.exit(0);
    }
    iso = next;
    console.log(`Next missing Soldier’s Day with intake present: ${iso}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    console.error("ERROR: date must be YYYY-MM-DD");
    usage();
    process.exit(2);
  }

  const { dataPath, intakePath } = getPathsForDate(iso);

  if (!fs.existsSync(intakePath)) {
    console.error(`ERROR: intake file not found: ${intakePath}`);
    console.error(`Create: intake/${iso}.rag.json`);
    process.exit(2);
  }

  if (!fs.existsSync(dataPath)) {
    console.error(`ERROR: data file not found: ${dataPath}`);
    console.error(`Expected scaffold under data/. Did you generate days?`);
    process.exit(2);
  }

  const intake = readJson(intakePath);
  const data = readJson(dataPath);

  // Normalize required keys
  for (const k of Object.keys(CAPS)) {
    ensureArray(intake, k);
    ensureArray(data, k);
  }

  if (listOnly) {
    console.log(`Listing intake candidates for ${iso} (no writes).`);
    listSection("The Soldier’s Day", intake.soldiers_day, CAPS.soldiers_day);
    listSection("Men of Command", intake.men_of_command, CAPS.men_of_command);
    listSection("The Continental Congress & Committees", intake.continental_congress_committees, CAPS.continental_congress_committees);
    listSection("Voices Beyond the Line", intake.voices_beyond_the_line, CAPS.voices_beyond_the_line);
    process.exit(0);
  }

  const soldiersIdx = parseCsvIndices(getFlagValue("--soldiers"));
  const commandIdx = parseCsvIndices(getFlagValue("--command"));
  const congressIdx = parseCsvIndices(getFlagValue("--congress"));
  const voicesIdx = parseCsvIndices(getFlagValue("--voices"));

  const anySelection =
    soldiersIdx.length || commandIdx.length || congressIdx.length || voicesIdx.length;

  if (!anySelection) {
    console.error("ERROR: no selections provided. Use --list to view indices, then select with --soldiers/--command/--congress/--voices.");
    process.exit(2);
  }

  const report = [];

  if (soldiersIdx.length) {
    report.push(["soldiers_day", applyPromotion({ data, intake, key: "soldiers_day", indices: soldiersIdx, overwrite })]);
  }
  if (commandIdx.length) {
    report.push(["men_of_command", applyPromotion({ data, intake, key: "men_of_command", indices: commandIdx, overwrite })]);
  }
  if (congressIdx.length) {
    report.push(["continental_congress_committees", applyPromotion({ data, intake, key: "continental_congress_committees", indices: congressIdx, overwrite })]);
  }
  if (voicesIdx.length) {
    report.push(["voices_beyond_the_line", applyPromotion({ data, intake, key: "voices_beyond_the_line", indices: voicesIdx, overwrite })]);
  }

  // Enforce the non-negotiable rule (without fabricating content):
  if (data.soldiers_day.length === 0) {
    console.error(`ERROR: ${iso} would still have soldiers_day.length === 0 after promotion.`);
    console.error("Rule: Force at least one. Never fabricate weight. But never allow zero.");
    console.error("Pick at least one soldier entry from intake (--soldiers ...).");
    process.exit(1);
  }

  console.log(`Promotion plan for ${iso}:`);
  for (const [k, r] of report) {
    console.log(`- ${k}: picked ${r.pickedCount}, final ${r.finalCount} (cap ${CAPS[k]})${overwrite ? " [overwrite]" : ""}`);
  }

  if (dryRun) {
    console.log("\nDRY RUN: No files written.");
    process.exit(0);
  }

  // Keep date accurate
  data.date = iso;

  writeJson(dataPath, data);
  console.log(`\nWrote curated data: data/${iso}.json`);
}

main();
