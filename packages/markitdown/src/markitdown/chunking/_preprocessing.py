# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
import re

# Collapse runs of spaces/tabs into a single space (PDF extraction sometimes
# emits literal tab characters between words instead of spaces).
_WHITESPACE_RUN_RE = re.compile(r"[ \t]+")
# Cap runs of 3+ newlines down to a single blank line.
_EXCESS_BLANK_LINES_RE = re.compile(r"\n{3,}")


def normalize_whitespace(text: str) -> str:
    text = _WHITESPACE_RUN_RE.sub(" ", text)
    text = _EXCESS_BLANK_LINES_RE.sub("\n\n", text)
    return text
