"""Abstract translation service interface.

Swap providers by changing `translation_provider` in settings.json.
Current: "google"  (deep-translator, free)
Future:  "claude"  (Claude API, higher quality, needs key)
"""
from abc import ABC, abstractmethod


class TranslationService(ABC):

    @abstractmethod
    def translate(self, text: str, target_lang: str = "es") -> str:
        """Translate a single string. Returns original text if empty."""
        ...

    @abstractmethod
    def translate_batch(self, texts: list[str], target_lang: str = "es") -> list[str]:
        """Translate a list of strings, preserving order."""
        ...
