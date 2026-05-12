//! Tauri command registry -- all `#[tauri::command]` functions and the
//! combined `invoke_handler` list live here.

use tauri::Manager;

mod phoenix;

pub use phoenix::{
    PhoenixConfig, PhoenixEvent, PhoenixGuardian, PhoenixStats, PhoenixStatusSnapshot,
};

// ---------------------------------------------------------------------------
// Window management commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    webbrowser::open(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.close().map_err(|e| format!("Failed to close window: {}", e))
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.show().map_err(|e| format!("Failed to show window: {}", e))
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.hide().map_err(|e| format!("Failed to hide window: {}", e))
}

#[tauri::command]
fn set_title(app: tauri::AppHandle, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.set_title(&title).map_err(|e| format!("Failed to set title: {}", e))
}

#[tauri::command]
fn minimize(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.minimize().map_err(|e| format!("Failed to minimize: {}", e))
}

#[tauri::command]
fn maximize(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.toggle_maximize().map_err(|e| format!("Failed to maximize: {}", e))
}

#[tauri::command]
fn unmaximize(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window.unmaximize().map_err(|e| format!("Failed to unmaximize: {}", e))
}

// ---------------------------------------------------------------------------
// Command list for invoke_handler
// ---------------------------------------------------------------------------

/// Returns the full list of registered Tauri commands.
///
/// Call this inside `.invoke_handler(tauri::generate_handler![...])`.
pub fn commands() -> Vec<tauri::Command> {
    vec![
        // Window management
        open_url,
        close_window,
        show_window,
        hide_window,
        set_title,
        minimize,
        maximize,
        unmaximize,
        // Phoenix process guardian
        phoenix::phoenix_get_state,
        phoenix::phoenix_get_events,
        phoenix::phoenix_manual_restart,
        phoenix::phoenix_set_config,
        phoenix::phoenix_enable,
        phoenix::phoenix_disable,
        phoenix::phoenix_get_stats,
    ]
}
