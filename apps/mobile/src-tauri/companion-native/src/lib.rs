use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_companion_native);
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("companion-native")
        .setup(|_app, api| {
            #[cfg(target_os = "ios")]
            api.register_ios_plugin(init_plugin_companion_native)?;
            #[cfg(target_os = "android")]
            api.register_android_plugin("com.pmai.companionnative", "CompanionNativePlugin")?;
            #[cfg(not(mobile))]
            let _ = api;
            Ok(())
        })
        .build()
}
