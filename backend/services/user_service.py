from schemas.user import UserUpdate
from utils.validators import sanitize_string


class UserService:
    """User-profile business rules independent of transport details."""

    @staticmethod
    def profile_update_fields(body: UserUpdate, role: str) -> dict:
        payload = body.model_dump(exclude_unset=True)
        update: dict = {}
        for field in ("name", "bio", "roll_no", "batch_year"):
            if field in payload and payload[field] is not None:
                update[field] = sanitize_string(payload[field], 5000 if field == "bio" else 100)
        # Sprint 5, IMPLEMENTATION_PLAN.md: both admin roles are excluded
        # here, same as the single "admin" role was before the split.
        if role not in ("super_admin", "program_admin"):
            for field in ("github_username",):
                if field in payload and payload[field] is not None:
                    update[field] = sanitize_string(payload[field], 100)
        if role == "student" and "leetcode_username" in payload and payload["leetcode_username"] is not None:
            update["leetcode_username"] = sanitize_string(payload["leetcode_username"], 100)
        for field, item_limit in (("achievements", 200), ("github_repositories", 300)):
            if field in payload and payload[field] is not None:
                update[field] = [
                    sanitize_string(item, item_limit)
                    for item in payload[field]
                    if isinstance(item, str) and item.strip()
                ][:10]
        return update
