class AppError(Exception):
    """Base for all application exceptions."""


class SettingsError(AppError):
    """Bad or missing settings.json configuration."""


class SheetError(AppError):
    """Google Sheets operation failed."""


class CacheError(AppError):
    """Cache operation failed."""


class TranslationError(AppError):
    """Translation service failed."""


class ImageUploadError(AppError):
    """ImgBB upload failed."""


class NewsletterError(AppError):
    """Newsletter rendering or export failed."""
