import os
import re
import json
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    import faiss  # type: ignore
except Exception as e:
    raise SystemExit("FAISS import failed. Try: pip install faiss-cpu") from e

try:
    from sentence_transformers import SentenceTransformer  # type: ignore
except Exception as e:
    raise SystemExit("sentence-transformers import failed. Try: pip install sentence-transformers") from e


INDEX_DIR = "rag/index"
INTAKE_DIR = "intake"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

CAPS = {
    "soldiers_day": 25,  # intake can be long; your promote tool caps curated data
    "men_of_command": 20,
    "continental_congress_committees": 20,
    "voices_beyond_the_line": 20,
}

BUCKETS = [
    "soldiers_day",
    "men_of_command",
    "continental_congress_committees",
    "voices_beyond_the_line",
]

ROLE_PRIOR = {
    "enlisted": 2.0,
    "nco": 1.7,
    "junior_officer": 1.2,
    "field_officer": 0.6,
    "general": 0.3,
    "delegate": 0.2,
    "civilian": 0.8,
    "unknown": 0.5,
}

SOURCE_PRIOR = {
    "diary": 1.4,
    "letter": 1.3,
    "order": 0.8,
    "report": 0.8,
    "journal": 0.7,
    "memoir": 0.4,  # retrospective; demote by default
    "unknown": 0.6,
}

CONGRESS_HINTS = re.compile(r"\b(congress|committee|resolve[ds]?|journal of congress|jcc)\b", re.I)
COMMAND_HINTS = re.compile(r"\b(headquarters|general orders|brigade|major general|colonel|command)\b", re.I)

def read_meta(meta_path: str) -> List[Dict]:
    out = []
    with open(meta_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out

def parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d")

def date_distance_days(a: Optional[str], target: str) -> Optional[int]:
    if not a:
        return None
    try:
        da = parse_iso(a).date()
        dt = parse_iso(target).date()
        return abs((da - dt).days)
    except Exception:
        return None

def temporal_weight(dist: Optional[int]) -> float:
    # Strong bias toward same-day and nearby (±7 days still useful)
    if dist is None:
        return 0.85
    if dist == 0:
        return 1.35
    if dist <= 1:
        return 1.22
    if dist <= 3:
        return 1.12
    if dist <= 7:
        return 1.00
    if dist <= 14:
        return 0.92
    return 0.85

def pick_bucket(rec: Dict) -> str:
    role = (rec.get("role") or "unknown").lower()
    st = (rec.get("source_type") or "unknown").lower()
    text = (rec.get("text") or "")

    # Congress bucket detection
    if role == "delegate" or CONGRESS_HINTS.search(text) or st == "journal":
        return "continental_congress_committees"

    # Command bucket detection
    if role in ("general", "field_officer") or COMMAND_HINTS.search(text) or st == "order":
        return "men_of_command"

    # Civilian voices
    if role == "civilian":
        return "voices_beyond_the_line"

    # Default: soldier-centered
    return "soldiers_day"

def to_entry(rec: Dict) -> Dict:
    # Intake entry: keep it minimal + curatable
    quote = rec.get("text", "").strip()
    if len(quote) > 520:
        quote = quote[:520].rsplit(" ", 1)[0] + "…"

    return {
        "quote": quote,
        "citation": rec.get("citation") or rec.get("title") or "",
        "source_url": rec.get("url") or "",
        "context": "",  # leave for you; don't fabricate
        "facsimiles": [],
        # optional metadata you may want later:
        "actor_role": rec.get("role") or "unknown",
        "source_type": rec.get("source_type") or "unknown",
        "author": rec.get("author") or "",
        "source_path": rec.get("source_path") or "",
        "date_hint": rec.get("date") or "",
    }

def run(date_iso: str, k: int, out_path: str):
    os.makedirs(INTAKE_DIR, exist_ok=True)

    index_path = os.path.join(INDEX_DIR, "index.faiss")
    meta_path = os.path.join(INDEX_DIR, "meta.jsonl")

    if not os.path.exists(index_path) or not os.path.exists(meta_path):
        raise SystemExit("Missing index files. Run: python scripts/rag_build_index.py")

    meta = read_meta(meta_path)
    index = faiss.read_index(index_path)

    model = SentenceTransformer(MODEL_NAME)

    # Query prompt: date-anchored, soldier-biased
    query = (
        f"For date {date_iso}, retrieve primary-source excerpts describing the lived experience of common soldiers "
        f"(camp, hunger, weather, discipline, marching, combat, morale), plus relevant command and Congress machinery."
    )
    q = model.encode([query], normalize_embeddings=True)
    q = np.array(q, dtype="float32")

    # Retrieve more than needed; we re-rank with priors
    topk = max(k, 200)
    scores, ids = index.search(q, topk)
    scores = scores[0].tolist()
    ids = ids[0].tolist()

    # Re-rank
    ranked: List[Tuple[float, Dict]] = []
    for s, i in zip(scores, ids):
        if i < 0 or i >= len(meta):
            continue
        rec = meta[i]
        role = (rec.get("role") or "unknown").lower()
        st = (rec.get("source_type") or "unknown").lower()

        dist = date_distance_days(rec.get("date"), date_iso)
        tw = temporal_weight(dist)
        rw = ROLE_PRIOR.get(role, ROLE_PRIOR["unknown"])
        sw = SOURCE_PRIOR.get(st, SOURCE_PRIOR["unknown"])

        # Final score: base similarity * priors
        final = float(s) * tw * (1.0 + 0.25 * rw) * (1.0 + 0.20 * sw)
        ranked.append((final, rec))

    ranked.sort(key=lambda x: x[0], reverse=True)

    # Build intake by buckets with de-dup (by source_path+chunk_index)
    intake = {
        "date": date_iso,
        "soldiers_day": [],
        "men_of_command": [],
        "continental_congress_committees": [],
        "voices_beyond_the_line": [],
    }
    seen = set()

    for final, rec in ranked:
        key = (rec.get("source_path"), rec.get("chunk_index"))
        if key in seen:
            continue
        seen.add(key)

        bucket = pick_bucket(rec)
        if len(intake[bucket]) >= CAPS[bucket]:
            continue

        intake[bucket].append(to_entry(rec))

        # Stop when all buckets filled enough
        if all(len(intake[b]) >= min(CAPS[b], 10) for b in BUCKETS):
        # we have at least 10 per bucket; ok for first pass
            pass

        # Global stop if we have enough candidates total
        if sum(len(intake[b]) for b in BUCKETS) >= k:
            break

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(intake, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("✅ Wrote intake:")
    print(f"  - {out_path}")
    print("Counts:")
    for k2 in ["soldiers_day", "men_of_command", "continental_congress_committees", "voices_beyond_the_line"]:
        print(f"  - {k2}: {len(intake[k2])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date", help="YYYY-MM-DD (within 1775-07-04 .. 1776-07-04)")
    ap.add_argument("--k", type=int, default=60, help="total candidates across all buckets")
    ap.add_argument("--out", default="", help="output path (defaults to intake/<date>.rag.json)")
    args = ap.parse_args()

    date_iso = args.date.strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso):
        raise SystemExit("date must be YYYY-MM-DD")

    out_path = args.out.strip() or os.path.join(INTAKE_DIR, f"{date_iso}.rag.json")
    run(date_iso=date_iso, k=args.k, out_path=out_path)


if __name__ == "__main__":
    main()
