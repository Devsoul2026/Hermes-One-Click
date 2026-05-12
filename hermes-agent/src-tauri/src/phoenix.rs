//! Phoenix -- Hermes Gateway process guardian ("不死鸟" daemon).
//!
//! Monitors the health of the Hermes Gateway Python process, detects crashes,
//! and performs automatic recovery with exponential backoff.  Emits Tauri
//! events so the frontend can react to status changes in real time.
//!
//! # Architecture
//!
//! ```text
//!  main.rs ──creates──> PhoenixGuardian
//!                         │
//!              monitor_loop() [background thread]
//!                 │    │    │
//!   check_process_alive  perform_health_check  handle_crash
//!                 │            │                  │
//!         sysinfo scan    HTTP / PID file     attempt_restart
//!                                         (system command)
//!                         │
//!                   emit_event() ──tauri::Emitter──> frontend
//! ```

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Tunable parameters for the Phoenix guardian.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PhoenixConfig {
    /// Seconds between consecutive health-check cycles.
    pub check_interval_secs: u64,

    /// Timeout (seconds) for a single health-check probe.
    pub health_check_timeout_secs: u64,

    /// Maximum number of automatic restart attempts before giving up.
    /// After this limit the guardian transitions to `Crashed` permanently.
    pub max_restart_attempts: u32,

    /// Base delay (seconds) between restart attempts (exponential backoff).
    pub restart_backoff_base_secs: u64,

    /// Maximum cap (seconds) for the exponential backoff delay.
    pub restart_backoff_max_secs: u64,

    /// Master switch -- when `false` the guardian idles without monitoring.
    pub enabled: bool,
}

impl Default for PhoenixConfig {
    fn default() -> Self {
        Self {
            check_interval_secs: 10,
            health_check_timeout_secs: 5,
            max_restart_attempts: 10,
            restart_backoff_base_secs: 5,
            restart_backoff_max_secs: 300,
            enabled: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/// Observed lifecycle state of the Hermes Gateway process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayStatus {
    /// Process is alive and passing health checks.
    Running,
    /// Process was just spawned; waiting for first successful health check.
    Starting,
    /// Graceful shutdown in progress.
    Stopping,
    /// Process died unexpectedly; automatic recovery may be in progress.
    Crashed,
    /// Unable to determine state (e.g. PID file missing, permissions).
    Unknown,
    /// Guardian is explicitly disabled.
    Disabled,
}

impl std::fmt::Display for GatewayStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Running => write!(f, "running"),
            Self::Starting => write!(f, "starting"),
            Self::Stopping => write!(f, "stopping"),
            Self::Crashed => write!(f, "crashed"),
            Self::Unknown => write!(f, "unknown"),
            Self::Disabled => write!(f, "disabled"),
        }
    }
}

/// Outcome of a single health-check probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    /// Whether the gateway is considered healthy.
    pub is_healthy: bool,
    /// Process ID of the gateway (if found).
    pub pid: Option<u32>,
    /// Round-trip response time in milliseconds (if measured).
    pub response_time_ms: Option<u64>,
    /// Human-readable diagnostic string.
    pub details: String,
}

/// Events emitted by the guardian over the Tauri event bus.
///
/// Frontend listeners subscribe to `"phoenix:event"` and receive these
/// variants as JSON payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PhoenixEvent {
    StatusChanged {
        old_status: String,
        new_status: String,
        timestamp: u64,
    },
    HealthCheckPassed {
        result: HealthCheckResult,
    },
    HealthCheckFailed {
        result: HealthCheckResult,
    },
    CrashDetected {
        pid: Option<u32>,
        exit_code: Option<i32>,
        uptime_secs: Option<u64>,
    },
    RestartInitiated {
        attempt: u32,
        max_attempts: u32,
        backoff_secs: u64,
    },
    RestartSuccess {
        uptime_secs: u64,
    },
    RestartFailed {
        reason: String,
        attempt: u32,
    },
}

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

