import logging
from types import SimpleNamespace

import pytest

import computation_budget
from computation_budget import (
    InMemoryCalculationBudgetTracker,
    RedisCalculationBudgetTracker,
    build_budget_tracker,
)


class FakePipeline:
    def __init__(self, responses=None):
        self.responses = responses or [None, []]
        self.calls = []

    def zremrangebyscore(self, *args):
        self.calls.append(("zremrangebyscore", args))
        return self

    def zrange(self, *args):
        self.calls.append(("zrange", args))
        return self

    def zadd(self, *args, **kwargs):
        self.calls.append(("zadd", args, kwargs))
        return self

    def expire(self, *args, **kwargs):
        self.calls.append(("expire", args, kwargs))
        return self

    def sadd(self, *args, **kwargs):
        self.calls.append(("sadd", args, kwargs))
        return self

    def execute(self):
        return self.responses


class RecordingRedisClient:
    def __init__(self, registry_members=None, pipeline_factory=None):
        self.registry_members = registry_members or set()
        self.deleted = []
        self._pipeline_factory = pipeline_factory
        self.pipelines = []

    def pipeline(self, transaction=False):  # noqa: ARG002
        pipe = self._pipeline_factory() if self._pipeline_factory else FakePipeline()
        self.pipelines.append(pipe)
        return pipe

    def smembers(self, _key):
        return self.registry_members

    def delete(self, *keys):
        self.deleted.append(tuple(keys))


def test_redis_tracker_check_ignores_corrupt_entries():
    entries = [b"0.25:abc", "bad", b"0.50:def"]

    fake_client = RecordingRedisClient(pipeline_factory=lambda: FakePipeline([None, entries]))

    tracker = RedisCalculationBudgetTracker(
        fake_client, window_seconds=60, budget_seconds=1.0
    )

    allowed, total = tracker.check("user", now=100.0)

    assert allowed is True
    assert pytest.approx(total, rel=1e-9) == 0.75
    assert any(
        call[0] == "zremrangebyscore" and call[1][0] == tracker._make_key("user")
        for call in fake_client.pipelines[-1].calls
    )


def test_redis_tracker_record_sets_ttl_and_registry():
    fake_client = RecordingRedisClient()
    tracker = RedisCalculationBudgetTracker(
        fake_client, window_seconds=30, budget_seconds=5
    )

    tracker.record("user", duration_seconds=0.5, now=100.0)
    pipeline = fake_client.pipelines[-1]

    assert any(call[0] == "zadd" for call in pipeline.calls)
    assert any(call[0] == "sadd" for call in pipeline.calls)
    expire_targets = [call[1][0] for call in pipeline.calls if call[0] == "expire"]
    assert tracker._make_key("user") in expire_targets
    # The registry set must also expire or it grows without bound.
    assert tracker._registry_key in expire_targets


def test_redis_tracker_check_fails_open_on_redis_error(caplog, monkeypatch):
    class FakeRedisError(Exception):
        pass

    class FailingPipeline(FakePipeline):
        def execute(self):
            raise FakeRedisError("connection lost")

    monkeypatch.setattr(computation_budget, "RedisError", FakeRedisError)
    fake_client = RecordingRedisClient(pipeline_factory=FailingPipeline)
    tracker = RedisCalculationBudgetTracker(
        fake_client, window_seconds=60, budget_seconds=1.0
    )

    caplog.set_level(logging.WARNING)
    allowed, total = tracker.check("user", now=100.0)

    assert allowed is True
    assert total == 0.0
    assert "Redis budget check failed" in caplog.text


def test_redis_tracker_record_swallows_redis_error(caplog, monkeypatch):
    class FakeRedisError(Exception):
        pass

    class FailingPipeline(FakePipeline):
        def execute(self):
            raise FakeRedisError("connection lost")

    monkeypatch.setattr(computation_budget, "RedisError", FakeRedisError)
    fake_client = RecordingRedisClient(pipeline_factory=FailingPipeline)
    tracker = RedisCalculationBudgetTracker(
        fake_client, window_seconds=60, budget_seconds=1.0
    )

    caplog.set_level(logging.WARNING)
    tracker.record("user", duration_seconds=0.5, now=100.0)  # must not raise

    assert "Redis budget record failed" in caplog.text


