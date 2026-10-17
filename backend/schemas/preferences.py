from datetime import datetime

from pydantic import BaseModel, Field

# In-app notification categories.
IN_APP_KEYS = {
    "assignment_deadlines", "assignment_submissions", "assignment_grades",
    "discussions", "administration",
}
# Per-type email opt-outs (Sprint 4). Stored beside the in-app keys; every key defaults to on.
EMAIL_KEYS = {"email_assignment_deadlines", "email_assignment_grades", "email_discussions"}
NOTIFICATION_KEYS = IN_APP_KEYS | EMAIL_KEYS


class PreferenceUpdate(BaseModel):
    notification_preferences: dict[str, bool] = Field(default_factory=dict)


class SessionResponse(BaseModel):
    id: str
    device_info: str
    ip_address: str | None = None
    created_at: datetime
    last_seen_at: datetime | None = None
    expires_at: datetime
    current: bool
