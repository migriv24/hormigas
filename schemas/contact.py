from dataclasses import dataclass
from typing import Optional


@dataclass
class Contact:
    name: str
    organization: str
    title: str = ""
    email: str = ""
    office_phone: str = ""
    work_cell: str = ""
    website: str = ""
    last_updated: str = ""
    notes: str = ""           # public bio — shown in newsletters and attendee lists
    internal_notes: str = "" # private operational notes — stored/exported but never rendered
    receive_newsletter: bool = True
    image_url: str = ""       # col K — profile photo URL
    row_index: Optional[int] = None  # 1-indexed sheet row; None for unsaved records

    @classmethod
    def from_sheet_row(cls, row: list, row_index: int) -> "Contact":
        def safe(i: int, default: str = "") -> str:
            val = row[i] if i < len(row) else ""
            return str(val).strip() if val else default

        receive_raw = safe(9, "TRUE").upper()
        receive = receive_raw not in ("FALSE", "0", "NO")

        return cls(
            name=safe(0),
            organization=safe(1),
            title=safe(2),
            email=safe(3),
            office_phone=safe(4),
            work_cell=safe(5),
            website=safe(6),
            last_updated=safe(7),
            notes=safe(8),
            receive_newsletter=receive,
            image_url=safe(10),
            row_index=row_index,
        )

    def to_sheet_row(self) -> list:
        return [
            self.name,
            self.organization,
            self.title,
            self.email,
            self.office_phone,
            self.work_cell,
            self.website,
            self.last_updated,
            self.notes,
            "TRUE" if self.receive_newsletter else "FALSE",
            self.image_url,
        ]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "organization": self.organization,
            "title": self.title,
            "email": self.email,
            "office_phone": self.office_phone,
            "work_cell": self.work_cell,
            "website": self.website,
            "last_updated": self.last_updated,
            "notes": self.notes,
            "internal_notes": self.internal_notes,
            "receive_newsletter": self.receive_newsletter,
            "image_url": self.image_url,
            "row_index": self.row_index,
        }
