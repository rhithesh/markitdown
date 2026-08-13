# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
"""
Shared page/slide marker convention used by converters that know their page
boundaries (PDF, PPTX) and consumed by the chunking module to attribute each
chunk to a page number.

Converters that have no notion of a page (DOCX, HTML, XLSX, ...) simply don't
emit markers, and downstream page_no lookups resolve to None.
"""

import re
from typing import List, Optional, Tuple

# PPTX already emits "<!-- Slide number: N -->" between slides; PDF uses the
# same convention with "Page number" so both can be parsed identically.
_PAGE_MARKER_RE = re.compile(r"<!-- (?:Page|Slide) number: (\d+) -->\n?")


def pdf_page_marker(page_no: int) -> str:
    return f"<!-- Page number: {page_no} -->\n"


def strip_page_markers(text: str) -> Tuple[str, List[Tuple[int, int]]]:
    """
    Remove page/slide markers from `text`.

    Returns (clean_text, breakpoints), where breakpoints is a list of
    (offset_in_clean_text, page_no) sorted by offset. Each entry marks that,
    starting at that offset in clean_text, content belongs to page_no.
    """
    clean_parts = []
    breakpoints: List[Tuple[int, int]] = []
    clean_len = 0
    last_end = 0

    for m in _PAGE_MARKER_RE.finditer(text):
        segment = text[last_end : m.start()]
        clean_parts.append(segment)
        clean_len += len(segment)
        breakpoints.append((clean_len, int(m.group(1))))
        last_end = m.end()

    clean_parts.append(text[last_end:])
    return "".join(clean_parts), breakpoints


def page_at_offset(breakpoints: List[Tuple[int, int]], offset: int) -> Optional[int]:
    """Return the page number active at `offset` in the clean text, or None."""
    page_no = None
    for bp_offset, bp_page in breakpoints:
        if bp_offset <= offset:
            page_no = bp_page
        else:
            break
    return page_no
