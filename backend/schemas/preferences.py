from datetime import datetime

from pydantic import BaseModel, Field

NOTIFICATION_KEYS = {
    "assignment_deadlines", "assignment_submissions", "assignment_grades",
    "discussions", "administration",
}


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
