from typing import Any

from src.user import User, UserStore


store = UserStore()


def health() -> dict[str, Any]:
    return {"ok": True}


def create_user(body: dict[str, Any]) -> dict[str, Any]:
    user = User(
        id=int(body["id"]),
        name=body["name"],
        email=body["email"],
    )
    store.add(user)
    return {"status": 200, "user": user.__dict__}  # BUG: should be 201


def get_user(user_id: int) -> dict[str, Any]:
    user = store.get(user_id)
    return {"status": 200, "user": user.__dict__}


def echo_headers(headers: dict[str, str]) -> dict[str, str]:
    # BUG: drops Authorization instead of redacting
    return {k: v for k, v in headers.items() if k.lower() != "authorization"}
