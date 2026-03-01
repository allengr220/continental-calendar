#!/usr/bin/env python3
"""
Diary ingestion that supports:
- Month headers (e.g., "September", "Sept. 1775", "September 1775")
- Day-only lines under that month (e.g., "1st.", "2d", "3rd", "14")
- Standard inline dates still supported (e.g., "Oct. 14, 1775")

Behavior:
- Carries forward current_year and current_month from headers
- When it sees a day-only line, it starts a new entry for YYYY-MM-DD
- Emits one (or multiple) chunk files per entry
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
from dataclasses import dataclass
from datetime import date
from typing import List, Optional, Tuple

MONTHS = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

WEEKDAY = r"(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)"
MONTH = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"

YEAR_RE = re.compile(r"\b(17\d{2})\b")

def normalize_year(y: int) -> Optional[int]:
    return y if (YEAR_MIN <= y <= YEAR_MAX) else None

# Inline month+day(+year optional)
MDY_INLINE = re.compile(
    rf"\b(?:{WEEKDAY}\,?\s+)?(?P<month>{MONTH})\.?\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th|d)?"
    rf"(?:\,?\s+(?P<year>17\d{{2}}))?\b",
    re.IGNORECASE,
)

DMY_INLINE = re.compile(
    rf"\b(?P<day>\d{{1,2}})(?:st|nd|rd|th|d)?\s+(?P<month>{MONTH})\.?"
    rf"(?:\s+(?P<year>17\d{{2}}))?\b",
    re.IGNORECASE,
)

# Month header lines like "September", "Sept. 1775", "September 1775"
MONTH_HEADER = re.compile(
    rf"^\s*(?P<month>{MONTH})\.?(?:\s+|,\s*)?(?P<year>17\d{{2}})?\s*$",
    re.IGNORECASE,
)

# Day-only lines like "1st", "2d", "3rd.", "14", "14th"
DAY_ONLY = re.compile(
    r"^\s*(?P<day>\d{1,2})(?:st|nd|rd|th|d)?\s*([,.\-–—]+)?\s*(.*)?$",
    re.IGNORECASE,
)
HQ_MDY = re.compile(
    rf"\b(?:Head\s+Quarters|Head\s+Qrs\.?|H\.?Q\.?)\s+"
    rf"(?P<month>{MONTH})\.?\s*['\" ]*\s*(?P<day>\d{{1,2}})\s*['\" ]*[, ]*\s*(?P<year>17\d{{2}})\b",
    re.IGNORECASE,
)

MULTI_NL = re.compile(r"\n{3,}")
WS2 = re.compile(r"[ \t]{2,}")

YEAR_MIN = 1770
YEAR_MAX = 1785

@dataclass
class Meta:
    author: str
    title: str
    role: str
    source_type: str
    service: str
    default_year: Optional[int] = None
    url: Optional[str] = None

def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="ignore")).hexdigest()

def safe_filename(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:80] if len(s) > 80 else s

def month_num(m: str) -> Optional[int]:
    return MONTHS.get(m.lower().rstrip("."))

def normalize_block(txt: str) -> str:
    txt = txt.replace("\r\n", "\n").replace("\r", "\n")
    txt = MULTI_NL.sub("\n\n", txt)
    txt = WS2.sub(" ", txt)
    return txt.strip()

def chunk_text(txt: str, chunk_chars: int) -> List[str]:
    paras = [p.strip() for p in txt.split("\n\n") if p.strip()]
    chunks: List[str] = []
    buf: List[str] = []
    n = 0
    for p in paras:
        add = len(p) + (2 if buf else 0)
        if buf and (n + add) > chunk_chars:
            chunks.append("\n\n".join(buf).strip())
            buf = [p]
            n = len(p)
        else:
            buf.append(p)
            n += add
    if buf:
        chunks.append("\n\n".join(buf).strip())
    return chunks

def make_header(meta: Meta, d: str, chunk_id: str, idx: int, total: int | str) -> str:
    lines = [
        f"date: {d}",
        f"author: {meta.author}",
        f"title: {meta.title}",
        f"role: {meta.role}",
        f"service: {meta.service}",
        f"source_type: {meta.source_type}",
        f"chunk_id: {chunk_id}",
        f"chunk_index: {idx}/{total}",
    ]
    if meta.url:
        lines.append(f"url: {meta.url}")
    return "\n".join(lines) + "\n\n---\n\n"

def parse_inline_date(line: str,
                      current_year: Optional[int],
                      default_year: Optional[int]) -> Optional[date]:
    """
    Robust inline date parser with:
    - OCR-tolerant HQ pattern
    - Month Day [Year optional]
    - Day Month [Year optional]
    - Year clamping (1770–1785)
    """

    YEAR_MIN = 1770
    YEAR_MAX = 1785

    def normalize_year(y_raw: Optional[int]) -> Optional[int]:
        if y_raw is None:
            return None
        return y_raw if YEAR_MIN <= y_raw <= YEAR_MAX else None

    # ---------- 1) HQ-style pattern first ----------
    m = HQ_MDY.search(line)
    if m:
        mn = month_num(m.group("month"))
        if mn:
            y_raw = int(m.group("year"))
            y = normalize_year(y_raw) or current_year or default_year
            if y:
                try:
                    return date(y, mn, int(m.group("day")))
                except ValueError:
                    pass

    # ---------- 2) Standard inline patterns ----------
    for pat in (MDY_INLINE, DMY_INLINE):
        m = pat.search(line)
        if not m:
            continue

        gd = m.groupdict()
        mn = month_num(gd["month"])
        if not mn:
            continue

        # Try explicit year first
        y_raw = int(gd["year"]) if gd.get("year") else None
        y = normalize_year(y_raw)

        # If OCR year invalid or absent, fall back
        if y is None:
            y = current_year or default_year

        if not y:
            continue

        try:
            return date(y, mn, int(gd["day"]))
        except ValueError:
            continue

    return None

def split_entries(lines: List[str], default_year: Optional[int]) -> List[Tuple[str, List[str]]]:
    entries: List[Tuple[str, List[str]]] = []
    current_year: Optional[int] = None
    current_month: Optional[int] = None

    current_date: Optional[str] = None
    buf: List[str] = []

    for ln in lines:
        # Update year if mentioned anywhere
        y = YEAR_RE.search(ln)
        if y:
            yv = normalize_year(int(y.group(1)))
            if yv is not None:
                current_year = int(y.group(1))

        # Month header line?
        mh = MONTH_HEADER.match(ln)
        if mh:
            mname = mh.group("month")
            my = mh.group("year")
            mn = month_num(mname)
            if mn:
                current_month = mn
            if my:
                current_year = int(my)
            # Keep the header line in the current buffer if we're already inside an entry
            if current_date is not None:
                buf.append(ln)
            continue

        # Full inline date anywhere (strongest signal)
        d_full = parse_inline_date(ln, current_year=current_year, default_year=default_year)
        if d_full:
            current_month = d_full.month
            new_date = d_full.isoformat()
            if current_date == new_date:
                buf.append(ln)
                continue
            if current_date and buf:
                entries.append((current_date, buf))
            current_date = new_date
            buf = [ln]
            continue

        # Day-only line under a known month/year
        donly = DAY_ONLY.match(ln)
        if donly and current_month and (current_year or default_year):
            y_use = current_year or default_year
            day = int(donly.group("day"))
            try:
                d = date(int(y_use), int(current_month), day)
            except ValueError:
                # invalid day (OCR junk) -> treat as content
                if current_date is not None:
                    buf.append(ln)
                continue

            new_date = d.isoformat()
            if current_date == new_date:
                buf.append(ln)
                continue
            if current_date and buf:
                entries.append((current_date, buf))
            current_date = new_date
            buf = [ln]
            continue

        # Otherwise: normal content if we’re inside an entry
        if current_date is not None:
            buf.append(ln)

    if current_date and buf:
        entries.append((current_date, buf))

    return entries

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--role", required=True, choices=["enlisted", "officer", "militia", "unknown"])
    ap.add_argument("--source_type", required=True, choices=["diary", "memoir", "orderly_book", "pension_deposition", "letter", "unknown"])
    ap.add_argument("--service", default="unknown")
    ap.add_argument("--url", default=None)
    ap.add_argument("--default_year", type=int, default=None)
    ap.add_argument("--chunk_chars", type=int, default=900)
    ap.add_argument("--min_chars", type=int, default=60)
    args = ap.parse_args()

    raw = open(args.infile, "r", encoding="utf-8", errors="ignore").read()
    head = raw.lstrip()[:200].lower()
    if "<!doctype html" in head or "<html" in head:
        raise SystemExit(f"ERROR: {args.infile} looks like HTML, not plaintext.")

    meta = Meta(
        author=args.author,
        title=args.title,
        role=args.role,
        source_type=args.source_type,
        service=args.service,
        default_year=args.default_year,
        url=args.url,
    )

    os.makedirs(args.outdir, exist_ok=True)
    base = safe_filename(f"{meta.author}_{meta.title}")

    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    entries = split_entries(lines, default_year=meta.default_year)

    written = 0
    for e_i, (d, elines) in enumerate(entries):
        block = normalize_block("\n".join(elines))
        if len(block) < args.min_chars:
            continue
        subs = chunk_text(block, args.chunk_chars)
        for s_i, sc in enumerate(subs):
            if len(sc) < args.min_chars:
                continue
            chunk_id = sha1(f"{base}:{d}:{e_i}:{s_i}:{sc[:200]}")
            header = make_header(meta, d, chunk_id, written + 1, "unknown")
            outname = f"{base}__{d}__{s_i+1:02d}__{chunk_id[:10]}.txt"
            outpath = os.path.join(args.outdir, outname)
            with open(outpath, "w", encoding="utf-8") as f:
                f.write(header + sc + "\n")
            written += 1

    print(f"Wrote {written} chunks to {args.outdir}")

if __name__ == "__main__":
    main()