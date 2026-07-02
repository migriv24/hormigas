"""Command pattern with undo/redo stack.

Usage:
    from core.command import history

    cmd = UpdateContactCommand(repo, old, new)
    history.execute(cmd)   # runs cmd.execute() and pushes to stack
    history.undo()
    history.redo()
"""
from abc import ABC, abstractmethod
from typing import Optional

from core.logger import get_logger

logger = get_logger("command")


class Command(ABC):
    @abstractmethod
    def execute(self) -> None: ...

    @abstractmethod
    def undo(self) -> None: ...

    @property
    def description(self) -> str:
        return self.__class__.__name__


class CommandHistory:
    def __init__(self, max_size: int = 50) -> None:
        self._done: list[Command] = []
        self._undone: list[Command] = []
        self._max = max_size

    def execute(self, command: Command) -> None:
        command.execute()
        self._done.append(command)
        self._undone.clear()
        if len(self._done) > self._max:
            self._done.pop(0)
        logger.info(f"Executed: {command.description}")

    def undo(self) -> Optional[str]:
        if not self._done:
            return None
        cmd = self._done.pop()
        cmd.undo()
        self._undone.append(cmd)
        logger.info(f"Undone: {cmd.description}")
        return cmd.description

    def redo(self) -> Optional[str]:
        if not self._undone:
            return None
        cmd = self._undone.pop()
        cmd.execute()
        self._done.append(cmd)
        logger.info(f"Redone: {cmd.description}")
        return cmd.description

    @property
    def can_undo(self) -> bool:
        return bool(self._done)

    @property
    def can_redo(self) -> bool:
        return bool(self._undone)

    @property
    def history(self) -> list[str]:
        return [c.description for c in self._done]

    def clear(self) -> None:
        self._done.clear()
        self._undone.clear()


# Application-wide singleton
history = CommandHistory()
