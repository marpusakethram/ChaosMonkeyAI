"""Integration: the HTTP flow the UI uses, end to end against the real orchestrator."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _wait(client, run_id, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/v1/runs/{run_id}").json()
        if run["status"] in ("PASSED", "FAILED", "ERROR", "CANCELLED"):
            return run
        time.sleep(0.1)
    raise AssertionError("run did not finish")


def test_baseline_then_malformed_json_compare_and_download(client):
    assert client.get("/api/v1/health").json()["mode"] == "offline-fixtures"
    base = client.post("/api/v1/runs/baseline", json={"agent": {"adapter": "scripted-robust"}}).json()
    assert _wait(client, base["run_id"])["status"] == "PASSED"

    chaos = client.post("/api/v1/runs/chaos", json={
        "agent": {"adapter": "scripted-naive"}, "baseline_run_id": base["run_id"],
        "fault": {"fault_type": "malformed_json"},
    }).json()
    final = _wait(client, chaos["run_id"])
    assert final["status"] == "FAILED" and final["failure_origin"] == "agent"

    events = client.get(f"/api/v1/runs/{chaos['run_id']}/events").json()
    faulted = [e for e in events if e["phase"] == "fault_injected"]
    assert faulted and faulted[0]["tool_name"] == "get_benchmark"
    later = client.get(f"/api/v1/runs/{chaos['run_id']}/events", params={"after": faulted[0]["sequence"]}).json()
    assert all(e["sequence"] > faulted[0]["sequence"] for e in later)

    report = client.get(f"/api/v1/runs/{chaos['run_id']}/report").json()
    assert report["comparison"]["baseline_run_id"] == base["run_id"]
    assert "malformed_data_not_used" in report["root_cause"]["failed_assertions"]
    assert report["recovery_suggestions"]

    dl = client.get(f"/api/v1/runs/{chaos['run_id']}/report", params={"download": "true"})
    assert dl.headers["content-disposition"].startswith("attachment")
    assert json.loads(dl.content)["run"]["run_id"] == chaos["run_id"]


def test_chaos_without_baseline_creates_one(client):
    chaos = client.post("/api/v1/runs/chaos", json={"fault": {"fault_type": "timeout"}}).json()
    assert chaos["baseline_run_id"]
    final = _wait(client, chaos["run_id"])
    assert final["status"] == "PASSED"
    rep = client.get(f"/api/v1/runs/{chaos['run_id']}/report").json()
    assert rep["comparison"]["recovery_outcome"] == "recovered"


@pytest.mark.parametrize("body", [
    {"fault": {"fault_type": "rm_rf"}},
    {"fault": {"fault_type": "timeout", "occurrence": 999}},
    {"fault": {"fault_type": "timeout", "max_injections": 50}},
    {"fault": {"fault_type": "timeout", "payload_ref": "../../etc/passwd"}},
    {"fault": {"fault_type": "timeout", "code": "import os"}},
    {"fault": {"fault_type": "timeout"}, "agent": {"adapter": "https://evil.example/agent.py"}},
    {"fault": {"fault_type": "timeout"}, "python": "print(1)"},
])
def test_rejects_invalid_or_arbitrary_input(client, body):
    assert client.post("/api/v1/runs/chaos", json=body).status_code == 422


def test_catalog_endpoints(client):
    faults = client.get("/api/v1/faults").json()
    assert {f["fault_type"] for f in faults} == {"http_429", "malformed_json", "timeout", "conflicting_sources", "prompt_injection"}
    agents = client.get("/api/v1/agents").json()
    gem = next(a for a in agents if a["name"] == "gemini")
    assert gem["available"] is False
    assert client.get("/api/v1/runs/nope").status_code == 404


def test_replay_endpoint(client):
    base = client.post("/api/v1/runs/baseline", json={}).json()
    _wait(client, base["run_id"])
    rp = client.post(f"/api/v1/runs/{base['run_id']}/replay").json()
    done = _wait(client, rp["run_id"])
    assert done["signature"] == client.get(f"/api/v1/runs/{base['run_id']}").json()["signature"]
