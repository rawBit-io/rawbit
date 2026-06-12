"""Sliding-window accounting for calculation time budgets."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Iterable, Tuple, TYPE_CHECKING, cast

try:  # Optional dependency, only needed when Redis is used.
    import redis
    from redis.exceptions import RedisError
except ImportError:  # pragma: no cover - handled at runtime when Redis is unavailable
    redis = None  # type: ignore[assignment]
    RedisError = Exception  # type: ignore[assignment]

if TYPE_CHECKING:
    from redis import Redis


_LOGGER = logging.getLogger(__name__)

CalculationBudget = Tuple[bool, float]


class CalculationBudgetTracker:
    """Routine used by the API to enforce a shared computation budget."""

    window_seconds: float
    budget_seconds: float

    def check(self, key: str, now: float | None = None) -> CalculationBudget:
        """Return (allowed, total_recent_seconds) for the provided identity key."""

        raise NotImplementedError

    def record(self, key: str, duration_seconds: float, now: float | None = None) -> None:
        """Record a finished calculation against the provided identity key."""

        raise NotImplementedError

    def reset(self) -> None:
        """Clear all accounting state (used by tests)."""

        raise NotImplementedError


@dataclass
class _Window:
    entries: Deque[Tuple[float, float]] = field(default_factory=deque)
    total_seconds: float = 0.0


class InMemoryCalculationBudgetTracker(CalculationBudgetTracker):
    """In-process sliding window limiter suitable for single-worker runs."""

    def __init__(self, *, window_seconds: float, budget_seconds: float) -> None:
        self.window_seconds = window_seconds
        self.budget_seconds = budget_seconds
        self._entries: Dict[str, _Window] = {}
        self._lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> CalculationBudget:
        timestamp = time.time() if now is None else now
        with self._lock:
            window = self._entries.get(key)
            if window is None:
                window = _Window()
                self._entries[key] = window
            self._prune(window, timestamp)
            allowed = window.total_seconds < self.budget_seconds
            return allowed, window.total_seconds

    def record(self, key: str, duration_seconds: float, now: float | None = None) -> None:
        duration = max(duration_seconds, 0.0)
        if duration == 0.0:
            return

        timestamp = time.time() if now is None else now
        with self._lock:
            window = self._entries.setdefault(key, _Window())
            self._prune(window, timestamp)
            window.entries.append((timestamp, duration))
            window.total_seconds += duration

    def reset(self) -> None:
        with self._lock:
            self._entries.clear()

    def _prune(self, window: _Window, now: float) -> None:
        cutoff = now - self.window_seconds
        while window.entries and window.entries[0][0] <= cutoff:
            _, duration = window.entries.popleft()
            window.total_seconds -= duration
        if window.total_seconds < 0:
            window.total_seconds = 0.0
        if not window.entries:
            window.total_seconds = 0.0


class RedisCalculationBudgetTracker(CalculationBudgetTracker):
    """Redis-backed sliding window budget shared across workers."""

    def __init__(
        self,
        client: Redis,
        *,
        window_seconds: float,
        budget_seconds: float,
        key_prefix: str = "calc-budget",
    ) -> None:
        self._client = client
        self.window_seconds = window_seconds
        self.budget_seconds = budget_seconds
        self._key_prefix = key_prefix
        self._registry_key = f"{self._key_prefix}::registry"

    def check(self, key: str, now: float | None = None) -> CalculationBudget:
        timestamp = time.time() if now is None else now
        cutoff = timestamp - self.window_seconds
        redis_key = self._make_key(key)

        pipe = self._client.pipeline(transaction=False)
        pipe.zremrangebyscore(redis_key, 0, cutoff)
        pipe.zrange(redis_key, 0, -1)
        try:
            _, entries = pipe.execute()
        except RedisError as exc:
            # Fail open: a Redis blip should not turn requests into 500s.
            _LOGGER.warning("Redis budget check failed (%s); allowing request", exc)
            return True, 0.0

        total = 0.0
        for entry in entries:
            if isinstance(entry, bytes):
                entry = entry.decode()
            duration_str, _, _ = entry.partition(":")
            try:
                total += float(duration_str)
            except ValueError:
                # Ignore corrupt values rather than failing the request.
                continue

        allowed = total < self.budget_seconds
        return allowed, total

    def record(self, key: str, duration_seconds: float, now: float | None = None) -> None:
        duration = max(duration_seconds, 0.0)
        if duration == 0.0:
            return

        timestamp = time.time() if now is None else now
        redis_key = self._make_key(key)
        member = f"{duration:.9f}:{uuid.uuid4().hex}"
        ttl_seconds = int(max(self.window_seconds * 2, 1))

        pipe = self._client.pipeline(transaction=False)
        pipe.zadd(redis_key, {member: timestamp})
        pipe.expire(redis_key, ttl_seconds)
        pipe.sadd(self._registry_key, redis_key)
        # Keep the registry set from growing without bound.
        pipe.expire(self._registry_key, ttl_seconds)
        try:
            pipe.execute()
        except RedisError as exc:
            # record() runs in a finally block; raising here would replace an
            # already-successful response with a 500.
            _LOGGER.warning("Redis budget record failed (%s); sample dropped", exc)

    def reset(self) -> None:
        raw_keys = self._client.smembers(self._registry_key)
        # redis-py async clients return awaitables, but we only support the sync client here.
        keys = cast(Iterable[bytes | str], raw_keys)
        decoded = [key.decode() if isinstance(key, bytes) else key for key in keys]
        if decoded:
            self._client.delete(*decoded)
        self._client.delete(self._registry_key)

    def _make_key(self, key: str) -> str:
        return f"{self._key_prefix}::{key}"


def build_budget_tracker(
    *,
    window_seconds: float,
    budget_seconds: float,
    redis_url: str | None,
    logger: logging.Logger | None = None,
) -> CalculationBudgetTracker:
    """Create a budget tracker, preferring Redis when configured."""

    if redis_url:
        if redis is None:
            if logger:
                logger.warning(
                    "Redis URL configured but redis package is not installed; falling back to in-memory calculation budget"
                )
        else:
            try:
                client = redis.Redis.from_url(redis_url, decode_responses=False)
                client.ping()
            except RedisError as exc:
                if logger:
                    logger.warning(
                        "Unable to connect to Redis at %s (%s); falling back to in-memory calculation budget",
                        redis_url,
                        exc,
                    )
            else:
                return RedisCalculationBudgetTracker(
                    client,
                    window_seconds=window_seconds,
                    budget_seconds=budget_seconds,
                )

    return InMemoryCalculationBudgetTracker(
        window_seconds=window_seconds,
        budget_seconds=budget_seconds,
    )
