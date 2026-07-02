from deep_translator import GoogleTranslator

from core.exceptions import TranslationError
from core.logger import get_logger
from services.translation.base import TranslationService

logger = get_logger("translation.google")


class GoogleTranslateService(TranslationService):

    def translate(self, text: str, target_lang: str = "es") -> str:
        if not text or not text.strip():
            return text
        try:
            result = GoogleTranslator(source="auto", target=target_lang).translate(text)
            logger.debug(f"[{target_lang}] '{text[:40]}' → '{result[:40]}'")
            return result or text
        except Exception as exc:
            raise TranslationError(f"Google Translate failed: {exc}") from exc

    def translate_batch(self, texts: list[str], target_lang: str = "es") -> list[str]:
        return [self.translate(t, target_lang) for t in texts]
