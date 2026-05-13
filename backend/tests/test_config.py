import importlib
import os

import pytest

import backend.config as config_module

CALC_ENV_VARS = {
    "RAWBIT_CALCULATION_TIMEOUT_SECONDS",
    "RAWBIT_CALCULATION_BUDGET_SECONDS",
    "RAWBIT_CALCULATION_WINDOW_SECONDS",
    "RAWBIT_REDIS_URL",
    "RAWBIT_TRUSTED_PROXY_CIDRS",
}


def reload_config(monkeypatch, **env):
    for key in CALC_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, str(value))
    return importlib.reload(config_module)


def restore_config(monkeypatch):
    for key in CALC_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    importlib.reload(config_module)


@pytest.fixture(autouse=True)
def reset_config(monkeypatch):
    yield
    restore_config(monkeypatch)


def test_load_positive_float_rejects_invalid(monkeypatch):
    monkeypatch.setenv("RAWBIT_TEST_VALUE", "abc")
    with pytest.raises(ValueError):
        config_module._load_positive_float("RAWBIT_TEST_VALUE", 1.0)


def test_load_positive_float_rejects_non_positive(monkeypatch):
    monkeypatch.setenv("RAWBIT_TEST_VALUE", "0")
    with pytest.raises(ValueError):
        config_module._load_positive_float("RAWBIT_TEST_VALUE", 1.0)


def test_public_limits_reflect_env_overrides(monkeypatch):
    module = reload_config(
        monkeypatch,
        RAWBIT_CALCULATION_TIMEOUT_SECONDS="3.5",
        RAWBIT_CALCULATION_BUDGET_SECONDS="4.0",
        RAWBIT_CALCULATION_WINDOW_SECONDS="12",
    )
    limits = module.public_limits()
    assert limits == {
        "calculationTimeoutSeconds": pytest.approx(3.5),
        "calculationTimeBudgetSeconds": pytest.approx(4.0),
        "calculationTimeWindowSeconds": pytest.approx(12.0),
    }


def test_redis_url_reads_from_env(monkeypatch):
    module = reload_config(monkeypatch, RAWBIT_REDIS_URL="redis://localhost:6379/0")
    assert module.redis_url() == "redis://localhost:6379/0"


def test_trusted_proxy_cidrs_reads_comma_separated_env(monkeypatch):
    module = reload_config(
        monkeypatch,
        RAWBIT_TRUSTED_PROXY_CIDRS="173.245.48.0/20, 2606:4700::/32,,",
    )
    assert module.trusted_proxy_cidrs() == ("173.245.48.0/20", "2606:4700::/32")
