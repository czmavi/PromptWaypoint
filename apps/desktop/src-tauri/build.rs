fn main() {
    println!("cargo:rerun-if-env-changed=PMAI_UPDATER_PUBLIC_KEY");
    tauri_build::build()
}
