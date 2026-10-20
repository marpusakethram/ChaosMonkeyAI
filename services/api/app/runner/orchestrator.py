"""Run lifecycle: create -> RUNNING -> PASSED | FAILED | ERROR | CANCELLED.

FAILED means the *agent* failed (assertion FAIL/UNKNOWN, crash, budget). ERROR means the *harness*
failed (our bug, replay divergence, model provider unavailable) and the run says nothing about the agent.
"""

from __future__ import annotations

import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app import db
from app.agents.adapter import AgentAdapter, available_adapters
from app.ai.gemini import ProviderUnavailable
from app.config import get_settings
from app.faults.base import resolve
from app.models import (
    TERMINAL_STATUSES,
    AgentConfig,
    FaultConfig,
    Run,
    RunKind,
    RunResult,
    RunStatus,
    utcnow,
)
from app.runner import assertions as A
from app.runner.gateway import (
    BudgetExceeded,
    FixtureBackend,
    HarnessError,
    ReplayBackend,
    RunCancelled,
    ToolGateway,
    recorded_upstreams,
)
from app.runner.trace import TraceWriter, compute_signature, read_events
from app.scenarios import get_scenario
from app.tools.research_tools import load_dataset


class RunRejected(Exception):
    """Request was valid JSON but cannot be run (unknown adapter, capacity, bad fault target)."""


