"""Resource upload and PDF graphic generation service.

upload_resource(file_bytes, filename, ...)  → resource record
generate_graphic(resource_id, pages)        → updated resource record with generated_image_*
"""
import base64
import io
import uuid
from pathlib import Path

from core.logger import get_logger
from services.storage.local_storage import get_default_storage

logger = get_logger("resource_service")


def upload_resource(
    file_bytes: bytes,
    filename: str,
    display_name: str = "",
    tags: list = None,
    language: str = "",
) -> dict:
    """Save a resource file via the storage backend and register it in resource_store."""
    from data.resource_store import add_resource

    resource_type = _detect_type(filename)
    rid    = uuid.uuid4().hex[:12]
    suffix = Path(filename).suffix.lower() or ".bin"

    storage   = get_default_storage()
    file_path = storage.save(file_bytes, rid, suffix)

    page_count = 0
    if resource_type == "pdf":
        page_count = _count_pdf_pages(Path(file_path))

    record = add_resource(
        filename=filename,
        display_name=display_name or Path(filename).stem,
        resource_type=resource_type,
        file_path=file_path,
        tags=tags or [],
        page_count=page_count,
        language=language,
    )
    logger.info(f"Uploaded resource: {record['id']} ({filename}, {page_count} pages, lang={language or 'neutral'})")
    return record


def generate_graphic(resource_id: str, pages: list = None, extra_tags: list = None) -> dict:
    """Render PDF pages side-by-side, upload to ImgBB, store in image_store.

    The generated image inherits the resource's language so it appears with the
    correct language badge in the Images tab. It is also tagged with 'generated'
    and 'pdf-preview' (plus any resource tags and extra_tags).

    Returns the updated resource record with generated_image_id and generated_image_url.
    """
    from data.resource_store import get_resource, update_resource
    from services.image_service import upload_image
    from data.image_store import update_image

    rec = get_resource(resource_id)
    if rec is None:
        raise ValueError(f"Resource '{resource_id}' not found")

    file_path = Path(rec["file_path"])
    if not file_path.exists():
        raise FileNotFoundError(f"Resource file missing: {file_path}")

    if pages is None:
        pages = [0, 1] if rec.get("page_count", 0) > 1 else [0]

    logger.info(f"Generating graphic for resource {resource_id}, pages={pages}")
    img_bytes = _render_pdf_pages(file_path, pages)
    b64 = base64.b64encode(img_bytes).decode("utf-8")

    img_name = f"{rec['display_name']} — PDF Preview"
    img_tags = list(dict.fromkeys(
        ["generated", "pdf-preview"] + (extra_tags or []) + rec.get("tags", [])
    ))

    upload_result = upload_image(base64_data=b64, name=img_name)
    image_id  = upload_result.get("id")
    image_url = upload_result.get("url", "")

    if image_id:
        update_image(
            image_id,
            tags=img_tags,
            description=f"Auto-generated preview for: {rec['display_name']}",
            language=rec.get("language", ""),
        )

    updated = update_resource(
        resource_id,
        generated_image_id=image_id,
        generated_image_url=image_url,
    )
    logger.info(f"Graphic generated and uploaded: {image_url}")
    return updated


# ── Internal helpers ───────────────────────────────────────────────────────────

def _detect_type(filename: str) -> str:
    return "pdf" if Path(filename).suffix.lower() == ".pdf" else "file"


def _count_pdf_pages(path: Path) -> int:
    try:
        import fitz
        doc   = fitz.open(str(path))
        count = doc.page_count
        doc.close()
        return count
    except Exception as exc:
        logger.warning(f"Could not count PDF pages: {exc}")
        return 0


def _render_pdf_pages(path: Path, pages: list) -> bytes:
    """Render specified PDF page indices side-by-side and return PNG bytes."""
    try:
        import fitz
    except ImportError as exc:
        raise ImportError(
            "pymupdf is required for PDF graphic generation. Run: pip install pymupdf"
        ) from exc

    doc   = fitz.open(str(path))
    total = doc.page_count
    valid = [p for p in pages if 0 <= p < total]
    if not valid:
        valid = [0]

    zoom = 2.0
    mat  = fitz.Matrix(zoom, zoom)

    if len(valid) == 1:
        page = doc.load_page(valid[0])
        pix  = page.get_pixmap(matrix=mat, alpha=False)
        doc.close()
        return pix.tobytes("png")

    # Render each page then composite side-by-side
    pixmaps = []
    for p in valid:
        page = doc.load_page(p)
        pixmaps.append(page.get_pixmap(matrix=mat, alpha=False))
    doc.close()

    try:
        from PIL import Image
        imgs = [
            Image.frombytes("RGB", [px.width, px.height], px.samples)
            for px in pixmaps
        ]
        gap     = 16
        total_w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
        max_h   = max(i.height for i in imgs)
        canvas  = Image.new("RGB", (total_w, max_h), (230, 230, 230))
        x = 0
        for img in imgs:
            canvas.paste(img, (x, 0))
            x += img.width + gap
        buf = io.BytesIO()
        canvas.save(buf, "PNG", optimize=True)
        return buf.getvalue()
    except ImportError:
        logger.warning("Pillow not installed; falling back to single-page graphic")
        return pixmaps[0].tobytes("png")
