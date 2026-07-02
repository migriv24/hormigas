"""Google Sheets implementation of BaseRepository using gspread."""
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from core.exceptions import SheetError
from core.logger import get_logger
from core.settings import get_settings
from data.cache import cache
from data.repository import BaseRepository
from schemas.contact import Contact
from schemas.event import Event
from schemas.presenter import Presenter
from schemas.organization import Organization, HEADERS as ORG_HEADERS

logger = get_logger("sheets")

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Exact tab names as they appear in the spreadsheet
_TAB_CONTACTS   = "List of Attendees"
_TAB_MAILING    = "Attendees added to the emailing"
_TAB_EVENTS     = "List of Upcomming Events"   # intentional typo matches sheet
_TAB_PRESENTERS = "Presentation Sign Up"

# How many header rows to skip per tab before data starts
_SKIP: dict[str, int] = {
    _TAB_CONTACTS:   3,
    _TAB_MAILING:    2,
    _TAB_EVENTS:     2,
    _TAB_PRESENTERS: 1,
}

_TAB_ORGS_GID = 1998240505   # numeric gid of the Organizations sheet
_TAB_ORGS     = "Organizations"  # fallback name
_SKIP_ORGS    = 1  # one header row


class SheetsRepository(BaseRepository):

    def __init__(self) -> None:
        settings = get_settings()
        creds_path = Path(settings["google_credentials_path"])
        if not creds_path.exists():
            raise SheetError(f"credentials file not found: {creds_path}")

        creds = Credentials.from_service_account_file(str(creds_path), scopes=_SCOPES)
        self._client = gspread.authorize(creds)
        self._sheet_id = settings["google_sheet_id"]
        self._spreadsheet: gspread.Spreadsheet | None = None
        logger.info("SheetsRepository ready")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _book(self) -> gspread.Spreadsheet:
        if self._spreadsheet is None:
            try:
                self._spreadsheet = self._client.open_by_key(self._sheet_id)
            except Exception as exc:
                raise SheetError(f"Cannot open spreadsheet: {exc}") from exc
        return self._spreadsheet

    def _ws(self, tab: str) -> gspread.Worksheet:
        try:
            return self._book().worksheet(tab)
        except gspread.WorksheetNotFound:
            raise SheetError(f"Worksheet not found: '{tab}'")

    def _data_rows(self, tab: str) -> list[list]:
        """Return all data rows for a tab, skipping headers."""
        skip = _SKIP[tab]
        all_rows = self._ws(tab).get_all_values()
        return all_rows[skip:]

    def _ws_orgs(self) -> gspread.Worksheet:
        """Get the Organizations worksheet by gid, falling back to tab name."""
        try:
            return self._book().get_worksheet_by_id(_TAB_ORGS_GID)
        except Exception:
            pass
        try:
            return self._book().worksheet(_TAB_ORGS)
        except gspread.WorksheetNotFound:
            raise SheetError("Organizations worksheet not found (tried by gid and by name)")

    def _ensure_orgs_headers(self, ws: gspread.Worksheet) -> None:
        """Write the header row if the sheet is empty."""
        try:
            first = ws.row_values(1)
            if not any(first):
                ws.update("A1", [ORG_HEADERS])
                logger.info("Wrote Organizations header row")
        except Exception as exc:
            raise SheetError(f"ensure_orgs_headers failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Contacts
    # ------------------------------------------------------------------

    def get_contacts(self) -> list[Contact]:
        hit = cache.get("contacts")
        if hit is not None:
            return hit
        try:
            rows = self._data_rows(_TAB_CONTACTS)
            skip = _SKIP[_TAB_CONTACTS]
            contacts = [
                Contact.from_sheet_row(row, i + skip + 1)   # +1 for 1-indexing
                for i, row in enumerate(rows)
                if any(c.strip() for c in row)
            ]
            cache.set("contacts", contacts)
            logger.info(f"Fetched {len(contacts)} contacts")
            return contacts
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"get_contacts failed: {exc}") from exc

    def update_contact(self, contact: Contact) -> None:
        if contact.row_index is None:
            raise SheetError("update_contact requires row_index")
        try:
            ws = self._ws(_TAB_CONTACTS)
            r = contact.row_index
            ws.update(f"A{r}:K{r}", [contact.to_sheet_row()])
            cache.invalidate("contacts")
            logger.info(f"Updated contact '{contact.name}' @ row {r}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"update_contact failed: {exc}") from exc

    def add_contact(self, contact: Contact) -> Contact:
        try:
            ws = self._ws(_TAB_CONTACTS)
            ws.append_row(contact.to_sheet_row(), value_input_option="USER_ENTERED")
            cache.invalidate("contacts")
            logger.info(f"Added contact '{contact.name}'")
            return contact
        except Exception as exc:
            raise SheetError(f"add_contact failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def get_events(self) -> list[Event]:
        hit = cache.get("events")
        if hit is not None:
            return hit
        try:
            rows = self._data_rows(_TAB_EVENTS)
            skip = _SKIP[_TAB_EVENTS]
            events = [
                Event.from_sheet_row(row, i + skip + 1)
                for i, row in enumerate(rows)
                if any(c.strip() for c in row)
            ]
            cache.set("events", events)
            logger.info(f"Fetched {len(events)} events")
            return events
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"get_events failed: {exc}") from exc

    def update_event(self, event: Event) -> None:
        if event.row_index is None:
            raise SheetError("update_event requires row_index")
        try:
            ws = self._ws(_TAB_EVENTS)
            r = event.row_index
            ws.update(f"A{r}:J{r}", [event.to_sheet_row()])
            cache.invalidate("events")
            logger.info(f"Updated event '{event.title}' @ row {r}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"update_event failed: {exc}") from exc

    def add_event(self, event: Event) -> Event:
        try:
            ws = self._ws(_TAB_EVENTS)
            ws.append_row(event.to_sheet_row(), value_input_option="USER_ENTERED")
            cache.invalidate("events")
            logger.info(f"Added event '{event.title}'")
            return event
        except Exception as exc:
            raise SheetError(f"add_event failed: {exc}") from exc

    def delete_event(self, event: Event) -> None:
        if event.row_index is None:
            raise SheetError("delete_event requires row_index")
        try:
            self._ws(_TAB_EVENTS).delete_rows(event.row_index)
            cache.invalidate("events")
            logger.info(f"Deleted event '{event.title}' @ row {event.row_index}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"delete_event failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Presenters
    # ------------------------------------------------------------------

    def get_presenters(self) -> list[Presenter]:
        hit = cache.get("presenters")
        if hit is not None:
            return hit
        try:
            rows = self._data_rows(_TAB_PRESENTERS)
            skip = _SKIP[_TAB_PRESENTERS]
            presenters = [
                Presenter.from_sheet_row(row, i + skip + 1)
                for i, row in enumerate(rows)
                if any(c.strip() for c in row)
            ]
            cache.set("presenters", presenters)
            logger.info(f"Fetched {len(presenters)} presenters")
            return presenters
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"get_presenters failed: {exc}") from exc

    def add_presenter(self, presenter: Presenter) -> Presenter:
        try:
            self._ws(_TAB_PRESENTERS).append_row(
                presenter.to_sheet_row(), value_input_option="USER_ENTERED"
            )
            cache.invalidate("presenters")
            logger.info(f"Added presenter '{presenter.name}'")
            return presenter
        except Exception as exc:
            raise SheetError(f"add_presenter failed: {exc}") from exc

    def update_presenter(self, presenter: Presenter) -> None:
        if presenter.row_index is None:
            raise SheetError("update_presenter requires row_index")
        try:
            ws = self._ws(_TAB_PRESENTERS)
            r = presenter.row_index
            ws.update(f"A{r}:F{r}", [presenter.to_sheet_row()])
            cache.invalidate("presenters")
            logger.info(f"Updated presenter '{presenter.name}' @ row {r}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"update_presenter failed: {exc}") from exc

    def delete_presenter(self, presenter: Presenter) -> None:
        if presenter.row_index is None:
            raise SheetError("delete_presenter requires row_index")
        try:
            self._ws(_TAB_PRESENTERS).delete_rows(presenter.row_index)
            cache.invalidate("presenters")
            logger.info(f"Deleted presenter '{presenter.name}' @ row {presenter.row_index}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"delete_presenter failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Organizations
    # ------------------------------------------------------------------

    def get_organizations(self) -> list[Organization]:
        hit = cache.get("organizations")
        if hit is not None:
            return hit
        try:
            ws   = self._ws_orgs()
            self._ensure_orgs_headers(ws)
            rows = ws.get_all_values()[_SKIP_ORGS:]   # skip header
            orgs = [
                Organization.from_sheet_row(row, i + _SKIP_ORGS + 1)
                for i, row in enumerate(rows)
                if any(c.strip() for c in row)
            ]
            cache.set("organizations", orgs)
            logger.info(f"Fetched {len(orgs)} organizations")
            return orgs
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"get_organizations failed: {exc}") from exc

    def add_organization(self, org: Organization) -> Organization:
        try:
            ws = self._ws_orgs()
            self._ensure_orgs_headers(ws)
            ws.append_row(org.to_sheet_row(), value_input_option="USER_ENTERED")
            cache.invalidate("organizations")
            logger.info(f"Added organization '{org.name}'")
            return org
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"add_organization failed: {exc}") from exc

    def update_organization(self, org: Organization) -> None:
        if not org.row_index:
            raise SheetError("update_organization requires row_index")
        try:
            ws = self._ws_orgs()
            r  = org.row_index
            ws.update(f"A{r}:I{r}", [org.to_sheet_row()])
            cache.invalidate("organizations")
            logger.info(f"Updated organization '{org.name}' @ row {r}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"update_organization failed: {exc}") from exc

    def delete_organization(self, org: Organization) -> None:
        if not org.row_index:
            raise SheetError("delete_organization requires row_index")
        try:
            self._ws_orgs().delete_rows(org.row_index)
            cache.invalidate("organizations")
            logger.info(f"Deleted organization '{org.name}' @ row {org.row_index}")
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"delete_organization failed: {exc}") from exc

    def populate_organizations(self, orgs: list[Organization], append_only: bool = False) -> int:
        """Write a batch of orgs to the sheet.

        If append_only=True, only appends orgs whose name is not already present.
        If append_only=False (default for first-time populate), clears data rows and rewrites.
        Returns count of rows written.
        """
        try:
            ws = self._ws_orgs()
            self._ensure_orgs_headers(ws)

            if append_only:
                existing_names = {
                    row[0].strip().lower()
                    for row in ws.get_all_values()[_SKIP_ORGS:]
                    if row and row[0].strip()
                }
                to_write = [o for o in orgs if o.name.lower() not in existing_names]
            else:
                # Clear everything below the header row
                all_rows = ws.get_all_values()
                if len(all_rows) > 1:
                    ws.delete_rows(2, len(all_rows))
                to_write = list(orgs)

            if to_write:
                ws.append_rows(
                    [o.to_sheet_row() for o in to_write],
                    value_input_option="USER_ENTERED",
                )
            cache.invalidate("organizations")
            logger.info(f"Populated {len(to_write)} organization rows (append_only={append_only})")
            return len(to_write)
        except SheetError:
            raise
        except Exception as exc:
            raise SheetError(f"populate_organizations failed: {exc}") from exc
