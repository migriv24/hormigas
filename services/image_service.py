"""ImgBB image upload service."""
import base64
from pathlib import Path

import requests

from core.exceptions import ImageUploadError
from core.logger import get_logger
from core.settings import get_settings

logger = get_logger("image_service")

_IMGBB_URL = "https://api.imgbb.com/1/upload"


def upload_image(
    file_path: str | None = None,
    base64_data: str | None = None,
    name: str = "",
) -> dict:
    """Upload an image to ImgBB.

    Provide either ``file_path`` (local file) or ``base64_data`` (already
    base64-encoded string).

    Returns a dict with keys: url, display_url, delete_url, thumb_url.
    """
    api_key = get_settings().get("imgbb_api_key", "")
    if not api_key or api_key == "YOUR_IMGBB_API_KEY_HERE":
        raise ImageUploadError("imgbb_api_key is not configured in settings.json")

    params: dict = {"key": api_key}
    if name:
        params["name"] = name

    try:
        if file_path:
            path = Path(file_path)
            if not path.exists():
                raise ImageUploadError(f"File not found: {file_path}")
            encoded = base64.b64encode(path.read_bytes()).decode("utf-8")
            params["image"] = encoded
            response = requests.post(_IMGBB_URL, data=params, timeout=30)
        elif base64_data:
            params["image"] = base64_data
            response = requests.post(_IMGBB_URL, data=params, timeout=30)
        else:
            raise ImageUploadError("Provide either file_path or base64_data")

        response.raise_for_status()
        data = response.json().get("data", {})
        result = {
            "url":         data.get("url", ""),
            "display_url": data.get("display_url", ""),
            "delete_url":  data.get("delete_url", ""),
            "thumb_url":   data.get("thumb", {}).get("url", ""),
        }
        logger.info(f"Uploaded image: {result['url']}")

        # Persist to local image store so the asset library stays up to date
        try:
            from data.image_store import add_image
            record = add_image(
                url=result["url"],
                display_url=result["display_url"],
                thumb_url=result["thumb_url"],
                delete_url=result["delete_url"],
                name=name,
            )
            result["id"] = record["id"]   # include store ID in response
        except Exception as store_exc:
            logger.warning(f"Image store write failed (upload still succeeded): {store_exc}")

        return result

    except ImageUploadError:
        raise
    except requests.HTTPError as exc:
        raise ImageUploadError(f"ImgBB HTTP error {exc.response.status_code}: {exc.response.text}") from exc
    except Exception as exc:
        raise ImageUploadError(f"Upload failed: {exc}") from exc