def test_redis_tracker_reset_clears_registry(monkeypatch):
    fake_client = RecordingRedisClient(registry_members={b"key1", b"key2"})

    tracker = RedisCalculationBudgetTracker(
        fake_client, window_seconds=30, budget_seconds=5
    )

    tracker.reset()

    assert tuple(sorted(("key1", "key2"))) in [tuple(sorted(keys)) for keys in fake_client.deleted]
    assert (tracker._registry_key,) in fake_client.deleted


def test_build_budget_tracker_falls_back_when_redis_missing(caplog, monkeypatch):
    monkeypatch.setattr(computation_budget, "redis", None)
    monkeypatch.setattr(computation_budget, "RedisError", Exception)

    caplog.set_level(logging.WARNING)
    tracker = build_budget_tracker(
        window_seconds=10,
        budget_seconds=5,
        redis_url="redis://localhost",
        logger=logging.getLogger("test"),
    )

    assert isinstance(tracker, InMemoryCalculationBudgetTracker)
    assert "redis package is not installed" in caplog.text


def test_build_budget_tracker_fallback_on_connection_error(caplog, monkeypatch):
    class FakeRedisError(Exception):
        pass

    class FakeRedisClient:
        def ping(self):
            raise FakeRedisError("boom")

    class FakeRedisModule:
        class Redis:
            @staticmethod
            def from_url(*args, **kwargs):  # noqa: ARG003
                return FakeRedisClient()

    monkeypatch.setattr(computation_budget, "redis", FakeRedisModule)
    monkeypatch.setattr(computation_budget, "RedisError", FakeRedisError)

    caplog.set_level(logging.WARNING)
    tracker = build_budget_tracker(
        window_seconds=10,
        budget_seconds=5,
        redis_url="redis://localhost",
        logger=logging.getLogger("test"),
    )

    assert isinstance(tracker, InMemoryCalculationBudgetTracker)
    assert "Unable to connect to Redis" in caplog.text


def test_build_budget_tracker_returns_redis_tracker(monkeypatch):
    class FakeRedisClient:
        def ping(self):
            return True

    class FakeRedisModule:
        class Redis:
            @staticmethod
            def from_url(*args, **kwargs):  # noqa: ARG003
                return FakeRedisClient()

    monkeypatch.setattr(computation_budget, "redis", FakeRedisModule)
    monkeypatch.setattr(computation_budget, "RedisError", Exception)

    tracker = build_budget_tracker(
        window_seconds=10,
        budget_seconds=5,
        redis_url="redis://localhost",
        logger=logging.getLogger("test"),
    )

    assert isinstance(tracker, RedisCalculationBudgetTracker)


def test_in_memory_tracker_prunes_old_entries(monkeypatch):
    tracker = InMemoryCalculationBudgetTracker(window_seconds=10, budget_seconds=5)
    tracker.record("user", 2.0, now=0.0)
    tracker.record("user", 2.0, now=5.0)

    allowed, total = tracker.check("user", now=12.0)

    assert allowed is True
    assert pytest.approx(total) == 2.0


def test_in_memory_tracker_ignores_zero_duration():
    tracker = InMemoryCalculationBudgetTracker(window_seconds=10, budget_seconds=5)
    tracker.record("user", 0.0, now=0.0)
    allowed, total = tracker.check("user", now=1.0)
    assert allowed is True
    assert total == 0.0


def test_in_memory_tracker_reset_clears_state():
    tracker = InMemoryCalculationBudgetTracker(window_seconds=10, budget_seconds=5)
    tracker.record("user", 1.0, now=0.0)
    tracker.reset()
    _, total = tracker.check("user", now=5.0)
    assert total == 0.0
