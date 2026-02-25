import os
import re
import json
import hashlib
from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional

import numpy as np

try:
    import faiss  # type: ignore
except Exception as e:
    raise SystemExit("FAISS import failed. Try: pip install faiss-cpu") from e

try:
    from sentence_transformers import SentenceTransformer  # type: ignore
except Exception as e:
    raise SystemExit("sentence-transformers import failed. Try: pip install sentence-transformers") from e


CORPUS_DIR = "rag/corpus"
INDEX_DIR = "rag/index"
PROCESSED_DIR = "rag/processed"

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Chunking
CHUNK_CHARS = 1800  # approx; char-based chunking avoids tokenizer dependency
CHUNK_OVERLAP = 250

HEADER_KEYS = ["DATE", "AUTHOR", "ROLE", "SOURCE_TYPE", "CITATION", "URL", "TITLE", "TEXT"]

DATE_RE = re.compile(r"\b(1775|1776)-\d{2}-\d{2}\b")


@dataclass
class DocMeta:
    date: Optional[str] = None
    author: Optional[str] = None
    role: Optional[str] = None  # enlisted|nco|junior_officer|field_officer|general|delegate|civilian|unknown
    source_type: Optional[str] = None  # letter|diary|order|journal|report|memoir|unknown
    citation: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
    source_path: Optional[str] = None


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def ensure_dirs():
    os.makedirs(INDEX_DIR, exist_ok=True)
    os.makedirs(PROCESSED_DIR, exist_ok=True)


def read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def parse_header(text: str) -> Tuple[DocMeta, str]:
    """
    Accepts two formats:

    Format A: KEY: value lines, followed by 'TEXT:' then body.
    Example:
      DATE: 1776-02-20
      AUTHOR: John Doe
      ROLE: enlisted
      SOURCE_TYPE: letter
      CITATION: ...
      URL: ...
      TEXT:
      body...

    Format B: No explicit header; we'll attempt date extraction from content.
    """
    lines = text.splitlines()
    meta = DocMeta()

    # Attempt to parse header lines until TEXT: marker
    body_start = 0
    saw_any_header = False
    for i, line in enumerate(lines):
        if line.strip().upper() == "TEXT:":
            body_start = i + 1
            break

        m = re.match(r"^\s*([A-Z_]+)\s*:\s*(.*)\s*$", line)
        if m:
            key = m.group(1).strip().upper()
            val = m.group(2).strip()
            if key in HEADER_KEYS:
                saw_any_header = True
                if key == "DATE":
                    meta.date = val or None
                elif key == "AUTHOR":
                    meta.author = val or None
                elif key == "ROLE":
                    meta.role = val.lower() or None
                elif key == "SOURCE_TYPE":
                    meta.source_type = val.lower() or None
                elif key == "CITATION":
                    meta.citation = val or None
                elif key == "URL":
                    meta.url = val or None
                elif key == "TITLE":
                    meta.title = val or None
            body_start = i + 1
        else:
            # if we hit a non-header line early, assume no header
            if not saw_any_header and i <= 3:
                body_start = 0
                break

    body = "\n".join(lines[body_start:]).strip() if body_start else text.strip()

    # If date missing, try to infer first date in text
    if not meta.date:
        dm = DATE_RE.search(text)
        if dm:
            meta.date = dm.group(0)

    # Normalize role/source_type
    meta.role = (meta.role or "unknown").strip().lower()
    meta.source_type = (meta.source_type or "unknown").strip().lower()

    return meta, body


def chunk_text(body: str) -> List[str]:
    body = re.sub(r"\s+\n", "\n", body).strip()
    if len(body) <= CHUNK_CHARS:
        return [body] if body else []
    chunks = []
    start = 0
    while start < len(body):
        end = min(len(body), start + CHUNK_CHARS)
        chunk = body[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(body):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return chunks


def build():
    ensure_dirs()

    # Collect docs
    if not os.path.isdir(CORPUS_DIR):
        raise SystemExit(f"Missing corpus dir: {CORPUS_DIR}")

    files = []
    for root, _, fnames in os.walk(CORPUS_DIR):
        for fn in fnames:
            if fn.startswith("."):
                continue
            if fn.lower().endswith((".txt", ".md")):
                files.append(os.path.join(root, fn))
    files.sort()

    if not files:
        raise SystemExit(f"No .txt/.md files found under {CORPUS_DIR}")

    model = SentenceTransformer(MODEL_NAME)

    all_texts: List[str] = []
    all_meta: List[Dict] = []

    for fp in files:
        raw = read_text_file(fp)
        meta, body = parse_header(raw)
        meta.source_path = fp

        chunks = chunk_text(body)
        if not chunks:
            continue

        for idx, chunk in enumerate(chunks):
            chunk_id = sha1(fp + f"::{idx}::" + chunk[:200])
            record = {
                "id": chunk_id,
                "date": meta.date,
                "author": meta.author,
                "role": meta.role,
                "source_type": meta.source_type,
                "citation": meta.citation,
                "url": meta.url,
                "title": meta.title,
                "source_path": meta.source_path,
                "chunk_index": idx,
                "text": chunk,
            }
            all_texts.append(chunk)
            all_meta.append(record)

    if not all_texts:
        raise SystemExit("No chunked text produced. Check corpus formatting.")

    # Embed
    embeddings = model.encode(all_texts, batch_size=64, show_progress_bar=True, normalize_embeddings=True)
    emb = np.array(embeddings, dtype="float32")

    # Build FAISS index (cosine via normalized vectors + inner product)
    dim = emb.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(emb)

    # Persist
    faiss.write_index(index, os.path.join(INDEX_DIR, "index.faiss"))
    with open(os.path.join(INDEX_DIR, "meta.jsonl"), "w", encoding="utf-8") as f:
        for rec in all_meta:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    summary = {
        "model": MODEL_NAME,
        "chunks": len(all_meta),
        "corpus_files": len(files),
        "chunk_chars": CHUNK_CHARS,
        "chunk_overlap": CHUNK_OVERLAP,
    }
    with open(os.path.join(INDEX_DIR, "index_info.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("✅ Built index:")
    print(f"  - {INDEX_DIR}/index.faiss")
    print(f"  - {INDEX_DIR}/meta.jsonl")
    print(f"  - chunks: {len(all_meta)}")


if __name__ == "__main__":
    build()
