"""Abstract base repository.

Swap the implementation (SheetsRepository → PostgresRepository, etc.)
without touching any service or route code.
"""
from abc import ABC, abstractmethod

from schemas.contact import Contact
from schemas.event import Event
from schemas.presenter import Presenter
from schemas.organization import Organization


class BaseRepository(ABC):

    # --- Contacts ---

    @abstractmethod
    def get_contacts(self) -> list[Contact]: ...

    @abstractmethod
    def update_contact(self, contact: Contact) -> None: ...

    @abstractmethod
    def add_contact(self, contact: Contact) -> Contact: ...

    # --- Events ---

    @abstractmethod
    def get_events(self) -> list[Event]: ...

    @abstractmethod
    def update_event(self, event: Event) -> None: ...

    @abstractmethod
    def add_event(self, event: Event) -> Event: ...

    @abstractmethod
    def delete_event(self, event: Event) -> None: ...

    # --- Presenters ---

    @abstractmethod
    def get_presenters(self) -> list[Presenter]: ...

    @abstractmethod
    def add_presenter(self, presenter: Presenter) -> Presenter: ...

    @abstractmethod
    def update_presenter(self, presenter: Presenter) -> None: ...

    @abstractmethod
    def delete_presenter(self, presenter: Presenter) -> None: ...

    # --- Organizations ---

    @abstractmethod
    def get_organizations(self) -> list[Organization]: ...

    @abstractmethod
    def add_organization(self, org: Organization) -> Organization: ...

    @abstractmethod
    def update_organization(self, org: Organization) -> None: ...

    @abstractmethod
    def delete_organization(self, org: Organization) -> None: ...

    @abstractmethod
    def populate_organizations(self, orgs: list[Organization], append_only: bool = False) -> int: ...
