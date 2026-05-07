#!/usr/bin/env python3
"""Run frontend and backend test suites with a concise summary."""

from __future__ import annotations

import os
import re
import shlex
import socket
import subprocess
import sys
import time
import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen


@dataclass
class TestJob:
    name: str
    commands: List[Sequence[str]]
    cwd: Path


@dataclass
class JobResult:
    job: TestJob
    exit_code: int
    tests: Optional[int]
    coverage: Optional[str]
    rerun_commands: list[str]


def stream_command(command: Sequence[str], cwd: Path) -> Tuple[int, List[str]]:
    """Execute a command, streaming combined output to stdout."""
    env = os.environ.copy()
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
    except FileNotFoundError as exc:
        print(f"Command not found: {command[0]}")
        print(exc)
        return 127, []

    assert process.stdout is not None  # for type checkers
    output_lines: List[str] = []
    for line in process.stdout:
        print(line, end="")
        output_lines.append(line)

    return process.wait(), output_lines


def print_header(title: str) -> None:
    bar = "=" * len(title)
    print(f"\n{title}\n{bar}")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Rawbit test suites with summary output.")
    parser.add_argument(
        "--e2e-browsers",
        choices=["chromium", "all"],
        default="chromium",
        help=(
            "Select which Playwright projects to run when no custom E2E command is provided. "
            "Use 'chromium' for the fast default run or 'all' for chromium, firefox, and webkit sequentially."
        ),
    )
    parser.add_argument(
        "--e2e-workers",
        default=os.getenv("RUN_ALL_TESTS_E2E_WORKERS", "4"),
        help=(
            "Number of Playwright workers for each E2E project. "
            "Defaults to RUN_ALL_TESTS_E2E_WORKERS or 4."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parent

    # Keep the local gate truly local unless callers override explicitly.
    # Playwright reads PLAYWRIGHT_* and the frontend respects VITE_* envs, so
    # we set localhost defaults here while still allowing env overrides above.
    if "PLAYWRIGHT_BASE_URL" not in os.environ:
        run_all_base_url = os.getenv("RUN_ALL_TESTS_BASE_URL")
        if run_all_base_url:
            os.environ["PLAYWRIGHT_BASE_URL"] = run_all_base_url
        else:
            os.environ["PLAYWRIGHT_BASE_URL"] = (
                f"http://127.0.0.1:{find_available_port()}"
            )
    os.environ.setdefault("PLAYWRIGHT_REUSE_EXISTING_SERVER", "0")
    if "PLAYWRIGHT_API_URL" not in os.environ:
        run_all_api_url = os.getenv("RUN_ALL_TESTS_API_URL")
        if run_all_api_url:
            os.environ["PLAYWRIGHT_API_URL"] = run_all_api_url
        else:
            os.environ["PLAYWRIGHT_API_URL"] = (
                f"http://localhost:{find_available_port(start=5007)}"
            )
    os.environ.setdefault("PORT", str(urlparse(os.environ["PLAYWRIGHT_API_URL"]).port or 5007))
    os.environ.setdefault("RAWBIT_CALCULATION_BUDGET_SECONDS", "120")
    os.environ.setdefault(
        "CORS_ORIGINS",
        ",".join(
            dict.fromkeys(
                [
                    "https://rawbit.io",
                    "https://www.rawbit.io",
                    "http://localhost:3041",
                    "http://127.0.0.1:3041",
                    origin_from_url(os.environ["PLAYWRIGHT_BASE_URL"]),
                ]
            )
        ),
    )

    backend_proc = None
    try:
        try:
            backend_proc = maybe_start_local_backend(repo_root)
        except RuntimeError as exc:
            print(f"Failed to start local backend: {exc}")
            sys.exit(1)
        lint_cmd = os.environ.get("RUN_ALL_TESTS_LINT_CMD")
        typecheck_cmd = os.environ.get("RUN_ALL_TESTS_TYPECHECK_CMD")
        frontend_cmd = os.environ.get("RUN_ALL_TESTS_FRONTEND_CMD")
        e2e_cmd = os.environ.get("RUN_ALL_TESTS_E2E_CMD")
        backend_cmd = os.environ.get("RUN_ALL_TESTS_BACKEND_CMD")

        def resolve_backend_command() -> Tuple[Sequence[str], Path]:
            backend_dir = repo_root / "backend"

            if backend_cmd:
                return shlex.split(backend_cmd), backend_dir

            venv_pytest = repo_root / ".myenv" / "bin" / "pytest"
            if venv_pytest.exists():
                return [str(venv_pytest), "backend/tests"], repo_root

            return [sys.executable, "-m", "pytest"], backend_dir

        backend_command, backend_cwd = resolve_backend_command()

        def resolve_e2e_commands() -> List[Sequence[str]]:
            if e2e_cmd:
                return [shlex.split(e2e_cmd)]

            workers_arg = f"--workers={args.e2e_workers}"
            if args.e2e_browsers == "all":
                return [
                    ["npm", "run", "test:e2e", "--", "--project=chromium", workers_arg],
                    ["npm", "run", "test:e2e", "--", "--project=firefox", workers_arg],
                    ["npm", "run", "test:e2e", "--", "--project=webkit", workers_arg],
                ]

            return [["npm", "run", "test:e2e", "--", "--project=chromium", workers_arg]]

        jobs = [
            TestJob(
                name="Lint",
                commands=[shlex.split(lint_cmd)] if lint_cmd else [["npm", "run", "lint"]],
                cwd=repo_root,
            ),
            TestJob(
                name="Typecheck",
                commands=[shlex.split(typecheck_cmd)] if typecheck_cmd else [["npm", "run", "typecheck"]],
                cwd=repo_root,
            ),
            TestJob(
                name="Frontend",
                commands=[shlex.split(frontend_cmd) if frontend_cmd else ["npm", "run", "test"]],
                cwd=repo_root,
            ),
            TestJob(
                name="E2E",
                commands=resolve_e2e_commands(),
                cwd=repo_root,
            ),
            TestJob(name="Backend", commands=[backend_command], cwd=backend_cwd),
        ]

        results: list[JobResult] = []

        for job in jobs:
            title = f"Running {job.name} Tests"
            print_header(title)
            accumulated_output: List[str] = []
            exit_code = 0

            for index, command in enumerate(job.commands, start=1):
                prefix = f" ({index}/{len(job.commands)})" if len(job.commands) > 1 else ""
                print(f"Command{prefix}: {shlex.join(command)}")
                exit_code, output_lines = stream_command(command, job.cwd)
                accumulated_output.extend(output_lines)
                if exit_code != 0:
                    if index < len(job.commands):
                        print("Command failed; skipping remaining commands for job.")
                    break

            tests_count, coverage, reruns = parse_job_output(job.name, accumulated_output)
            results.append(JobResult(job, exit_code, tests_count, coverage, reruns))
            status = "PASS" if exit_code == 0 else "FAIL"
            print(f"\n{job.name} result: {status}\n")

        print_header("Test Summary")
        any_failures = False
        rerun_suggestions: list[str] = []
        for result in results:
            status = "PASS" if result.exit_code == 0 else "FAIL"
            detail_parts = []
            if result.tests is not None:
                detail_parts.append(f"tests: {result.tests}")
            if result.coverage is not None:
                detail_parts.append(f"coverage: {result.coverage}")
            details = f" ({', '.join(detail_parts)})" if detail_parts else ""
            print(f"{result.job.name:9s}: {status}{details}")
            if result.exit_code != 0:
                any_failures = True
                rerun_suggestions.extend(result.rerun_commands)

        if rerun_suggestions:
            print("\nSuggested rerun commands:")
            for command in rerun_suggestions:
                print(f"  {command}")
            if backend_is_local():
                print("  (start the local backend first, e.g. '.myenv/bin/python backend/routes.py')")

        if any_failures:
            sys.exit(1)

    finally:
        if backend_proc:
            stop_process(backend_proc)


def parse_job_output(job_name: str, lines: Sequence[str]) -> Tuple[Optional[int], Optional[str], list[str]]:
    if job_name == "Frontend":
        tests, coverage = parse_frontend_output(lines)
        return tests, coverage, []
    if job_name == "E2E":
        return parse_e2e_output(lines)
    if job_name == "Backend":
        tests, coverage = parse_backend_output(lines)
        return tests, coverage, []
    return None, None, []


def parse_frontend_output(lines: Sequence[str]) -> Tuple[Optional[int], Optional[str]]:
    tests: Optional[int] = None
    coverage: Optional[str] = None

    for line in lines:
        match = re.search(r"Tests\s+(\d+)\s+passed", line)
        if match:
            tests = int(match.group(1))

    coverage = extract_coverage_percentage(lines)

    return tests, coverage


def parse_backend_output(lines: Sequence[str]) -> Tuple[Optional[int], Optional[str]]:
    tests: Optional[int] = None

    for line in reversed(lines):
        match = re.search(r"(\d+)\s+passed\s+in\s", line)
        if match:
            tests = int(match.group(1))
            break

    if tests is None:
        for line in reversed(lines):
            match = re.search(r"collected\s+(\d+)\s+items", line)
            if match:
                tests = int(match.group(1))
                break

    coverage = extract_coverage_percentage(lines)

    return tests, coverage


def parse_e2e_output(lines: Sequence[str]) -> Tuple[Optional[int], Optional[str], list[str]]:
    tests_total = 0

    for line in lines:
        for match in re.finditer(r"Running\s+(\d+)\s+tests", line):
            tests_total += int(match.group(1))

    if tests_total == 0:
        for line in lines:
            for match in re.finditer(r"(\d+)\s+(?:tests?\s+)?passed", line):
                tests_total += int(match.group(1))

    reruns: list[str] = []
    failure_pattern = re.compile(r"[✘×]\s+\d+\s+\[([^\]]+)\]\s+›\s+([^\s:]+)")
    seen: set[tuple[str, str]] = set()
    for line in lines:
        match = failure_pattern.search(line)
        if not match:
            continue
        project = match.group(1).strip()
        spec = match.group(2).strip().split(":", 1)[0]
        key = (project, spec)
        if key in seen:
            continue
        seen.add(key)
        reruns.append(f"npm run test:e2e -- --project={project} {spec}")

    tests_value = tests_total if tests_total else None
    return tests_value, None, reruns


def extract_coverage_percentage(lines: Sequence[str]) -> Optional[str]:
    for line in reversed(lines):
        match = re.search(r"Total coverage:\s*([0-9]+(?:\.[0-9]+)?)%", line)
        if match:
            return f"{match.group(1)}%"

    for line in reversed(lines):
        match = re.search(r"TOTAL.*?([0-9]+(?:\.[0-9]+)?)%", line)
        if match:
            return f"{match.group(1)}%"

    return None



def backend_health_url() -> str:
    base = os.environ.get("PLAYWRIGHT_API_URL", "http://localhost:5007").rstrip('/')
    return f"{base}/healthz"


def find_available_port(
    host: str = "127.0.0.1", start: int = 3041, attempts: int = 100
) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def origin_from_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"



def backend_is_local() -> bool:
    parsed = urlparse(os.environ.get("PLAYWRIGHT_API_URL", "http://localhost:5007"))
    return parsed.hostname in {"localhost", "127.0.0.1"}



def wait_for_backend(url: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=2) as resp:  # nosec B310
                if resp.status == 200:
                    return
        except URLError:
            time.sleep(0.5)
    raise RuntimeError(f"Backend did not become healthy at {url} within {timeout:.0f}s")



def maybe_start_local_backend(repo_root: Path):
    if not backend_is_local():
        return None

    health_url = backend_health_url()
    try:
        wait_for_backend(health_url, timeout=0.01)
        return None
    except RuntimeError:
        pass

    if os.environ.get("RUN_ALL_TESTS_SKIP_BACKEND") in {"1", "true", "TRUE"}:
        raise RuntimeError("Local backend not running and autostart disabled (RUN_ALL_TESTS_SKIP_BACKEND)")

    cmd = [select_backend_python(repo_root), "backend/routes.py"]
    proc = subprocess.Popen(
        cmd,
        cwd=repo_root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_backend(health_url)
        return proc
    except RuntimeError:
        stop_process(proc)
        raise



def stop_process(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()



def select_backend_python(repo_root: Path) -> str:
    candidate = repo_root / '.myenv' / 'bin' / 'python'
    if candidate.exists():
        return str(candidate)
    return sys.executable

if __name__ == "__main__":
    main()
