"""Runtime configuration helpers for the Rawbit backend."""

from __future__ import annotations

import os


def _load_positive_float(env_name: str, default: float) -> float:
    """Parse a positive float from the environment or fall back to the default."""

    raw = os.getenv(env_name)
    if raw is None:
        return default

    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(
            f"Environment variable {env_name} must be a positive number"
        ) from exc

    if value <= 0:
        raise ValueError(
            f"Environment variable {env_name} must be a positive number"
        )

    return value

CALCULATION_TIMEOUT_NODE_ID = "__calculation_timeout__"

_CALC_TIMEOUT_ENV = "RAWBIT_CALCULATION_TIMEOUT_SECONDS"
_DEFAULT_CALC_TIMEOUT_SECONDS = 5.0
_CALC_BUDGET_ENV = "RAWBIT_CALCULATION_BUDGET_SECONDS"
_DEFAULT_CALC_BUDGET_SECONDS = 10.0
_CALC_WINDOW_ENV = "RAWBIT_CALCULATION_WINDOW_SECONDS"
_DEFAULT_CALC_WINDOW_SECONDS = 60.0
_REDIS_URL_ENV = "RAWBIT_REDIS_URL"
_TRUSTED_PROXY_CIDRS_ENV = "RAWBIT_TRUSTED_PROXY_CIDRS"
APP_VERSION = os.getenv("RAWBIT_APP_VERSION") or os.getenv("GIT_COMMIT") or "dev"


def _load_calculation_timeout_seconds() -> float:
    return _load_positive_float(_CALC_TIMEOUT_ENV, _DEFAULT_CALC_TIMEOUT_SECONDS)


CALCULATION_TIMEOUT_SECONDS = _load_calculation_timeout_seconds()
CALCULATION_TIME_BUDGET_SECONDS = _load_positive_float(
    _CALC_BUDGET_ENV, _DEFAULT_CALC_BUDGET_SECONDS
)
CALCULATION_TIME_WINDOW_SECONDS = _load_positive_float(
    _CALC_WINDOW_ENV, _DEFAULT_CALC_WINDOW_SECONDS
)


def redis_url() -> str | None:
    """Return the optional Redis connection URL used for shared limits."""

    return os.getenv(_REDIS_URL_ENV)


def trusted_proxy_cidrs() -> tuple[str, ...]:
    """Return CIDR ranges whose forwarded client headers may be trusted."""

    raw = os.getenv(_TRUSTED_PROXY_CIDRS_ENV, "")
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def public_limits() -> dict[str, float]:
    """Expose the limits payload consumed by /healthz."""
    return {
        "calculationTimeoutSeconds": CALCULATION_TIMEOUT_SECONDS,
        "calculationTimeBudgetSeconds": CALCULATION_TIME_BUDGET_SECONDS,
        "calculationTimeWindowSeconds": CALCULATION_TIME_WINDOW_SECONDS,
    }
