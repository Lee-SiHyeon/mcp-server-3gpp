#!/usr/bin/env python3
"""Centralized path resolution for mcp-server-3gpp extraction scripts."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "raw"
EXTRACTED_DIR = PROJECT_ROOT / "extracted"
# THREEGPP_INTERMEDIATE_DIR lets a staged rebuild keep its JSONL outside the repo.
INTERMEDIATE_DIR = Path(os.environ["THREEGPP_INTERMEDIATE_DIR"]).resolve() if os.environ.get(
    "THREEGPP_INTERMEDIATE_DIR") else PROJECT_ROOT / "data" / "intermediate"
DATA_DIR = PROJECT_ROOT / "data"
CORPUS_DIR = DATA_DIR / "corpus"

# Create directories on import
for d in [RAW_DIR, EXTRACTED_DIR, INTERMEDIATE_DIR, CORPUS_DIR]:
    d.mkdir(parents=True, exist_ok=True)
