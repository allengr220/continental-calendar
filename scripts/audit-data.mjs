import fs from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");

const CAPS = {
  soldiers_day: 3,
  men_of_command: 2,
  continental_congress_committees: 2,
  voices_beyond_the_line: 2,
};

function isArray(x) {
  return Array.isArray(x);
}

function main() {
  if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: data directory not found: ${dataDir}`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let parseFailures = 0;
  let missingSoldiers = 0;
  let overCaps = 0;
  let missingKeys = 0;

  const missingSoldiersDates = [];
  const overCapLines = [];
  const missingKeysLines = [];
  const parseFailLines = [];

  for (const f of files) {
    const fp = path.join(dataDir, f);
    const iso = path.basename(f, ".json");

    let json;
    try {
      json = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      parseFailures += 1;
      parseFailLines.push(`${iso}: invalid JSON`);
      continue;
    }

    // Ensure required keys exist and are arrays
    for (const key of Object.keys(CAPS)) {
      if (!Object.prototype.hasOwnProperty.call(json, key) || !isArray(json[key])) {
        missingKeys += 1;
        missingKeysLines.push(`${iso}: missing or non-array key "${key}"`);
      }
    }

    const soldiers = isArray(json.soldiers_day) ? json.soldiers_day : [];

    if (soldiers.length === 0) {
      missingSoldiers += 1;
      missingSoldiersDates.push(iso);
    }

    for (const [key, cap] of Object.entries(CAPS)) {
      const arr = isArray(json[key]) ? json[key] : [];
      if (arr.length > cap) {
        overCaps += 1;
        overCapLines.push(`${iso}: "${key}" has ${arr.length} entries (cap ${cap})`);
      }
    }
  }

  // Output
  const total = files.length;
  console.log(`Audit complete. Files checked: ${total}`);
  console.log(`- Parse failures: ${parseFailures}`);
  console.log(`- Missing/non-array required keys: ${missingKeys}`);
  console.log(`- Missing Soldier’s Day (soldiers_day.length === 0): ${missingSoldiers}`);
  console.log(`- Over-cap sections: ${overCaps}`);

  if (parseFailures) {
    console.log("\nParse failures:");
    for (const line of parseFailLines.slice(0, 50)) console.log(`  - ${line}`);
    if (parseFailLines.length > 50) console.log(`  ...and ${parseFailLines.length - 50} more`);
  }

  if (missingKeys) {
    console.log("\nMissing/non-array required keys:");
    for (const line of missingKeysLines.slice(0, 50)) console.log(`  - ${line}`);
    if (missingKeysLines.length > 50) console.log(`  ...and ${missingKeysLines.length - 50} more`);
  }

  if (missingSoldiers) {
    console.log("\nDates missing The Soldier’s Day (must curate ≥ 1 real entry):");
    for (const d of missingSoldiersDates.slice(0, 80)) console.log(`  - ${d}`);
    if (missingSoldiersDates.length > 80) console.log(`  ...and ${missingSoldiersDates.length - 80} more`);
  }

  if (overCaps) {
    console.log("\nOver-cap sections:");
    for (const line of overCapLines.slice(0, 80)) console.log(`  - ${line}`);
    if (overCapLines.length > 80) console.log(`  ...and ${overCapLines.length - 80} more`);
  }

  // Exit non-zero if any violations
  const violations = parseFailures + missingKeys + missingSoldiers + overCaps;
  process.exit(violations ? 1 : 0);
}

main();