/// Thread-safe snapshot of the guardian's runtime state.
#[derive(Debug)]
pub struct PhoenixState {
    pub status: GatewayStatus,
    pub uptime_start: Option<Instant>,
    pub crash_count: u32,
    pub consecutive_failures: u32,
    pub last_health_check: Option<Instant>,
    pub last_event: Option<PhoenixEvent>,
    pub config: PhoenixConfig,
    /// Ring buffer of recent events for the `phoenix_get_events` command.
    pub event_history: VecDeque<PhoenixEvent>,
    /// Total number of health checks performed since startup.
    pub total_health_checks: u64,
    /// Number of successful health checks.
    pub successful_health_checks: u64,
    /// Accumulated response times (ms) for computing rolling average.
    pub accumulated_response_time_ms: u64,
    /// Timestamp when the guardian was started.
    pub guardian_started_at: Instant,
    /// Current restart attempt counter (resets on success).
    pub current_restart_attempt: u32,
}

impl PhoenixState {
    fn new(config: PhoenixConfig) -> Self {
        Self {
            status: if config.enabled {
                GatewayStatus::Unknown
            } else {
                GatewayStatus::Disabled
            },
            uptime_start: None,
            crash_count: 0,
            consecutive_failures: 0,
            last_health_check: None,
            last_event: None,
            config,
            event_history: VecDeque::with_capacity(256),
            total_health_checks: 0,
            successful_health_checks: 0,
            accumulated_response_time_ms: 0,
            guardian_started_at: Instant::now(),
            current_restart_attempt: 0,
        }
    }

    fn push_event(&mut self, event: PhoenixEvent) {
        if self.event_history.len() >= 256 {
            self.event_history.pop_front();
        }
        self.event_history.push_back(event.clone());
        self.last_event = Some(event);
    }
}

// ---------------------------------------------------------------------------
// Snapshot / stats types returned to the frontend
// ---------------------------------------------------------------------------

/// Point-in-time snapshot of the guardian state, returned by
/// `phoenix_get_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoenixStatusSnapshot {
    pub status: String,
    pub uptime_secs: Option<u64>,
    pub crash_count: u32,
    pub consecutive_failures: u32,
    pub last_health_check_ago_secs: Option<u64>,
    pub enabled: bool,
    pub current_restart_attempt: u32,
    pub guardian_uptime_secs: u64,
}

/// Aggregated statistics returned by `phoenix_get_stats`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoenixStats {
    pub total_health_checks: u64,
    pub successful_health_checks: u64,
    pub success_rate_pct: f64,
    pub average_response_time_ms: Option<f64>,
    pub crash_count: u32,
    pub total_restart_attempts: u32,
    pub guardian_uptime_secs: u64,
    pub gateway_uptime_secs: Option<u64>,
}

// ---------------------------------------------------------------------------
// Core guardian
// ---------------------------------------------------------------------------

/// The Phoenix process guardian.
///
/// Owns the shared state and drives the background monitoring loop.
/// Cloning is cheap (Arc + Arc<AtomicBool>).
pub struct PhoenixGuardian {
    state: Arc<Mutex<PhoenixState>>,
    app_handle: AppHandle,
    shutdown: Arc<AtomicBool>,
}

