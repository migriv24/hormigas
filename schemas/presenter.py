from dataclasses import dataclass
from typing import Optional


@dataclass
class Presenter:
    name: str
    organization: str
    slides_link: str = ""
    presentation_month: str = ""
    description: str = ""
    presentation_year: str = ""   # col F — e.g. "2026"
    row_index: Optional[int] = None

    @classmethod
    def from_sheet_row(cls, row: list, row_index: int) -> "Presenter":
        def safe(i: int, default: str = "") -> str:
            val = row[i] if i < len(row) else ""
            return str(val).strip() if val else default

        return cls(
            name=safe(0),
            organization=safe(1),
            slides_link=safe(2),
            presentation_month=safe(3),
            description=safe(4),
            presentation_year=safe(5),
            row_index=row_index,
        )

    def to_sheet_row(self) -> list:
        return [
            self.name,
            self.organization,
            self.slides_link,
            self.presentation_month,
            self.description,
            self.presentation_year,
        ]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "organization": self.organization,
            "slides_link": self.slides_link,
            "presentation_month": self.presentation_month,
            "description": self.description,
            "presentation_year": self.presentation_year,
            "row_index": self.row_index,
        }
