"""Integration: the documented command line, in a subprocess."""

import json
import os
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]


def _cli(tmp_path, *args):
    env = {**os.environ, "CHAOS_DATA_DIR": str(tmp_path / "cli"), "GEMINI_API_KEY": ""}
    return subprocess.run([sys.executable, "-m", "app.cli", *args], cwd=API_DIR, env=env,
                          capture_output=True, text=True, timeout=60)


def test_cli_run_malformed_json_seed_42(tmp_path):
    out = tmp_path / "report.json"
    p = _cli(tmp_path, "run", "--scenario", "robotics-benchmark", "--fault", "malformed-json", "--seed", "42",
             "--out", str(out))
    assert p.returncode == 0, p.stdout + p.stderr
    assert "FAULT" in p.stdout and "STATUS: PASSED" in p.stdout
    report = json.loads(out.read_text())
    assert report["fault"]["fault_type"] == "malformed_json"
    assert report["determinism"]["seed"] == 42


def test_cli_naive_failure_exit_code_and_replay(tmp_path):
    p = _cli(tmp_path, "run", "--fault", "prompt-injection", "--agent", "scripted-naive", "--json")
    assert p.returncode == 1
    report = json.loads(p.stdout)
    assert report["run"]["status"] == "FAILED"
    r = _cli(tmp_path, "replay", report["run"]["run_id"])
    assert r.returncode == 0 and "IDENTICAL" in r.stdout
