"""
Phoenix -- Hermes Gateway process guardian ("不死鸟" daemon).

Monitors the health of the Hermes Gateway Python process, detects crashes,
and performs automatic recovery with exponential backoff.  Emits events via
SSE so the frontend can react to status changes in real time.

Architecture::

    server.py (main)
      |
      +-- start_guardian()          # called during startup
      |     |
      |     PhoenixGuardian
      |       |-- monitor_loop() [background daemon thread]
      |       |   |-- health_check() --> gateway_restart.get_gateway_status_dict()
      |       |   |-- on_alive / on_dead transitions
      |       |   +-- handle_crash() --> gateway_restart.try_full_restart_gateway()
      |       |
      |       +-- subscribe() --> queue.Queue  (SSE event stream)
      |       +-- get_state() / get_events() / get_stats()  (API commands)
      |
      routes.py
        +-- GET  /api/phoenix/status   --> guardian.get_state()
        +-- GET  /api/phoenix/events   --> guardian.get_events()
        +-- GET  /api/phoenix/stream   --> SSE (guardian.subscribe())
        +-- POST /api/phoenix/restart  --> manual restart
        +-- POST /api/phoenix/config   --> update config
        +-- POST /api/phoenix/enable   / disable
        +-- GET  /api/phoenix/stats    --> aggregated statistics
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class GatewayStatus(str, Enum):
    RUNNING = "running"
    STARTING = "starting"
    STOPPING = "stopping"
    CRASHED = "crashed"
    UNKNOWN = "unknown"
    DISABLED = "disabled"


@dataclass
class PhoenixConfig:
    check_interval_secs: float = 10.0
    health_check_timeout_secs: float = 5.0
    max_restart_attempts: int = 10
    restart_backoff_base_secs: float = 5.0
    restart_backoff_max_secs: float = 300.0
    enabled: bool = True


@dataclass
class HealthCheckResult:
    is_healthy: bool
    pid: Optional[int] = None
    response_time_ms: Optional[float] = None
    details: str = ""


@dataclass
class PhoenixEvent:
    type: str
    timestamp: float = field(default_factory=time.time)
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "timestamp": self.timestamp, "data": self.data}


@dataclass
class PhoenixState:
    status: GatewayStatus = GatewayStatus.UNKNOWN
    uptime_start: Optional[float] = None
    crash_count: int = 0
    consecutive_failures: int = 0
    last_health_check: Optional[float] = None
    last_event: Optional[PhoenixEvent] = None
    config: PhoenixConfig = field(default_factory=PhoenixConfig)
    total_uptime_secs: float = 0.0
    total_restarts: int = 0
    successful_restarts: int = 0
    last_crash_uptime: Optional[float] = None


class PhoenixGuardian:
    """Background daemon that monitors Hermes Gateway health."""

    POLL_INTERVAL = 1.0
    MAX_EVENTS = 256

    def __init__(self, config: Optional[PhoenixConfig] = None):
        self._state = PhoenixState(config=config or PhoenixConfig())
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._subscribers: List[queue.Queue] = []
        self._sub_lock = threading.Lock()
        self._events: List[PhoenixEvent] = []

    @property
    def state(self) -> Dict[str, Any]:
        with self._lock:
            s = self._state
            uptime = 0.0
            if s.uptime_start and s.status == GatewayStatus.RUNNING:
                uptime = time.time() - s.uptime_start
            return {
                "status": s.status.value,
                "uptime_secs": round(uptime, 1),
                "crash_count": s.crash_count,
                "consecutive_failures": s.consecutive_failures,
                "last_health_check": s.last_health_check,
                "enabled": s.config.enabled,
                "config": {
                    "check_interval_secs": s.config.check_interval_secs,
                    "health_check_timeout_secs": s.config.health_check_timeout_secs,
                    "max_restart_attempts": s.config.max_restart_attempts,
                    "restart_backoff_base_secs": s.config.restart_backoff_base_secs,
                    "restart_backoff_max_secs": s.config.restart_backoff_max_secs,
                },
            }

    def get_events(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            events = [e.to_dict() for e in reversed(self._events)]
            if limit:
                events = events[:limit]
            return events

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            s = self._state
            success_rate = (
                round(s.successful_restarts / max(s.total_restarts, 1) * 100, 1)
                if s.total_restarts > 0
                else 100.0
            )
            return {
                "total_uptime_secs": round(s.total_uptime_secs, 1),
                "total_crashes": s.crash_count,
                "total_restarts": s.total_restarts,
                "successful_restarts": s.successful_restarts,
                "restart_success_rate": success_rate,
                "consecutive_failures": s.consecutive_failures,
                "enabled": s.config.enabled,
                "guardian_uptime_secs": round(
                    time.time() - (s.uptime_start or time.time()), 1
                ),
            }

    def set_config(self, config: Dict[str, Any]) -> None:
        with self._lock:
            cfg = self._state.config
            if "check_interval_secs" in config:
                cfg.check_interval_secs = float(config["check_interval_secs"])
            if "health_check_timeout_secs" in config:
                cfg.health_check_timeout_secs = float(config["health_check_timeout_secs"])
            if "max_restart_attempts" in config:
                cfg.max_restart_attempts = int(config["max_restart_attempts"])
            if "restart_backoff_base_secs" in config:
                cfg.restart_backoff_base_secs = float(config["restart_backoff_base_secs"])
            if "restart_backoff_max_secs" in config:
                cfg.restart_backoff_max_secs = float(config["restart_backoff_max_secs"])

    def enable(self) -> None:
        with self._lock:
            self._state.config.enabled = True
            if self._state.status == GatewayStatus.DISABLED:
                self._set_status(GatewayStatus.UNKNOWN)

    def disable(self) -> None:
        with self._lock:
            old_status = self._state.status
            self._state.config.enabled = False
            self._set_status(GatewayStatus.DISABLED)
            if old_status == GatewayStatus.RUNNING:
                self._record_uptime()

    def manual_restart(self) -> Dict[str, str]:
        result = self._attempt_restart(force=True)
        if result.get("ok"):
            return {"message": f"Restart initiated: {result.get('detail', '')}"}
        return {"error": result.get("detail", "Restart failed")}

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._monitor_loop, daemon=True, name="phoenix-guardian"
        )
        self._thread.start()
        logger.info("[phoenix] Guardian started")

    def stop(self) -> None:
        self._stop_event.set()
        with self._sub_lock:
            for q in self._subscribers:
                try:
                    q.put_nowait(None)
                except Exception:
                    pass
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
        logger.info("[phoenix] Guardian stopped")

    def subscribe(self) -> queue.Queue:
        q = queue.Queue(maxsize=64)
        with self._sub_lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._sub_lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    def _emit(self, event: PhoenixEvent) -> None:
        with self._lock:
            self._events.append(event)
            if len(self._events) > self.MAX_EVENTS:
                self._events = self._events[-self.MAX_EVENTS :]
            self._state.last_event = event
        payload = event.to_dict()
        with self._sub_lock:
            dead = []
            for q in self._subscribers:
                try:
                    q.put_nowait(payload)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                try:
                    self._subscribers.remove(q)
                    q.put_nowait(None)
                except Exception:
                    pass

    def _set_status(self, new_status: GatewayStatus) -> None:
        with self._lock:
            old_status = self._state.status
            if old_status == new_status:
                return
            self._state.status = new_status
            if old_status == GatewayStatus.RUNNING:
                self._record_uptime()
            if new_status == GatewayStatus.RUNNING:
                self._state.uptime_start = time.time()
            self._emit(
                PhoenixEvent(
                    type="StatusChanged",
                    data={
                        "old_status": old_status.value,
                        "new_status": new_status.value,
                    },
                )
            )

    def _record_uptime(self) -> None:
        if self._state.uptime_start:
            uptime = time.time() - self._state.uptime_start
            self._state.total_uptime_secs += uptime
            self._state.uptime_start = None

    def _monitor_loop(self) -> None:
        logger.info("[phoenix] Monitor loop entered")
        was_running = False
        while not self._stop_event.is_set():
            try:
                with self._lock:
                    enabled = self._state.config.enabled
                if not enabled:
                    self._stop_event.wait(self.POLL_INTERVAL)
                    continue
                result = self._health_check()
                with self._lock:
                    self._state.last_health_check = time.time()
                if result.is_healthy:
                    if not was_running:
                        self._set_status(GatewayStatus.RUNNING)
                        with self._lock:
                            self._state.consecutive_failures = 0
                        was_running = True
                    self._emit(
                        PhoenixEvent(
                            type="HealthCheckPassed",
                            data={
                                "pid": result.pid,
                                "response_time_ms": result.response_time_ms,
                                "details": result.details,
                            },
                        )
                    )
                else:
                    if was_running:
                        self._handle_crash()
                        was_running = False
                    else:
                        self._set_status(GatewayStatus.UNKNOWN)
                        self._emit(
                            PhoenixEvent(
                                type="HealthCheckFailed",
                                data={
                                    "pid": result.pid,
                                    "details": result.details,
                                },
                            )
                        )
            except Exception:
                logger.debug("[phoenix] Error in monitor loop", exc_info=True)
            for _ in range(int(self.POLL_INTERVAL * 10)):
                if self._stop_event.is_set():
                    return
                time.sleep(0.1)

    def _health_check(self) -> HealthCheckResult:
        t0 = time.monotonic()
        try:
            from api.gateway_restart import get_gateway_status_dict

            status = get_gateway_status_dict()
            elapsed_ms = (time.monotonic() - t0) * 1000
            if status.get("running") and status.get("pid"):
                return HealthCheckResult(
                    is_healthy=True,
                    pid=int(status["pid"]),
                    response_time_ms=round(elapsed_ms, 1),
                    details=f"Gateway running (PID={status['pid']})",
                )
            return HealthCheckResult(
                is_healthy=False,
                pid=status.get("pid"),
                response_time_ms=round(elapsed_ms, 1),
                details=status.get("reason", "not_running"),
            )
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000
            return HealthCheckResult(
                is_healthy=False,
                response_time_ms=round(elapsed_ms, 1),
                details=f"Health check error: {exc}",
            )

    def _handle_crash(self) -> None:
        with self._lock:
            self._state.crash_count += 1
            crash_uptime = 0.0
            if self._state.uptime_start:
                crash_uptime = time.time() - self._state.uptime_start
            self._state.last_crash_uptime = crash_uptime
            self._state.consecutive_failures += 1
            attempts = self._state.consecutive_failures
            max_attempts = self._state.config.max_restart_attempts
        self._set_status(GatewayStatus.CRASHED)
        self._emit(
            PhoenixEvent(
                type="CrashDetected",
                data={
                    "crash_count": self._state.crash_count,
                    "uptime_secs": round(crash_uptime, 1),
                    "consecutive_failures": attempts,
                },
            )
        )
        if attempts > max_attempts:
            logger.warning(
                "[phoenix] Max restart attempts (%d) exceeded, giving up",
                max_attempts,
            )
            return
        backoff = self._calculate_backoff(attempts)
        self._emit(
            PhoenixEvent(
                type="RestartInitiated",
                data={
                    "attempt": attempts,
                    "max_attempts": max_attempts,
                    "backoff_secs": round(backoff, 1),
                },
            )
        )
        logger.info(
            "[phoenix] Crash detected, restarting in %.1fs (attempt %d/%d)",
            backoff,
            attempts,
            max_attempts,
        )
        self._stop_event.wait(backoff)
        if self._stop_event.is_set():
            return
        result = self._attempt_restart()
        if result.get("ok"):
            with self._lock:
                self._state.total_restarts += 1
                self._state.successful_restarts += 1
            self._emit(
                PhoenixEvent(
                    type="RestartSuccess",
                    data={"pid": result.get("pid"), "detail": result.get("detail", "")},
                )
            )
        else:
            self._emit(
                PhoenixEvent(
                    type="RestartFailed",
                    data={"reason": result.get("detail", "unknown"), "attempt": attempts},
                )
            )

    def _calculate_backoff(self, attempt: int) -> float:
        with self._lock:
            base = self._state.config.restart_backoff_base_secs
            max_cap = self._state.config.restart_backoff_max_secs
        exponential = base * (2 ** (attempt - 1))
        return min(max(exponential, base), max_cap)

    def _attempt_restart(self, force: bool = False) -> Dict[str, Any]:
        try:
            from api.gateway_restart import try_full_restart_gateway, try_start_gateway

            result = try_full_restart_gateway()
            if result.get("restarted") or result.get("started"):
                return {
                    "ok": True,
                    "pid": result.get("pid"),
                    "detail": result.get("method", "full_restart"),
                }
            if force:
                start_result = try_start_gateway()
                if start_result.get("started"):
                    return {
                        "ok": True,
                        "pid": start_result.get("pid"),
                        "detail": "start_fallback",
                    }
                return {
                    "ok": False,
                    "detail": start_result.get("reason", "start_failed"),
                }
            return {"ok": False, "detail": result.get("reason", "restart_failed")}
        except Exception as exc:
            return {"ok": False, "detail": str(exc)}


_guardian: Optional[PhoenixGuardian] = None
_guardian_lock = threading.Lock()


def start_guardian(config: Optional[PhoenixConfig] = None) -> PhoenixGuardian:
    global _guardian
    with _guardian_lock:
        if _guardian is None:
            _guardian = PhoenixGuardian(config=config)
            _guardian.start()
        return _guardian


def stop_guardian() -> None:
    global _guardian
    with _guardian_lock:
        if _guardian is not None:
            _guardian.stop()
            _guardian = None


def get_guardian() -> Optional[PhoenixGuardian]:
    with _guardian_lock:
        return _guardian
