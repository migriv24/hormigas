"""Abstract file storage interface for resources.

Swap implementations (local vs. cloud) without touching upload/delete call sites.
"""
from abc import ABC, abstractmethod


class BaseFileStorage(ABC):
    @abstractmethod
    def save(self, file_bytes: bytes, resource_id: str, suffix: str) -> str:
        """Persist file_bytes and return a stable path/URI string."""

    @abstractmethod
    def load(self, path: str) -> bytes:
        """Read and return file bytes from path/URI."""

    @abstractmethod
    def delete(self, path: str) -> None:
        """Remove file at path/URI. Silent if already missing."""

    @abstractmethod
    def exists(self, path: str) -> bool:
        """Return True if a file exists at path/URI."""
