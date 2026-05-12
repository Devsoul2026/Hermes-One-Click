//! Hermes One-Click -- Tauri desktop application entry point.
//!
//! Bootstraps the webview window, initialises plugins, creates and manages
//! the Phoenix process guardian lifecycle, and registers all Tauri commands.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::info;

use hermes_agent::{commands, phoenix::PhoenixConfig, phoenix::PhoenixGuardian};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let window = app.get_webview_window("main");
            if let Some(window) = window {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|app| {
            info!("[main] Hermes One-Click starting up");

            let config = PhoenixConfig::default();

            let guardian = PhoenixGuardian::new(app.handle().clone(), config);

            let _join_handle = guardian.start();

            app.manage(guardian);

            info!("[main] Phoenix Guardian initialized and running");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands()])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    info!("[main] Tauri event loop exited -- shutting down guardian");
}
