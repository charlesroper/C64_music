#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Download the Guardian and Observer style guide into Markdown batch files.

By default, fetches all letters in four alphabetical batches (a-f, g-l, m-r, s-z)
and writes them directly into the 'references/' directory.

Usage:
    python3 guardian_style_guide.py                   # Downloads all 4 batches to references/
    python3 guardian_style_guide.py --out full.md     # Downloads all letters into a single file
    python3 guardian_style_guide.py --letters z       # Downloads only letter z
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

PAGE_URL = "https://www.theguardian.com/guardian-style-guide-{letter}"
SERIES_URL = "https://www.theguardian.com/info/series/the-guardian-style-guide"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "references"
DEFAULT_BATCHES: list[tuple[str, str]] = [
    ("a-f", "abcdef"),
    ("g-l", "ghijkl"),
    ("m-r", "mnopqr"),
    ("s-z", "stuvwxyz"),
]

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}
SKIP_TAGS = {
    "aside", "audio", "button", "figure", "form", "iframe", "noscript",
    "script", "style", "svg", "video",
}
BLOCK_TAGS = {"p", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"}
HEADING_TAGS = {"h2", "h3", "h4", "h5", "h6"}


def escape_markdown(text: str) -> str:
    """Escape characters that would otherwise be read as Markdown markup."""
    return re.sub(r"([\\`*_\[\]<>])", r"\\\1", text)


def escape_block_starts(text: str) -> str:
    """Stop ordinary lines being read as headings, lists, or quotes."""
    lines = []
    for line in text.split("\n"):
        if re.match(r"^(?:#{1,6}\s|[-+]\s|\d+[.)]\s|>)", line):
            line = "\\" + line
        lines.append(line)
    return "\n".join(lines)


def clean_text(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{2,}", "\n\n", text)
    return text.strip()


def format_definition_block(text: str) -> str:
    """Keep <br>-separated lines as Markdown hard breaks.

    A line beginning with a bold headword starts a new entry. Other lines stay
    in the same paragraph, separated by a backslash hard break.
    """
    paragraphs: list[str] = []

    for paragraph in text.split("\n\n"):
        lines = [line.strip() for line in paragraph.split("\n") if line.strip()]
        if not lines:
            continue

        entries: list[list[str]] = []
        current = [lines[0]]
        for line in lines[1:]:
            if line.startswith("**") and not line.startswith("** "):
                entries.append(current)
                current = [line]
            else:
                current.append(line)
        entries.append(current)

        for entry in entries:
            if len(entry) == 2 and entry[0].startswith("**"):
                paragraphs.append(entry[0] + " — " + entry[1])
            else:
                paragraphs.append("\\\n".join(entry))

    return "\n\n".join(paragraphs)


def markdown_url(url: str) -> str:
    if any(char in url for char in " ()<>"):
        return "<" + url.replace(" ", "%20") + ">"
    return url.replace(")", "%29")


class MarkdownBuilder:
    """Turn an HTML fragment into a list of Markdown blocks."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.blocks: list[str] = []
        self.current: list[str] = []
        self.block: str | None = None
        self.skip_depth = 0
        self.markers: list[dict] = []
        self.links: list[str | None] = []
        self.link_count = 0
        self.style_guide_link_count = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)

        if self.skip_depth:
            if tag not in VOID_TAGS:
                self.skip_depth += 1
            return

        if tag in SKIP_TAGS or attributes.get("id") == "sign-in-gate":
            self.skip_depth = 1
            return

        if tag in BLOCK_TAGS:
            self.flush()
            self.block = tag
        elif tag == "br":
            self.break_line()
        elif tag in ("strong", "b"):
            self.open_marker("**", tag)
        elif tag in ("em", "i"):
            self.open_marker("*", tag)
        elif tag == "a":
            href = attributes.get("href")
            if href and not href.startswith("#"):
                self.links.append(href)
                self.link_count += 1
                if "guardian-style-guide-" in href or "guardian-observer-style-guide-" in href:
                    self.style_guide_link_count += 1
                self.current.append("[")
            else:
                self.links.append(None)
        elif tag == "hr":
            self.flush()
            self.blocks.append("---")
        elif tag == "img":
            return

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.skip_depth:
            return
        if tag == "br":
            self.break_line()
        elif tag not in ("img", "source", "input", "meta", "link"):
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            if tag not in VOID_TAGS:
                self.skip_depth -= 1
            return

        if tag in BLOCK_TAGS and self.block == tag:
            self.flush()
        elif tag in ("strong", "b", "em", "i"):
            self.close_tag_marker(tag)
        elif tag == "a":
            href = self.links.pop() if self.links else None
            if href:
                self.current.append("](" + markdown_url(urljoin(self.base_url, href)) + ")")

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = re.sub(r"\s+", " ", data)

        if text.startswith(" ") and self.markers:
            marker = self.markers[-1]
            if (
                not marker["has_text"]
                and not marker["closed"]
                and marker["index"] == len(self.current) - 1
            ):
                # Move a space that sits inside <strong> to before the marker.
                self.current.insert(marker["index"], " ")
                marker["index"] += 1
                text = text.lstrip()

        if text.strip():
            for marker in self.markers:
                marker["has_text"] = True
        if text:
            self.current.append(escape_markdown(text))

    def open_marker(self, marker: str, tag: str) -> None:
        self.current.append(marker)
        self.markers.append({
            "marker": marker,
            "tag": tag,
            "index": len(self.current) - 1,
            "has_text": False,
            "closed": False,
        })

    def close_marker(self, marker: str) -> None:
        """Close bold/italic without swallowing the space before the marker."""
        suffix = ""
        if self.current and self.current[-1].endswith(" "):
            self.current[-1] = self.current[-1].rstrip(" ")
            suffix = " "
        self.current.append(marker + suffix)

    def close_tag_marker(self, tag: str) -> None:
        for position in range(len(self.markers) - 1, -1, -1):
            marker = self.markers[position]
            if marker["tag"] != tag:
                continue
            self.markers.pop(position)
            if marker["closed"]:
                return
            if marker["has_text"]:
                self.close_marker(marker["marker"])
            else:
                # Remove an empty <strong>/<em> rather than emitting "****".
                self.current[marker["index"]] = ""
            return

    def break_line(self) -> None:
        for marker in self.markers:
            if marker["closed"]:
                continue
            if marker["has_text"]:
                self.close_marker(marker["marker"])
            else:
                self.current[marker["index"]] = ""
            marker["closed"] = True
        self.current.append("\n")

    def flush(self) -> None:
        text = clean_text("".join(self.current))
        self.current = []
        self.markers.clear()
        self.links.clear()

        if not text:
            self.block = None
            self.link_count = 0
            self.style_guide_link_count = 0
            return

        # Skip the A-Z navigation paragraph at the top of each page.
        if self.link_count >= 15 and self.style_guide_link_count >= 15:
            self.block = None
            self.link_count = 0
            self.style_guide_link_count = 0
            return

        # Source markup sometimes contains an empty <strong> used only for spacing.
        text = re.sub(r"\*\*[ \t]*\*\*", " ", text)
        text = escape_block_starts(text)

        if self.block in HEADING_TAGS:
            level = int(self.block[1])
            text = f"{'#' * level} {text}"
        elif self.block == "li":
            text = f"- {text}"
        elif self.block == "blockquote":
            text = "\n".join(f"> {line}" if line else ">" for line in text.split("\n"))
        elif self.block == "p":
            text = format_definition_block(text)

        self.blocks.append(text)
        self.block = None
        self.link_count = 0
        self.style_guide_link_count = 0

    def markdown(self) -> str:
        self.flush()
        return "\n\n".join(self.blocks)


class PageParser(HTMLParser):
    """Extract the standfirst and article body from a Guardian page."""

    def __init__(self, url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.article = MarkdownBuilder(url)
        self.standfirst = MarkdownBuilder(url)
        self.article_depth = 0
        self.standfirst_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, self_closing=False)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, self_closing=True)

    def _start(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
        self_closing: bool,
    ) -> None:
        attributes = dict(attrs)

        if self.article_depth:
            if self_closing:
                self.article.handle_startendtag(tag, attrs)
            else:
                self.article.handle_starttag(tag, attrs)
                if tag not in VOID_TAGS:
                    self.article_depth += 1
            return

        if self.standfirst_depth:
            if self_closing:
                self.standfirst.handle_startendtag(tag, attrs)
            else:
                self.standfirst.handle_starttag(tag, attrs)
                if tag not in VOID_TAGS:
                    self.standfirst_depth += 1
            return

        class_name = attributes.get("class") or ""
        if "article-body-commercial-selector" in class_name:
            self.article_depth = 1
            return
        if attributes.get("data-gu-name") == "standfirst":
            self.standfirst_depth = 1

    def handle_endtag(self, tag: str) -> None:
        if self.article_depth:
            self.article.handle_endtag(tag)
            if tag not in VOID_TAGS:
                self.article_depth -= 1
            return

        if self.standfirst_depth:
            self.standfirst.handle_endtag(tag)
            if tag not in VOID_TAGS:
                self.standfirst_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.article_depth:
            self.article.handle_data(data)
        elif self.standfirst_depth:
            self.standfirst.handle_data(data)


def fetch(url: str, *, attempts: int = 3, timeout: float = 30.0) -> str:
    """Download a webpage with retries using only the standard library."""
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Encoding": "gzip",
        },
    )
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode(charset, errors="replace")
        except HTTPError as error:
            last_error = error
            if error.code == 404:
                raise
            if error.code != 429 and error.code < 500:
                raise
        except (URLError, TimeoutError) as error:
            last_error = error

        if attempt < attempts:
            time.sleep(2 ** (attempt - 1))

    raise RuntimeError(f"could not fetch {url}: {last_error}")


def as_blockquote(markdown: str) -> str:
    return "\n".join("> " + line if line else ">" for line in markdown.splitlines())


def parse_page(html: str, url: str) -> tuple[str, str]:
    parser = PageParser(url)
    parser.feed(html)
    standfirst_raw = parser.standfirst.markdown()
    standfirst = as_blockquote(standfirst_raw) if standfirst_raw else ""
    body = parser.article.markdown()
    return standfirst, body


def build_document(letters: str, delay: float) -> str:
    """Build a complete Markdown document for the specified letters."""
    letter_sections: list[tuple[str, str]] = []
    total = len(letters)

    for index, letter in enumerate(letters, start=1):
        url = PAGE_URL.format(letter=letter)
        print(f"[{index:2d}/{total}] {letter.upper()} {url}", file=sys.stderr)
        html = fetch(url)
        standfirst, body = parse_page(html, url)
        if not body:
            raise RuntimeError(f"no article body found for {url}")

        if standfirst:
            section = f"## {letter.upper()}\n\n{standfirst}\n\n{body}"
        else:
            section = f"## {letter.upper()}\n\n{body}"

        letter_sections.append((letter.upper(), section))
        if index < total:
            time.sleep(delay)

    contents = " · ".join(
        f"[{letter}](#{letter.lower()})" for letter, _ in letter_sections
    )
    today = dt.date.today().isoformat()

    header = (
        "# Guardian and Observer Style Guide\n\n"
        f"Source: <{SERIES_URL}>\n\n"
        f"Retrieved: {today}\n\n"
        "## Contents\n\n"
        f"{contents}"
    )
    return header + "\n\n" + "\n\n".join(section for _, section in letter_sections) + "\n"


def write_document(dest: Path, content: str, *, force: bool = False) -> bool:
    """Atomically write text content to a destination file if changed.

    Returns True if the file was written, False if substantive content was unchanged.
    """
    if dest.exists() and not force:
        existing = dest.read_text(encoding="utf-8")
        norm_existing = re.sub(r"^Retrieved: .*\n?", "", existing, flags=re.MULTILINE)
        norm_new = re.sub(r"^Retrieved: .*\n?", "", content, flags=re.MULTILINE)
        if norm_existing == norm_new:
            print(f"unchanged {dest}", file=sys.stderr)
            return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    temporary = dest.with_name(dest.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(dest)
    print(f"wrote {dest} ({len(content):,} characters)", file=sys.stderr)
    return True


def selftest() -> None:
    """Run offline verification of HTML-to-Markdown parsing and whitespace preservation."""
    nav = " ".join(
        f'<a href="/guardian-style-guide-{letter}">{letter.upper()}</a>'
        for letter in "abcdefghijklmnopqrstuvwxyz"
    )
    page = f"""
    <div data-gu-name="standfirst"><p>‘Quote.’ <strong>Author</strong></p></div>
    <div class="article-body-commercial-selector">
      <p>{nav}</p>
      <p><strong>A*</strong><br/>(A-level and GCSE) not A-star</p>
      <p><strong>term</strong><br>first line<br>second line</p>
      <p><strong>note</strong><br><em>italic</em></p>
      <p>In reference to US legislation, <strong>six-week abortion ban </strong>is preferable</p>
      <p><strong>Academy Awards</strong><br/>or<strong> Oscars</strong><br/>individual awards</p>
      <p>Use <strong>pro-choice</strong>,<strong> </strong>not pro-abortion;</p>
      <p>people born<strong> </strong>in the period</p>
    </div>
    """
    standfirst, body = parse_page(page, "https://example.com/test")

    assert "guardian-style-guide-a" not in body
    assert "**A\\*** — (A-level and GCSE) not A-star" in body
    assert "**term**\\\nfirst line\\\nsecond line" in body
    assert "**note** — *italic*" in body
    assert "**six-week abortion ban** is preferable" in body
    assert "or **Oscars**" in body
    assert "**pro-choice**, not pro-abortion;" in body
    assert "people born in the period" in body
    assert standfirst == "> ‘Quote.’ **Author**"
    print("selftest passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download the Guardian and Observer style guide in alphabetical batches."
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="output directory for batch files (default: references)",
    )
    parser.add_argument(
        "-o", "--out",
        type=Path,
        default=None,
        help="output a single combined Markdown file instead of batches",
    )
    parser.add_argument(
        "--letters",
        default=None,
        help="specific letters to download (e.g. 'abcdef' or 'z')",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.4,
        help="seconds between requests (default: 0.4)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="force writing files even if substantive content is unchanged",
    )
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="run the offline parser test and exit",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.selftest:
        selftest()
        return 0

    delay = max(0.0, args.delay)

    # Single-file or custom letters mode
    if args.letters or args.out:
        letters_raw = args.letters or "abcdefghijklmnopqrstuvwxyz"
        letters = "".join(char for char in letters_raw.lower() if char.isalpha())
        if not letters:
            print("error: --letters contains no valid letters", file=sys.stderr)
            return 2

        out_file = args.out or (args.out_dir / f"guardian-style-guide-{letters}.md")
        try:
            document = build_document(letters, delay)
            write_document(out_file, document, force=args.force)
        except Exception as error:
            print(f"error: {error}", file=sys.stderr)
            return 1
        return 0

    # Default: download all 4 batches into out_dir (references/)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    total_batches = len(DEFAULT_BATCHES)

    for b_idx, (batch_name, letters) in enumerate(DEFAULT_BATCHES, start=1):
        print(f"\n=== Batch [{b_idx}/{total_batches}]: {batch_name.upper()} ({letters}) ===", file=sys.stderr)
        out_file = args.out_dir / f"guardian-style-guide-{batch_name}.md"
        try:
            document = build_document(letters, delay)
            write_document(out_file, document, force=args.force)
        except Exception as error:
            print(f"error building batch {batch_name}: {error}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
