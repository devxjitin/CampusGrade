import threading
import time
from collections import defaultdict, deque


class SlidingWindowRateLimiter:
    """Small process-local limiter for abuse-prone endpoints.

    Production deployments with multiple API workers should replace this with a
    shared Redis-backed implementation.
    """

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._events = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> tuple[bool, int]:
        timestamp = time.monotonic() if now is None else now
        cutoff = timestamp - self.window_seconds

        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()

            if len(events) >= self.limit:
                retry_after = max(1, int(self.window_seconds - (timestamp - events[0])))
                return False, retry_after

            events.append(timestamp)
            return True, 0
