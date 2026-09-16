use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !["agent", "server"].contains(&name) {
        return Err("Unknown Prompt Waypoint credential".into());
    }
    keyring::Entry::new("com.pmai.companion", name).map_err(|e| e.to_string())
}
#[tauri::command]
fn read_token(name: String) -> Result<String, String> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn write_token(name: String, value: String) -> Result<String, String> {
    entry(&name)?
        .set_password(&value)
        .map_err(|e| e.to_string())?;
    Ok(String::new())
}
#[tauri::command]
fn agent_token(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join(".pmai-agent/local-token");
    std::fs::read_to_string(path)
        .map(|s| s.trim().to_owned())
        .map_err(|e| e.to_string())
}
fn show(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let window = app.get_webview_window(label).ok_or("Window unavailable")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
fn show_capture(app: tauri::AppHandle) -> Result<(), String> {
    show(&app, "capture")
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = show(app, "capture");
                    }
                })
                .build(),
        )
        .setup(|app| {
            app.global_shortcut()
                .register("CommandOrControl+Shift+Space")?;
            let open = MenuItem::with_id(app, "open", "Open Prompt Waypoint", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "Quick Capture", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Prompt Waypoint", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &capture, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Prompt Waypoint")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = show(app, "main");
                    }
                    "capture" => {
                        let _ = show(app, "capture");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_token,
            write_token,
            agent_token,
            show_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prompt Waypoint");
}
