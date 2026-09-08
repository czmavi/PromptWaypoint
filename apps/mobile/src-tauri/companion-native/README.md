# Companion native mobile bridge

Local Tauri plugin. Domain logic and HTTP orchestration remain in TypeScript.

- Swift: Keychain storage for one Companion authentication record; APNs
  permission and device registration; notification delegate and persistent
  pending taps.
- Kotlin: Android Keystore AES-GCM storage; FCM registration/service; runtime
  notification permission; cold and warm notification intent handling.
- Rust: platform plugin registration only.

JS command names use snake_case; Tauri dispatches them to lowerCamelCase native
methods. Authentication commands are permitted only for the application window.
Push commands/listeners are scoped to iOS and Android capabilities. The plugin
stores no provider credentials and does not log tokens.

After changing native code, run the iOS SDK check and Android APK build
described in `../../README.md`. Actual push delivery requires application-owned
APNs/FCM configuration. No signing or Firebase secrets are included.
