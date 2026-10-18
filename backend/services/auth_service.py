import datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from services.identity_service import get_user_by_email, update_user_fields


class AuthService:
    """Email-only sign-in.

    There are no passwords: the email address alone identifies the account. This is only safe on
    a developer machine, which is why `config.Settings` refuses to start with APP_ENV=production.
    """

    @staticmethod
    async def authenticate(identifier: str, db: AsyncSession) -> dict:
        user = await get_user_by_email(db, identifier)
        if not user:
            raise HTTPException(status_code=401, detail="No account found for this email")
        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Your account has been suspended. Contact administration.")
        await update_user_fields(db, user["_id"], {"last_login": datetime.datetime.utcnow()})
        return user
