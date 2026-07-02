"""Manages bidirectional links between images and events.

Each image stores event_ids: [] — a list of linked event row_indices (as strings).
One image can link to many events; one event can link to many images.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import data.image_store as image_store


def link_image_to_event(image_id: str, event_row_index: int) -> dict | None:
    """Add event to image's event_ids list. Returns updated image, or None if not found."""
    return image_store.update_image(image_id, add_event_id=str(event_row_index))


def unlink_image_from_event(image_id: str, event_row_index: int) -> dict | None:
    """Remove a specific event from image's event_ids list. Returns updated image, or None."""
    return image_store.update_image(image_id, remove_event_id=str(event_row_index))


def get_images_for_event(event_row_index: int) -> list[dict]:
    """Return all images that have this event in their event_ids list."""
    key = str(event_row_index)
    return [img for img in image_store.get_images() if key in img.get("event_ids", [])]


def on_event_deleted(event_row_index: int) -> int:
    """Remove event_row_index from all images. Returns count of images updated."""
    return image_store.clear_event_links(event_row_index)
