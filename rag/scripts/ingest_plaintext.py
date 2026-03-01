#!/usr/bin/env python3
"""
Ingest plain-text Revolutionary War sources into headered corpus chunks.

Works well for:
- memoirs (e.g., Joseph Plumb Martin)
- diaries
- orderly books
- pension depositions
- letters

Adds optional campaign-year scaffolding:
- Detects "Campaign of 1776" headings
- Writes `campaign_year: 1776` into headers
- If no explicit date is found in a chunk and campaign_year is known, anchors `date:` to YYYY-01-01

Usage example:
  python3 rag/scripts/ingest_plaintext.py \
    --in rag/raw/jpm_body.txt \
    --outdir rag/corpus \
    --author "Joseph Plumb Martin" \
    --title "A Narrative of Some of the Adventures, Dangers and Sufferings of a Revolutionary Soldier" \
    --role enlisted \
    --source_type memoir \
    --service "Continental Army" \
    --default_year 1775 \
    --chunk_chars 1800
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, List, Optional

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

DATE_PATTERNS = [
    # July 4, 1776 / Jul 4, 1776
    re.compile(
        r"\b(?P<month>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
        r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+"
        r"(?P<day>\d{1,2})(?:st|nd|rd|th)?\,?\s+(?P<year>17\d{2})\b",
        re.IGNORECASE,
    ),
    # 4 July 1776
    re.compile(
        r"\b(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+"
        r"(?P<month>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
        r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+"
        r"(?P<year>17\d{2})\b",
        re.IGNORECASE,
    ),
]

# Campaign scaffolding for memoirs like Martin
CAMPAIGN_PATTERN = re.compile(r"\bCampaign of (17\d{2})\b", re.IGNORECASE)

# Gutenberg boilerplate markers (safe no-ops if absent)
GUTENBERG_START = re.compile(r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG", re.IGNORECASE)
GUTENBERG_END = re.compile(r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG", re.IGNORECASE)

WHITESPACE_SQUEEZE = re.compile(r"[ \t]+")
MULTI_NL = re.compile(r"\n{3,}")


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


def normalize_text(raw: str) -> str:
    txt = raw.replace("\r\n", "\n").replace("\r", "\n")
    txt = WHITESPACE_SQUEEZE.sub(" ", txt)
    txt = MULTI_NL.sub("\n\n", txt)
    return txt.strip()


def strip_gutenberg_boilerplate(txt: str) -> str:
    lines = txt.splitlines()
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if start_idx is None and GUTENBERG_START.search(line):
            start_idx = i
        if GUTENBERG_END.search(line):
            end_idx = i
            break
    if start_idx is not None and end_idx is not None and end_idx > start_idx:
        core = "\n".join(lines[start_idx + 1:end_idx])
        return core.strip()
    return txt


def find_first_date(s: str) -> Optional[date]:
    for pat in DATE_PATTERNS:
        m = pat.search(s)
        if not m:
            continue
        gd = m.groupdict()
        month_key = gd["month"].lower().rstrip(".")
        month = MONTHS.get(month_key)
        if not month:
            return None
        day = int(gd["day"])
        year = int(gd["year"])
        try:
            return date(year, month, day)
        except ValueError:
            return None
    return None


def iter_paragraphs(txt: str) -> Iterable[str]:
    for p in txt.split("\n\n"):
        p = p.strip()
        if p:
            yield p


def chunk_paragraphs(paragraphs: List[str], chunk_chars: int) -> List[str]:
    chunks: List[str] = []
    buf: List[str] = []
    n = 0
    for p in paragraphs:
        add = len(p) + (2 if buf else 0)  # +2 for blank line separator
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


def pick_anchor_date(text: str, fallback_year: Optional[int]) -> str:
    d = find_first_date(text)
    if d:
        return d.isoformat()
    if fallback_year:
        return f"{fallback_year:04d}-01-01"
    return "unknown"


def make_header(
    meta: Meta,
    anchor_date: str,
    chunk_id: str,
    chunk_index: int,
    total_chunks: int,
    campaign_year: Optional[int] = None,
) -> str:
    lines = [
        f"date: {anchor_date}",
        f"author: {meta.author}",
        f"title: {meta.title}",
        f"role: {meta.role}",
        f"service: {meta.service}",
        f"source_type: {meta.source_type}",
        f"chunk_id: {chunk_id}",
        f"chunk_index: {chunk_index + 1}/{total_chunks}",
    ]
    if campaign_year:
        lines.append(f"campaign_year: {campaign_year}")
    if meta.url:
        lines.append(f"url: {meta.url}")
    return "\n".join(lines) + "\n\n---\n\n"


def safe_filename(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:80] if len(s) > 80 else s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True, help="Input plaintext .txt")
    ap.add_argument("--outdir", required=True, help="Output directory for headered chunks")
    ap.add_argument("--author", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--role", required=True, choices=["enlisted", "officer", "militia", "unknown"])
    ap.add_argument(
        "--source_type",
        required=True,
        choices=["diary", "memoir", "orderly_book", "pension_deposition", "letter", "unknown"],
    )
    ap.add_argument("--service", default="unknown", help="e.g., Continental Army, Massachusetts Line")
    ap.add_argument("--url", default=None)
    ap.add_argument("--default_year", type=int, default=None, help="Used when no date found; e.g., 1775")
    ap.add_argument("--chunk_chars", type=int, default=1800, help="Target chunk size in characters")
    ap.add_argument("--min_chars", type=int, default=400, help="Skip tiny chunks under this size")
    args = ap.parse_args()

    with open(args.infile, "r", encoding="utf-8", errors="ignore") as f:
        raw = f.read()

    # Hard stop if we accidentally downloaded HTML instead of text.
    head = raw.lstrip()[:200].lower()
    if "<!doctype html" in head or "<html" in head:
        raise SystemExit(f"ERROR: {args.infile} looks like HTML, not plaintext (maybe an error page).")

    txt = strip_gutenberg_boilerplate(raw)
    txt = normalize_text(txt)

    paragraphs = list(iter_paragraphs(txt))
    chunks = chunk_paragraphs(paragraphs, args.chunk_chars)

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

    current_campaign_year: Optional[int] = None
    written = 0

    for i, c in enumerate(chunks):
        c = c.strip()
        if len(c) < args.min_chars:
            continue

        # Track campaign-year headings across chunks (memoir scaffolding)
        m = CAMPAIGN_PATTERN.search(c)
        if m:
            current_campaign_year = int(m.group(1))

        anchor = pick_anchor_date(c, meta.default_year)

        # If no explicit date was found AND we have a campaign year, anchor to Jan 1 of that year.
        if (anchor == "unknown" or (meta.default_year and anchor == f"{meta.default_year:04d}-01-01")) and current_campaign_year:
            # Only override when we didn't find an explicit date in-text.
            # If anchor came from default_year fallback, campaign_year is better.
            d = find_first_date(c)
            if d is None:
                anchor = f"{current_campaign_year}-01-01"

        chunk_id = sha1(f"{base}:{i}:{c[:200]}")
        header = make_header(meta, anchor, chunk_id, i, len(chunks), campaign_year=current_campaign_year)

        out = header + c + "\n"
        outname = f"{base}__{i+1:04d}__{chunk_id[:10]}.txt"
        outpath = os.path.join(args.outdir, outname)

        with open(outpath, "w", encoding="utf-8") as f:
            f.write(out)

        written += 1

    print(f"Wrote {written} chunks to {args.outdir}")


if __name__ == "__main__":
    main()