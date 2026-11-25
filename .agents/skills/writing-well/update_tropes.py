#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Check for updates to the tropes.fyi catalogue and refresh the local copy.

The catalogue is published as a data URI inside the tropes.fyi home page. This
script extracts it, compares it with references/tropes.md and reports which
patterns were added or removed. It writes only when asked, so an upstream
rewrite never lands unreviewed.

Runs on Windows, macOS and Linux with the Python standard library alone.

Usage:
    python update_tropes.py                    # Check and report, write nothing
    python update_tropes.py --write            # Write when different
    python update_tropes.py --from-html page.html --check
    python update_tropes.py --out path/tropes.md --write
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import re
import sys
from pathlib import Path
from urllib.parse import unquote
from urllib.request import Request, urlopen

PAGE_URL = "https://tropes.fyi/"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
DEFAULT_OUT = Path(__file__).resolve().parent / "references" / "tropes.md"

DATA_URI = re.compile(r'href="(data:text/markdown[^"]+)"')
HEADING = re.compile(r"^##\s+(.+)$", re.MULTILINE)
ENTITY = re.compile(r"&#x27;|&#39;")

# The v2 catalogue carries 49 patterns. A smaller result means the page changed
# shape and the extraction is no longer trustworthy.
MIN_PATTERNS = 40


def fetch(url: str) -> str:
    """Return the page text, decoded as UTF-8."""
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        raw = response.read()
    return raw.decode("utf-8", errors="replace")


def extract(page: str) -> str:
    """Return the Markdown catalogue held in the page's data URI."""
    match = DATA_URI.search(page)
    if not match:
        raise ValueError("no data:text/markdown link found in the page")
    payload = match.group(1).split(",", 1)[1]
    text = unquote(payload)
    text = ENTITY.sub("'", text)
    text = html.unescape(text)
    if not text.endswith("\n"):
        text += "\n"
    return text.replace("\r\n", "\n")


def normalise(text: str) -> str:
    """Return the text with a single trailing newline and no carriage returns."""
    body = text.replace("\r\n", "\n").rstrip("\n")
    return body + "\n" if body else ""


def headings(text: str) -> list[str]:
    """Return the pattern headings in document order."""
    return [h.strip() for h in HEADING.findall(text)]


def report(local: str, remote: str) -> bool:
    """Print the difference between the local and remote catalogues.

    Returns True when the two differ.
    """
    if local == remote:
        print("Catalogue is current: %d patterns, %d lines." % (
            len(headings(local)), len(local.splitlines())))
        return False

    old, new = headings(local), headings(remote)
    added = [h for h in new if h not in old]
    removed = [h for h in old if h not in new]

    print("Catalogue differs: local %d patterns, remote %d patterns." % (
        len(old), len(new)))
    for label, items in (("added", added), ("removed", removed)):
        for item in items:
            print("  %s: %s" % (label, item))
    if not added and not removed:
        print("  text changed, no pattern added or removed")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check tropes.fyi for catalogue updates.")
    parser.add_argument("--write", action="store_true",
                        help="write the remote catalogue when it differs")
    parser.add_argument("--check", action="store_true",
                        help="report only, never write (the default)")
    parser.add_argument("--from-html", type=Path, metavar="PATH",
                        help="read the page from a saved file instead of the web")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help="local catalogue path (default: references/tropes.md)")
    parser.add_argument("--url", default=PAGE_URL,
                        help="page to fetch (default: %(default)s)")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    try:
        page = (args.from_html.read_text(encoding="utf-8")
                if args.from_html else fetch(args.url))
        remote = extract(page)
    except Exception as error:  # noqa: BLE001 - report, never traceback at the user
        print("Could not read the catalogue: %s" % error, file=sys.stderr)
        print("The local copy is unchanged.", file=sys.stderr)
        return 2

    if len(headings(remote)) < MIN_PATTERNS:
        print("Page parsed but %d patterns is below the %d expected. "
              "Treating the page as changed and leaving the local copy alone."
              % (len(headings(remote)), MIN_PATTERNS), file=sys.stderr)
        return 2

    out = args.out
    local = out.read_text(encoding="utf-8") if out.exists() else ""
    differs = report(normalise(local), normalise(remote))

    if not differs or args.check or not args.write:
        if differs:
            print("Run again with --write to update %s." % out)
        return 0 if not differs else 1

    out.parent.mkdir(parents=True, exist_ok=True)
    text = normalise(remote)
    out.write_text(text, encoding="utf-8", newline="\n")
    print("Wrote %s (%d lines, snapshot %s)." % (
        out, len(text.splitlines()), dt.date.today().isoformat()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
