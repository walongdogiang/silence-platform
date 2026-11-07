from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    id: int
    name: str
    email: str
    active: bool = True


class UserStore:
    def __init__(self) -> None:
        self._users: dict[int, User] = {}

    def add(self, user: User) -> None:
        self._users[user.id] = user

    def get(self, user_id: int) -> User:
        # BUG: KeyError instead of returning None
        return self._users[user_id]

    def find_by_email(self, email: str) -> Optional[User]:
        for user in self._users.values():
            if user.email.lower() == email:  # BUG: email not lowercased
                return user
        return None

    def deactivate(self, user_id: int) -> None:
        user = self.get(user_id)
        user.active = False
