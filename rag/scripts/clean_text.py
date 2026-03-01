#!/usr/bin/env python3
import re, sys, pathlib

INFILE = pathlib.Path(sys.argv[1])
OUTFILE = pathlib.Path(sys.argv[2])

text = INFILE.read_text(encoding="utf-8", errors="ignore").replace("\r\n", "\n").replace("\r", "\n")

# Drop a few known boilerplate patterns (edit/extend as needed)
drop_patterns = [
    re.compile(r"PRINTED BY", re.I),
    re.compile(r"HALLOWELL:", re.I),
    re.compile(r"GLAZIER, MASTERS", re.I),
    re.compile(r"KENNEBEC-ROW", re.I),
]
lines = []
for ln in text.split("\n"):
    if any(p.search(ln) for p in drop_patterns):
        continue
    # drop lines that are just a page number
    if re.fullmatch(r"\s*\d{1,4}\s*", ln):
        continue
    lines.append(ln.rstrip())

text = "\n".join(lines)

# Reduce extreme left padding (layout artifacts). Keep up to 4 leading spaces.
text = re.sub(r"(?m)^[ \t]{5,}", "    ", text)

# Fix hyphenation across line breaks: revolu-\ntion -> revolution
text = re.sub(r"-\n([a-z])", r"\1", text)

# Unwrap hard-wrapped lines into paragraphs:
# Turn single newlines inside paragraphs into spaces, while keeping blank-line paragraph breaks.
text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)

# Clean up spacing
text = re.sub(r"[ \t]{2,}", " ", text)
text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"

OUTFILE.write_text(text, encoding="utf-8")
print(f"Wrote: {OUTFILE}")
