"""Local filesystem implementation of BaseFileStorage.

Files are written to data/resources/<resource_id><suffix>.
To swap in cloud storage later: implement BaseFileStorage, return it from
get_default_storage(), and update resource_store.delete_resource to not
touch the filesystem (delegate to the service layer instead).
"""
from pathlib import Path

from services.storage.base_storage import BaseFileStorage

_DEFAULT_DIR = Path(__file__).parent.parent.parent / "data" / "resources"


class LocalFileStorage(BaseFileStorage):
    def __init__(self, directory: Path = None):
        self._dir = Path(directory) if directory else _DEFAULT_DIR
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(self, file_bytes: bytes, resource_id: str, suffix: str) -> str:
        path = self._dir / f"{resource_id}{suffix}"
        path.write_bytes(file_bytes)
        return str(path)

    def load(self, path: str) -> bytes:
        return Path(path).read_bytes()

    def delete(self, path: str) -> None:
        try:
            Path(path).unlink()
        except FileNotFoundError:
            pass

    def exists(self, path: str) -> bool:
        return Path(path).exists()


def get_default_storage() -> LocalFileStorage:
    """Return the active storage backend. Swap this out to enable cloud storage."""
    return LocalFileStorage()
