import datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security_utils import hash_password, needs_password_rehash, verify_password

from services.identity_service import get_user_by_email, update_user_fields


class AuthService:
    """Password authentication and account lockout policy."""

    @staticmethod
    async def authenticate(identifier: str, password: str, db: AsyncSession) -> dict:
        user = await get_user_by_email(db, identifier)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        now = datetime.datetime.utcnow()
        if user.get("locked_until") and user["locked_until"] > now:
            remaining = int((user["locked_until"] - now).total_seconds() / 60) + 1
            raise HTTPException(status_code=429, detail=f"Account temporarily locked. Try again in {remaining} minute(s).")
        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Your account has been suspended. Contact administration.")
        if not verify_password(password, user["password"]):
            attempts = int(user.get("login_attempts") or 0) + 1
            update = {"login_attempts": attempts}
            if attempts >= 5:
                update["locked_until"] = now + datetime.timedelta(minutes=15)
            await update_user_fields(db, user["_id"], update)
            remaining = 5 - attempts if attempts < 5 else 0
            message = "Invalid email or password"
            if 0 < remaining <= 2:
                message += f". {remaining} attempt(s) remaining before account lock."
            raise HTTPException(status_code=401, detail=message)
        update = {"login_attempts": 0, "locked_until": None, "last_login": now}
        if needs_password_rehash(user["password"]):
            update["password"] = hash_password(password)
        await update_user_fields(db, user["_id"], update)
        return user
