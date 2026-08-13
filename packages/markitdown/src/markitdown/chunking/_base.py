# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Chunk:
    """A single chunk of text plus metadata about where it came from."""

    text: str
    metadata: Dict[str, Any] = field(default_factory=dict)


class BaseChunker(ABC):
    """Common interface implemented by every chunking strategy."""

    @abstractmethod
    def chunk(self, text: str, *, filename: Optional[str] = None) -> List[Chunk]:
        """Split `text` into a list of Chunk objects."""
        ...
