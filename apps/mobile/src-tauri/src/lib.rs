#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![platform])
        .plugin(tauri_plugin_companion_native::init())
        .plugin(tauri_plugin_deep_link::init());

    builder
        .run(tauri::generate_context!())
        .expect("error running Companion mobile");
}
