#!/usr/bin/env python3
import re, sys, pathlib

INFILE = pathlib.Path(sys.argv[1])
OUTFILE = pathlib.Path(sys.argv[2])

t = INFILE.read_text(encoding="utf-8", errors="ignore").replace("\r\n","\n").replace("\r","\n")

# Drop obvious boilerplate-ish junk, lightly
drop = [
    re.compile(r"^(\s*)Page\s+\d+\s*$", re.I),
]
lines = []
for ln in t.split("\n"):
    if any(p.search(ln) for p in drop):
        continue
    lines.append(ln.rstrip())

t = "\n".join(lines)

# Fix hyphenation across line breaks
t = re.sub(r"-\n([a-z])", r"\1", t)

# Normalize huge leading indentation (keep up to 4 spaces)
t = re.sub(r"(?m)^[ \t]{5,}", "    ", t)

# Ensure blank line before common date headings (Month Day, Year)
month = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
t = re.sub(rf"(?m)^(?={month}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?\,?\s+17\d{{2}}\b)", r"\n", t)

# Collapse 3+ blank lines to 2
t = re.sub(r"\n{3,}", "\n\n", t).strip() + "\n"

OUTFILE.write_text(t, encoding="utf-8")
print(f"Wrote: {OUTFILE}")