impl PhoenixGuardian {
    /// Create a new guardian bound to the given Tauri app handle.
    pub fn new(app_handle: AppHandle, config: PhoenixConfig) -> Self {
        Self {
            state: Arc::new(Mutex::new(PhoenixState::new(config))),
            app_handle,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Launch the background monitoring thread.  Returns a `JoinHandle`
    /// so the caller can block on shutdown if desired.
    pub fn start(&self) -> std::thread::JoinHandle<()> {
        let state = Arc::clone(&self.state);
        let app_handle = self.app_handle.clone();
        let shutdown = Arc::clone(&self.shutdown);

        info!("[phoenix] Guardian starting");

        let handle = std::thread::Builder::new()
            .name("phoenix-guardian".into())
            .spawn(move || {
                let guardian = Self { state, app_handle, shutdown };
                guardian.monitor_loop();
            })
            .expect("failed to spawn phoenix guardian thread");

        handle
    }

    /// Signal the background loop to stop at its next iteration.
    pub fn stop(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        info!("[phoenix] Shutdown signal sent");
    }

    // ---- internal --------------------------------------------------------

    fn monitor_loop(&self) {
        info!("[phoenix] Monitor loop entered");

        loop {
            if self.shutdown.load(Ordering::SeqCst) {
                info!("[phoenix] Monitor loop exiting (shutdown requested)");
                break;
            }

            let interval_secs = {
                let st = self.state.lock().unwrap();
                if !st.config.enabled {
                    drop(st);
                    self.sleep_interruptible(Duration::from_secs(5));
                    continue;
                }
                st.config.check_interval_secs
            };

            self.monitor_cycle();

            self.sleep_interruptible(Duration::from_secs(interval_secs));
        }

        info!("[phoenix] Monitor loop exited");
    }

    fn monitor_cycle(&self) {
        let check_start = Instant::now();

        let alive_result = self.check_process_alive();
        let health = self.perform_health_check();

        {
            let mut st = self.state.lock().unwrap();
            st.total_health_checks += 1;
            st.last_health_check = Some(Instant::now());

            if let Some(rt) = health.response_time_ms {
                st.accumulated_response_time_ms += rt;
            }
        }

        if health.is_healthy {
            self.on_health_passed(alive_result, &health);
        } else {
            self.on_health_failed(alive_result, &health);
        }

        let elapsed = check_start.elapsed();
        if elapsed > Duration::from_secs(30) {
            warn!(
                "[phoenix] Monitor cycle took {:.1}s (expected <{}s)",
                elapsed.as_secs_f64(),
                {
                    let st = self.state.lock().unwrap();
                    st.config.check_interval_secs
                }
            );
        }
    }

    // ---- process detection -----------------------------------------------

    /// Scan the system process table for the Hermes Gateway process.
    ///
    /// Uses `sysinfo` to find a Python process whose command line contains
    /// known gateway identity markers such as:
    /// - `hermes_cli.main gateway`
    /// - `hermes gateway`
    /// - `gateway/run.py`
    /// - `hermes-gateway`
    ///
    /// Returns `Some((pid, name))` on success or `None` if not found.
    fn check_process_alive(&self) -> Option<(u32, String)> {
        let mut sys = System::new_all();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        find_gateway_pid(&sys)
    }

    // ---- health check ----------------------------------------------------

    /// Probe whether the gateway is responsive.
    ///
    /// Strategy (ordered by preference):
    /// 1. **PID file** at `{HERMES_HOME}/gateway.pid` -- read it, verify the
    ///    PID is alive via sysinfo, optionally hit the HTTP health endpoint.
    /// 2. **Process table scan** -- fall back to `check_process_alive`.
    /// 3. **Unknown** -- no evidence either way.
    fn perform_health_check(&self) -> HealthCheckResult {
        let start = Instant::now();

        let pid_info = self.check_process_alive();

        if let Some((pid, name)) = pid_info {
            let elapsed_ms = start.elapsed().as_millis() as u64;

            #[cfg(feature = "health-check-http")]
            {
                if let Ok(Some(http_ok)) = self.http_health_probe(pid) {
                    return if http_ok {
                        HealthCheckResult {
                            is_healthy: true,
                            pid: Some(pid),
                            response_time_ms: Some(elapsed_ms),
                            details: format!("Gateway process alive (PID={}, name={})", pid, name),
                        }
                    } else {
                        HealthCheckResult {
                            is_healthy: false,
                            pid: Some(pid),
                            response_time_ms: Some(elapsed_ms),
                            details: format!(
                                "Process alive but health endpoint unresponsive (PID={})",
                                pid
                            ),
                        }
                    };
                }
            }

            return HealthCheckResult {
                is_healthy: true,
                pid: Some(pid),
                response_time_ms: Some(elapsed_ms),
                details: format!("Gateway process alive (PID={}, name={})", pid, name),
            };
        }

        HealthCheckResult {
            is_healthy: false,
            pid: None,
            response_time_ms: None,
            details: "Gateway process not found in system process table".into(),
        }
    }

    /// Optional HTTP health probe (requires `health-check-http` feature).
    #[cfg(feature = "health-check-http")]
    fn http_health_probe(&self, _pid: u32) -> Result<Option<bool>, String> {
        let port: u16 = std::env::var("HERMES_GATEWAY_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8080);

        let url = format!("http://127.0.0.1:{}/api/health", port);

        match reqwest::Client::builder()
            .timeout(Duration::from_secs({
                let st = self.state.lock().unwrap();
                st.config.health_check_timeout_secs
            }))
            .build()
        {
            Ok(client) => match client.get(&url).send() {
                Ok(resp) => Ok(Some(resp.status().is_success())),
                Err(e) => Err(format!("HTTP health probe failed: {}", e)),
            },
            Err(e) => Err(format!("Failed to build HTTP client: {}", e)),
        }
    }

    // ---- event handlers --------------------------------------------------

    fn on_health_passed(&self, _alive: Option<(u32, String)>, result: &HealthCheckResult) {
        let (old_status, was_crashed) = {
            let mut st = self.state.lock().unwrap();
            let old = st.status.clone();
            let crashed = old == GatewayStatus::Crashed;

            st.successful_health_checks += 1;
            st.consecutive_failures = 0;

            if old != GatewayStatus::Running {
                if st.uptime_start.is_none() || crashed {
                    st.uptime_start = Some(Instant::now());
                }
                st.current_restart_attempt = 0;
                st.status = GatewayStatus::Running;
                let new_status = st.status.clone();

                let event = PhoenixEvent::StatusChanged {
                    old_status: old.to_string(),
                    new_status: new_status.to_string(),
                    timestamp: unix_now_ms(),
                };
                st.push_event(event.clone());
                drop(st);

                self.emit_event(event);
                (old, true)
            } else {
                let event = PhoenixEvent::HealthCheckPassed { result: result.clone() };
                st.push_event(event.clone());
                drop(st);

                self.emit_event(event);
                (old, false)
            }
        };

        if was_crashed {
            info!(
                "[phoenix] Gateway recovered from crash after {} total crashes",
                { let st = self.state.lock().unwrap(); st.crash_count }
            );
        } else if old_status != GatewayStatus::Running {
            info!("[phoenix] Gateway transitioned to Running");
        }
    }

    fn on_health_failed(&self, alive: Option<(u32, String)>, result: &HealthCheckResult) {
        let (should_handle_crash, status_before) = {
            let mut st = self.state.lock().unwrap();
            st.consecutive_failures += 1;

            let event = PhoenixEvent::HealthCheckFailed { result: result.clone() };
            st.push_event(event.clone());
            drop(st);

            self.emit_event(event);

            let mut st = self.state.lock().unwrap();
            let prev = st.status.clone();

            match st.status {
                GatewayStatus::Running | GatewayStatus::Starting => {
                    st.status = GatewayStatus::Crashed;
                    st.crash_count += 1;

                    let crash_event = PhoenixEvent::CrashDetected {
                        pid: alive.map(|(p, _)| p),
                        exit_code: None,
                        uptime_secs: st.uptime_start.map(|t| t.elapsed().as_secs()),
                    };
                    st.push_event(crash_event.clone());
                    drop(st);
                    self.emit_event(crash_event);

                    (true, prev)
                }
                GatewayStatus::Crashed => {
                    let already_at_limit =
                        st.current_restart_attempt >= st.config.max_restart_attempts;
                    (already_at_limit, prev)
                }
                _ => (false, prev),
            }
        };

        if should_handle_crash {
            warn!(
                "[phoenix] Crash detected (status was: {}, consecutive failures: {})",
                status_before,
                { let st = self.state.lock().unwrap(); st.consecutive_failures }
            );
            self.handle_crash();
        }
    }

    // ---- crash handling --------------------------------------------------

    fn handle_crash(&self) {
        let (attempt, max_attempts, should_try) = {
            let mut st = self.state.lock().unwrap();
            st.current_restart_attempt += 1;
            let attempt = st.current_restart_attempt;
            let max = st.config.max_restart_attempts;
            let should = attempt <= max;
            (attempt, max, should)
        };

        if !should_try {
            error!(
                "[phoenix] Max restart attempts ({}) exhausted — giving up",
                max_attempts
            );
            let event = PhoenixEvent::RestartFailed {
                reason: format!(
                    "Max restart attempts ({}) exhausted",
                    max_attempts
                ),
                attempt,
            };
            {
                let mut st = self.state.lock().unwrap();
                st.push_event(event.clone());
            }
            self.emit_event(event);
            return;
        }

        let backoff_secs = self.calculate_backoff(attempt);

        let event = PhoenixEvent::RestartInitiated {
            attempt,
            max_attempts,
            backoff_secs,
        };
        {
            let mut st = self.state.lock().unwrap();
            st.push_event(event.clone());
        }
        self.emit_event(event);

        info!(
            "[phoenix] Restart attempt {}/{}, backing off {}s",
            attempt, max_attempts, backoff_secs
        );

        self.sleep_interruptible(Duration::from_secs(backoff_secs));

        if self.shutdown.load(Ordering::SeqCst) {
            info!("[phoenix] Aborting restart — shutdown in progress");
            return;
        }

        match self.attempt_restart() {
            Ok(()) => {
                info!("[phoenix] Restart command issued successfully");
                {
                    let mut st = self.state.lock().unwrap();
                    st.status = GatewayStatus::Starting;
                    st.uptime_start = None;
                    st.consecutive_failures = 0;

                    let event = PhoenixEvent::RestartSuccess {
                        uptime_secs: 0,
                    };
                    st.push_event(event.clone());
                    drop(st);
                    self.emit_event(event);
                }
            }
            Err(reason) => {
                error!("[phoenix] Restart failed: {}", reason);
                let event = PhoenixEvent::RestartFailed { reason, attempt };
                {
                    let mut st = self.state.lock().unwrap();
                    st.push_event(event.clone());
                }
                self.emit_event(event);
            }
        }
    }

    fn calculate_backoff(&self, attempt: u32) -> u64 {
        let (base, max_cap) = {
            let st = self.state.lock().unwrap();
            (st.config.restart_backoff_base_secs, st.config.restart_backoff_max_secs)
        };

        let exponential = base * 2u64.saturating_pow(attempt.saturating_sub(1));
        exponential.min(max_cap).max(base)
    }

    // ---- restart execution -----------------------------------------------

    /// Attempt to restart the Hermes Gateway by invoking the system command.
    ///
    /// On Windows this uses `hermes-gateway.cmd` / `python -m gateway.run`.
    /// On POSIX it uses the shell script wrapper.
    fn attempt_restart(&self) -> Result<(), String> {
        let hermes_home = std::env::var("HERMES_HOME").map_err(|e| {
            format!("HERMES_HOME not set: {}. Cannot locate gateway.", e)
        })?;

        let agent_dir = std::env::var("HERMES_AGENT_DIR").ok().or_else(|| {
            let cwd = std::env::current_dir().ok()?;
            Some(cwd.to_string_lossy().into_owned())
        });

        let python_exe = std::env::var("PYTHON_EXE")
            .or_else(|_| {
                if cfg!(windows) {
                    std::env::var("PYTHON")
                } else {
                    std::env::var("PYTHON")
                }
            })
            .unwrap_or_else(|_| "python".into());

        let command = if cfg!(windows) {
            let script_path = std::path::Path::new(&hermes_home)
                .parent()
                .and_then(|p| {
                    let s = p.join("scripts").join("hermes-gateway.cmd");
                    if s.exists() {
                        Some(s.to_string_lossy().into_owned())
                    } else {
                        None
                    }
                });

            if let Some(script) = script_path {
                format!("cmd /c \"{}\"", script)
            } else if let Some(ref agent) = agent_dir {
                format!(
                    "{} -u -m gateway.run",
                    python_exe
                )
            } else {
                return Err(
                    "Cannot construct restart command: neither hermes-gateway.cmd nor \
                     HERMES_AGENT_DIR found"
                        .into(),
                );
            }
        } else {
            let script_path = std::path::Path::new(&hermes_home)
                .parent()
                .and_then(|p| {
                    let s = p.join("scripts").join("hermes-gateway");
                    if s.exists() {
                        Some(s.to_string_lossy().into_owned())
                    } else {
                        None
                    }
                });

            if let Some(script) = script_path {
                format!("\"{}\"", script)
            } else if let Some(ref agent) = agent_dir {
                format!("{} -u -m gateway.run", python_exe)
            } else {
                return Err(
                    "Cannot construct restart command: neither hermes-gateway nor \
                     HERMES_AGENT_DIR found"
                        .into(),
                );
            }
        };

        info!("[phoenix] Executing restart command: {}", command);

        let output = if cfg!(windows) {
            std::process::Command::new("cmd")
                .args(["/C", &command])
                .env("HERMES_HOME", &hermes_home)
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
        } else {
            std::process::Command::new("sh")
                .args(["-c", &command])
                .env("HERMES_HOME", &hermes_home)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
        }
        .map_err(|e| format!("Failed to spawn restart process: {}", e))?;

        let pid = output.id();
        info!("[phoenix] Restart child process spawned with PID {:?}", pid);
        Ok(())
    }

    // ---- event emission --------------------------------------------------

    fn emit_event(&self, event: PhoenixEvent) {
        if let Err(e) = self.app_handle.emit("phoenix:event", &event) {
            error!("[phoenix] Failed to emit event: {}", e);
        }
    }

    fn update_status(&self, new_status: GatewayStatus) {
        let (old_status, event) = {
            let mut st = self.state.lock().unwrap();
            let old = st.status.clone();
            if old == new_status {
                return;
            }
            st.status = new_status.clone();
            let evt = PhoenixEvent::StatusChanged {
                old_status: old.to_string(),
                new_status: new_status.to_string(),
                timestamp: unix_now_ms(),
            };
            st.push_event(evt.clone());
            (old, evt)
        };

        info!(
            "[phoenix] Status changed: {} -> {}",
            old_status,
            { let st = self.state.lock().unwrap(); st.status }
        );
        self.emit_event(event);
    }

    // ---- utilities --------------------------------------------------------

    fn sleep_interruptible(&self, duration: Duration) {
        let deadline = Instant::now() + duration;
        while Instant::now() < deadline {
            if self.shutdown.load(Ordering::SeqCst) {
                return;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining > Duration::from_millis(100) {
                std::thread::sleep(Duration::from_millis(100));
            } else {
                std::thread::sleep(remaining.min(Duration::from_millis(50)));
                break;
            }
        }
    }

    // ---- public accessors ------------------------------------------------

    /// Take a point-in-time snapshot of the guardian's state.
    pub fn snapshot(&self) -> PhoenixStatusSnapshot {
        let st = self.state.lock().unwrap();
        PhoenixStatusSnapshot {
            status: st.status.to_string(),
            uptime_secs: st.uptime_start.map(|t| t.elapsed().as_secs()),
            crash_count: st.crash_count,
            consecutive_failures: st.consecutive_failures,
            last_health_check_ago_secs: st.last_health_check.map(|t| t.elapsed().as_secs()),
            enabled: st.config.enabled,
            current_restart_attempt: st.current_restart_attempt,
            guardian_uptime_secs: st.guardian_started_at.elapsed().as_secs(),
        }
    }

    /// Collect recent events from the ring buffer.
    pub fn recent_events(&self, limit: Option<u32>) -> Vec<PhoenixEvent> {
        let st = self.state.lock().unwrap();
        let limit = limit.unwrap_or(50) as usize;
        st.event_history.iter().rev().take(limit).cloned().collect()
    }

    /// Compute aggregated statistics.
    pub fn stats(&self) -> PhoenixStats {
        let st = self.state.lock().unwrap();
        let avg_response = if st.successful_health_checks > 0 {
            Some(
                st.accumulated_response_time_ms as f64
                    / st.successful_health_checks as f64,
            )
        } else {
            None
        };

        let success_rate = if st.total_health_checks > 0 {
            st.successful_health_checks as f64 / st.total_health_checks as f64 * 100.0
        } else {
            0.0
        };

        PhoenixStats {
            total_health_checks: st.total_health_checks,
            successful_health_checks: st.successful_health_checks,
            success_rate_pct: success_rate,
            average_response_time_ms: avg_response,
            crash_count: st.crash_count,
            total_restart_attempts: st.current_restart_attempt,
            guardian_uptime_secs: st.guardian_started_at.elapsed().as_secs(),
            gateway_uptime_secs: st.uptime_start.map(|t| t.elapsed().as_secs()),
        }
    }

    /// Update the running configuration.
    pub fn set_config(&self, config: PhoenixConfig) -> Result<(), String> {
        let mut st = self.state.lock().unwrap();
        let was_enabled = st.config.enabled;
        st.config = config.clone();

        if config.enabled && !was_enabled {
            st.status = GatewayStatus::Unknown;
            info!("[phoenix] Guardian re-enabled");
        } else if !config.enabled && was_enabled {
            st.status = GatewayStatus::Disabled;
            info!("[phoenix] Guardian disabled");
        }

        Ok(())
    }

    /// Enable the guardian (resume monitoring).
    pub fn enable(&self) {
        let mut st = self.state.lock().unwrap();
        if !st.config.enabled {
            st.config.enabled = true;
            st.status = GatewayStatus::Unknown;
            info!("[phoenix] Guardian enabled");
        }
    }

    /// Disable the guardian (stop monitoring, keep state).
    pub fn disable(&self) {
        let mut st = self.state.lock().unwrap();
        if st.config.enabled {
            st.config.enabled = false;
            st.status = GatewayStatus::Disabled;
            info!("[phoenix] Guardian disabled");
        }
    }

    /// Trigger a manual restart regardless of current state.
    pub fn manual_restart(&self) -> Result<String, String> {
        info!("[phoenix] Manual restart requested by user");

        self.attempt_restart()?;

        {
            let mut st = self.state.lock().unwrap();
            st.status = GatewayStatus::Starting;
            st.uptime_start = None;
            st.consecutive_failures = 0;
            st.current_restart_attempt = 0;
        }

        Ok("Manual restart initiated".into())
    }
}

// ---------------------------------------------------------------------------
// Free function: process discovery
// ---------------------------------------------------------------------------

/// Search the system process table for the Hermes Gateway process.
///
/// Scans all processes looking for Python (`python`, `python3`, `python.exe`)
/// whose command line contains one of the known gateway identity patterns:
///
/// - `hermes_cli.main gateway`
/// - `hermes_cli/main.py gateway`
/// - `hermes gateway`
/// - `hermes-gateway`
/// - `gateway/run.py`
/// - `-m gateway.run`
///
/// Returns `Some((pid, process_name))` on the first match, or `None` if
/// no candidate is found.
pub fn find_gateway_pid(sys: &System) -> Option<(u32, String)> {
    const GATEWAY_PATTERNS: &[&str] = &[
        "hermes_cli.main gateway",
        "hermes_cli/main.py gateway",
        "hermes gateway",
        "hermes-gateway",
        "gateway/run.py",
        "-m gateway.run",
    ];

    const PYTHON_NAMES: &[&str] = &["python", "python3", "python.exe", "python3.exe"];

    for (pid, process) in sys.processes() {
        let name = process.name().to_str().unwrap_or("").to_lowercase();

        let is_python = PYTHON_NAMES
            .iter()
            .any(|p| name == *p || name.starts_with(p) || name.contains("python"));

        if !is_python {
            continue;
        }

        let cmdline = process.cmd().join(" ");

        if GATEWAY_PATTERNS
            .iter()
            .any(|pattern| cmdline.contains(pattern))
        {
            return Some((pid.as_u32(), name));
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Command: return the current guardian status snapshot.
#[tauri::command]
pub fn phoenix_get_state(guardian: tauri::State<'_, PhoenixGuardian>) -> PhoenixStatusSnapshot {
    guardian.snapshot()
}

/// Command: return up to `limit` recent events (most recent first).
#[tauri::command]
pub fn phoenix_get_events(
    limit: Option<u32>,
    guardian: tauri::State<'_, PhoenixGuardian>,
) -> Vec<PhoenixEvent> {
    guardian.recent_events(limit)
}

/// Command: trigger a manual gateway restart.
#[tauri::command]
pub fn phoenix_manual_restart(
    guardian: tauri::State<'_, PhoenixGuardian>,
) -> Result<String, String> {
    guardian.manual_restart()
}

/// Command: replace the running configuration with the provided one.
#[tauri::command]
pub fn phoenix_set_config(
    config: PhoenixConfig,
    guardian: tauri::State<'_, PhoenixGuardian>,
) -> Result<(), String> {
    guardian.set_config(config)
}

/// Command: enable the guardian (resume monitoring).
#[tauri::command]
pub fn phoenix_enable(guardian: tauri::State<'_, PhoenixGuardian>) {
    guardian.enable()
}

/// Command: disable the guardian (pause monitoring).
#[tauri::command]
pub fn phoenix_disable(guardian: tauri::State<'_, PhoenixGuardian>) {
    guardian.disable()
}

/// Command: return aggregated runtime statistics.
#[tauri::command]
pub fn phoenix_get_stats(guardian: tauri::State<'_, PhoenixGuardian>) -> PhoenixStats {
    guardian.stats()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