class Orchestrator:
    def __init__(self) -> None:
        self._cancel: dict[str, threading.Event] = {}
        self._active: set[str] = set()
        self._lock = threading.Lock()
        self._pool: ThreadPoolExecutor | None = None

    # ---- creation ----------------------------------------------------------------------------

    def create_run(
        self,
        *,
        kind: RunKind,
        scenario_id: str,
        agent: AgentConfig,
        fault: FaultConfig | None = None,
        seed: int = 42,
        baseline_run_id: str | None = None,
        replay_of: str | None = None,
    ) -> Run:
        adapters = available_adapters()
        if agent.adapter not in adapters:
            raise RunRejected(f"adapter '{agent.adapter}' is not available; choose from {sorted(adapters)}")
        try:
            task = get_scenario(scenario_id)
        except KeyError as exc:
            raise RunRejected(str(exc)) from exc
        resolved = None
        if fault is not None:
            try:
                resolved = resolve(fault)
            except ValueError as exc:
                raise RunRejected(str(exc)) from exc
        run = Run(
            kind=kind.value,
            scenario_id=scenario_id,
            agent_adapter=agent.adapter,
            agent_mode=adapters[agent.adapter].mode,
            fault_config=resolved.as_dict() if resolved else None,
            agent_config=agent.model_dump(),
            seed=seed,
            fixture_version=task.fixture_version,
            baseline_run_id=baseline_run_id,
            replay_of=replay_of,
        )
        run.trace_id = run.run_id
        return db.save_run(run)

    def create_replay(self, original_id: str) -> Run:
        original = db.get_run(original_id)
        if original is None:
            raise RunRejected(f"run {original_id} not found")
        if original.status not in (RunStatus.PASSED.value, RunStatus.FAILED.value):
            raise RunRejected("only completed PASSED/FAILED runs can be replayed")
        if original.agent_mode != "offline":
            raise RunRejected("live-model runs cannot be replayed deterministically; replay offline adapters only")
        fault = FaultConfig.model_validate(_fault_input(original.fault_config)) if original.fault_config else None
        return self.create_run(
            kind=RunKind.REPLAY, scenario_id=original.scenario_id, agent=AgentConfig(**original.agent_config),
            fault=fault, seed=original.seed, baseline_run_id=original.baseline_run_id, replay_of=original.run_id,
        )

    # ---- execution ---------------------------------------------------------------------------

    def submit(self, run_id: str) -> None:
        settings = get_settings()
        with self._lock:
            if len(self._active) >= settings.max_concurrent_runs:
                db.update_run(run_id, status=RunStatus.CANCELLED.value, status_reason="rejected: too many active runs",
                              completed_at=utcnow())
                raise RunRejected(f"too many active runs (limit {settings.max_concurrent_runs}); try again shortly")
            self._active.add(run_id)
            if self._pool is None:
                self._pool = ThreadPoolExecutor(max_workers=settings.max_concurrent_runs, thread_name_prefix="run")
        self._cancel.setdefault(run_id, threading.Event())
        self._pool.submit(self._execute_guarded, run_id)

    def _execute_guarded(self, run_id: str) -> None:
        try:
            self.execute(run_id)
        finally:
            with self._lock:
                self._active.discard(run_id)
            self._cancel.pop(run_id, None)

    def cancel(self, run_id: str) -> Run:
        run = db.get_run(run_id)
        if run is None:
            raise KeyError(run_id)
        if RunStatus(run.status) in TERMINAL_STATUSES:
            return run
        self._cancel.setdefault(run_id, threading.Event()).set()
        if run.status == RunStatus.CREATED.value:
            return db.update_run(run_id, status=RunStatus.CANCELLED.value, status_reason="cancelled before start",
                                 completed_at=utcnow())
        return run

    def execute(self, run_id: str) -> Run:
        """Run synchronously. Never raises for agent problems; returns the final Run row."""
        settings = get_settings()
        run = db.get_run(run_id)
        if run is None:
            raise KeyError(run_id)
        cancel_event = self._cancel.setdefault(run_id, threading.Event())
        if cancel_event.is_set() or run.status != RunStatus.CREATED.value:
            return run

        trace = TraceWriter(run_id)
        started = time.monotonic()
        run = db.update_run(run_id, status=RunStatus.RUNNING.value, started_at=utcnow())
        gateway: ToolGateway | None = None
        result: RunResult | None = None
        budget_hit: str | None = None
        try:
            task = get_scenario(run.scenario_id)
            adapter: AgentAdapter = available_adapters()[run.agent_adapter]
            agent_cfg = AgentConfig(**run.agent_config)
            resolved = resolve(FaultConfig.model_validate(_fault_input(run.fault_config))) if run.fault_config else None
            if run.replay_of:
                backend: Any = ReplayBackend(recorded_upstreams(read_events(run.replay_of)))
            else:
                backend = FixtureBackend(run.seed)
            trace.emit("run_started", f"{run.kind} run of {run.scenario_id} with {run.agent_adapter} ({run.agent_mode})",
                       data={
                           "kind": run.kind, "scenario_id": run.scenario_id, "fixture_version": run.fixture_version,
                           "seed": run.seed, "agent": run.agent_config, "mode": run.agent_mode,
                           "fault_config": run.fault_config, "replay_of": run.replay_of,
                           "budgets": {
                               "max_tool_calls": settings.max_tool_calls, "max_agent_steps": settings.max_agent_steps,
                               "max_run_seconds": settings.max_run_seconds,
                               "max_gemini_requests_per_run": settings.max_gemini_requests_per_run,
                               "max_retries_per_call": settings.max_retries_per_call,
                               "tool_timeout_ms": settings.tool_timeout_ms,
                           },
                       })
            gateway = ToolGateway(
                run_id=run_id, trace=trace, settings=settings, backend=backend, fault=resolved,
                cancel_event=cancel_event, deadline=started + settings.max_run_seconds,
            )
            gateway.seed = run.seed
            result = self._run_adapter(adapter, task, gateway, agent_cfg, cancel_event, settings.max_run_seconds)
        except RunCancelled:
            return self._finish(run_id, trace, RunStatus.CANCELLED, None, "cancelled by user", started, gateway)
        except BudgetExceeded as exc:
            budget_hit = str(exc)
            result = RunResult(agent_error=f"budget exceeded: {exc}")
        except (HarnessError, ProviderUnavailable) as exc:
            trace.emit("harness_error", str(exc), exception_type=type(exc).__name__)
            return self._finish(run_id, trace, RunStatus.ERROR, "harness", str(exc), started, gateway)
        except _AgentCrash as exc:
            trace.emit("agent_crashed", f"agent raised {exc.inner}", exception_type=exc.inner_type)
            result = RunResult(agent_error=f"agent crashed: {exc.inner_type}: {exc.inner}")
        except Exception as exc:  # anything else outside the adapter is our fault
            trace.emit("harness_error", f"{type(exc).__name__}: {exc}", exception_type=type(exc).__name__,
                       data={"traceback": traceback.format_exc()[-1500:]})
            return self._finish(run_id, trace, RunStatus.ERROR, "harness", f"{type(exc).__name__}: {exc}", started, gateway)

        try:
            return self._judge(run_id, trace, result, budget_hit, started, gateway)
        except Exception as exc:
            trace.emit("harness_error", f"assertion evaluation failed: {exc}", exception_type=type(exc).__name__)
            return self._finish(run_id, trace, RunStatus.ERROR, "harness", f"assertion evaluation failed: {exc}",
                                started, gateway)

    def _run_adapter(self, adapter, task, gateway, cfg, cancel_event, max_seconds) -> RunResult:
        """Run the adapter in a watchdog thread so a stuck agent cannot hang the run."""
        box: dict[str, Any] = {}

        def target() -> None:
            try:
                box["result"] = adapter.execute(task, gateway, cfg)
            except BaseException as exc:  # noqa: BLE001 - classified below
                box["exc"] = exc

        t = threading.Thread(target=target, name=f"agent-{gateway.run_id[:8]}", daemon=True)
        t.start()
        t.join(timeout=max_seconds + 2)
        if t.is_alive():
            cancel_event.set()  # the agent will hit RunCancelled at its next gateway call
            gateway.trace.emit("budget_exceeded", f"watchdog: agent still running after {max_seconds}s",
                               exception_type="BudgetExceeded", data={"budget": "MAX_RUN_SECONDS"})
            raise BudgetExceeded(f"MAX_RUN_SECONDS: agent did not return within {max_seconds}s")
        exc = box.get("exc")
        if exc is None:
            result = box.get("result")
            if not isinstance(result, RunResult):
                raise _AgentCrash(TypeError(f"adapter returned {type(result).__name__}, expected RunResult"))
            return result
        if isinstance(exc, (RunCancelled, BudgetExceeded, HarnessError, ProviderUnavailable)):
            raise exc
        raise _AgentCrash(exc)

    def _judge(self, run_id, trace, result: RunResult, budget_hit, started, gateway) -> Run:
        run = db.get_run(run_id)
        task = get_scenario(run.scenario_id)
        latency_ms = (time.monotonic() - started) * 1000
        resolved = resolve(FaultConfig.model_validate(_fault_input(run.fault_config))) if run.fault_config else None
        if result.artifact is not None:
            trace.emit("artifact_submitted", f"agent submitted conclusion '{result.artifact.get('conclusion')}'",
                       data={"artifact": result.artifact})
        elif result.agent_error:
            trace.emit("agent_gave_up", result.agent_error, exception_type="AgentFailure")

        payload = None
        if resolved:
            from app.faults.base import load_payload
            payload = load_payload(resolved.fault, resolved.payload_ref)
        ctx = A.AssertionContext(
            artifact=result.artifact, events=list(trace.events), fault=resolved, dataset=load_dataset(),
            expected=task.expected, max_retries_per_call=get_settings().max_retries_per_call,
            tool_calls=gateway.stats.tool_calls if gateway else 0, latency_ms=latency_ms,
            agent_error=result.agent_error, budget_exceeded=budget_hit, fault_payload=payload,
        )
        results = A.evaluate(ctx)
        sc = A.score(results, run.agent_mode)
        for r in results:
            if r.applicable:
                trace.emit("assertion_evaluated", f"{r.assertion_id}: {r.status.value} - {r.reason}",
                           assertion_ids=[r.assertion_id], data={"status": r.status.value})
        all_pass = sc.applicable > 0 and sc.passed == sc.applicable and result.agent_error is None
        status = RunStatus.PASSED if all_pass else RunStatus.FAILED
        failing = [r.assertion_id for r in results if r.applicable and r.status != A.P]
        reason = ("all applicable assertions passed" if all_pass
                  else result.agent_error or f"assertions not passed: {', '.join(failing)}")
        db.update_run(run_id, artifact=result.artifact, assertion_results=[r.model_dump(mode="json") for r in results],
                      score=sc.model_dump(mode="json"),
                      model_requests=result.model_requests or (gateway.stats.model_requests if gateway else 0))
        return self._finish(run_id, trace, status, None if all_pass else "agent", reason, started, gateway)

    def _finish(self, run_id, trace, status: RunStatus, origin, reason, started, gateway) -> Run:
        latency_ms = round((time.monotonic() - started) * 1000, 2)
        if gateway:
            gateway.close()
        trace.emit("run_completed", f"{status.value}: {reason}",
                   data={"status": status.value, "failure_origin": origin, "latency_ms": latency_ms})
        return db.update_run(
            run_id, status=status.value, failure_origin=origin, status_reason=reason, completed_at=utcnow(),
            latency_ms=latency_ms, tool_calls=gateway.stats.tool_calls if gateway else 0,
            signature=compute_signature(trace.events),
        )


class _AgentCrash(Exception):
    def __init__(self, inner: BaseException):
        super().__init__(str(inner))
        self.inner = inner
        self.inner_type = type(inner).__name__


def _fault_input(stored: dict | None) -> dict | None:
    if stored is None:
        return None
    keys = ("fault_type", "target_tool", "occurrence", "payload_ref", "severity", "max_injections")
    return {k: stored[k] for k in keys if k in stored}


orchestrator = Orchestrator()
