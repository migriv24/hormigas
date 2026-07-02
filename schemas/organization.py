"""Organization schema — one row in the Organizations sheet."""
from dataclasses import dataclass, field


# Column order in the Google Sheet (A=0, B=1, …)
_COL_NAME        = 0
_COL_ABBREV      = 1
_COL_ALT_NAME    = 2
_COL_CONTACT     = 3
_COL_EMAIL       = 4
_COL_WEBSITE     = 5
_COL_LOCATION    = 6
_COL_DESCRIPTION = 7
_COL_IMAGE_URL   = 8
_NUM_COLS        = 9

HEADERS = [
    "Name", "Abbreviation", "Alternate Name",
    "Primary Contact", "Contact Email",
    "Website", "Location", "Description", "Image URL",
]


def _get(row: list, idx: int) -> str:
    return row[idx].strip() if idx < len(row) else ""


@dataclass
class Organization:
    name:          str = ""   # required — primary display name
    abbreviation:  str = ""   # e.g. LCIDN, SASS
    alternate_name:str = ""   # full / longer variant name
    primary_contact: str = "" # person name (required per spec)
    contact_email: str = ""
    website:       str = ""
    location:      str = ""
    description:   str = ""
    image_url:     str = ""
    row_index:     int = 0    # 1-based sheet row

    # ── Serialisation ──────────────────────────────────────────────────────────

    @classmethod
    def from_sheet_row(cls, row: list, row_index: int) -> "Organization":
        return cls(
            name           = _get(row, _COL_NAME),
            abbreviation   = _get(row, _COL_ABBREV),
            alternate_name = _get(row, _COL_ALT_NAME),
            primary_contact= _get(row, _COL_CONTACT),
            contact_email  = _get(row, _COL_EMAIL),
            website        = _get(row, _COL_WEBSITE),
            location       = _get(row, _COL_LOCATION),
            description    = _get(row, _COL_DESCRIPTION),
            image_url      = _get(row, _COL_IMAGE_URL),
            row_index      = row_index,
        )

    def to_sheet_row(self) -> list:
        row = [""] * _NUM_COLS
        row[_COL_NAME]        = self.name
        row[_COL_ABBREV]      = self.abbreviation
        row[_COL_ALT_NAME]    = self.alternate_name
        row[_COL_CONTACT]     = self.primary_contact
        row[_COL_EMAIL]       = self.contact_email
        row[_COL_WEBSITE]     = self.website
        row[_COL_LOCATION]    = self.location
        row[_COL_DESCRIPTION] = self.description
        row[_COL_IMAGE_URL]   = self.image_url
        return row

    def to_dict(self) -> dict:
        return {
            "name":           self.name,
            "abbreviation":   self.abbreviation,
            "alternate_name": self.alternate_name,
            "primary_contact":self.primary_contact,
            "contact_email":  self.contact_email,
            "website":        self.website,
            "location":       self.location,
            "description":    self.description,
            "image_url":      self.image_url,
            "row_index":      self.row_index,
        }
