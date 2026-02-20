import fs from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");

const OLD_KEYS = ["continental_congress", "battles", "letters_and_deeds"];
const NEW_KEYS = [
  "soldiers_day",
  "men_of_command",
  "continental_congress_committees",
  "voices_beyond_the_line",
];

function ensureArray(obj, key) {
  if (!Object.prototype.hasOwnProperty.call(obj, key) || !Array.isArray(obj[key])) {
    obj[key] = [];
  }
}

function migrateOne(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: "invalid_json" };
  }

  // Ensure date exists (derive from filename if missing)
  const base = path.basename(filePath, ".json");
  if (!json.date || typeof json.date !== "string") {
    json.date = base; // expects YYYY-MM-DD
  }

  // If already migrated (new keys exist), just normalize and return
  const alreadyNew =
    NEW_KEYS.every((k) => Object.prototype.hasOwnProperty.call(json, k)) &&
    OLD_KEYS.every((k) => !Object.prototype.hasOwnProperty.call(json, k));

  if (!alreadyNew) {
    // Map old → new in the least destructive way:
    // - letters_and_deeds and battles both feed soldiers_day (you can later re-sort during curation)
    // - continental_congress feeds continental_congress_committees
    // - men_of_command starts empty (unless you had a separate bucket earlier)
    // - voices_beyond_the_line starts empty
    const oldLetters = Array.isArray(json.letters_and_deeds) ? json.letters_and_deeds : [];
    const oldBattles = Array.isArray(json.battles) ? json.battles : [];
    const oldCongress = Array.isArray(json.continental_congress) ? json.continental_congress : [];

    // Only set new keys if not already present to keep reruns safe
    if (!Array.isArray(json.soldiers_day)) {
      json.soldiers_day = [...oldLetters, ...oldBattles];
    }
    if (!Array.isArray(json.men_of_command)) {
      json.men_of_command = [];
    }
    if (!Array.isArray(json.continental_congress_committees)) {
      json.continental_congress_committees = [...oldCongress];
    }
    if (!Array.isArray(json.voices_beyond_the_line)) {
      json.voices_beyond_the_line = [];
    }

    // Remove old keys (schema rename)
    for (const k of OLD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(json, k)) delete json[k];
    }
  }

  // Normalize: ensure all required keys exist and are arrays
  for (const k of NEW_KEYS) ensureArray(json, k);

  // IMPORTANT: We do NOT auto-insert a placeholder soldiers entry.
  // This respects "Never fabricate weight." We'll enforce non-empty at render/QA time instead.

  const out = JSON.stringify(json, null, 2) + "\n";
  fs.writeFileSync(filePath, out, "utf8");

  return { ok: true, changed: !alreadyNew };
}

function main() {
  if (!fs.existsSync(dataDir)) {
    console.error(`No data directory found at: ${dataDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dataDir, f));

  let ok = 0;
  let changed = 0;
  let bad = 0;

  for (const fp of files) {
    const res = migrateOne(fp);
    if (!res.ok) {
      bad += 1;
      console.error(`FAILED: ${path.basename(fp)} (${res.reason})`);
      continue;
    }
    ok += 1;
    if (res.changed) changed += 1;
  }

  console.log(
    `Schema migration complete. OK: ${ok}, changed: ${changed}, failed: ${bad}.`
  );

  if (bad > 0) process.exit(2);
}

main();
