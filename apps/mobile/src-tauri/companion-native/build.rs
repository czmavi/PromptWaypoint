fn main() {
    tauri_plugin::Builder::new(&[
        "read_auth",
        "write_auth",
        "clear_auth",
        "request_push",
        "take_notifications",
        "register_listener",
        "remove_listener",
    ])
    .android_path("android")
    .ios_path("ios")
    .build();
}
