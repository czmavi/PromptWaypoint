# macOS privacy inventory

Reviewed on 2026-09-20 for the universal macOS TestFlight build.

The privacy manifest is copied to `Contents/Resources/PrivacyInfo.xcprivacy` by
`tauri.appstore.conf.json`. `macos:package:check` compares the manifest in the
actual exported installer against this source.

The linked Rust runtime accesses file metadata using `stat`, `lstat` and `fstat`
for the application's own files. The manifest declares FileTimestamp reason
**C617.1**. File timestamps are not sent to the server.

The inspected native executable imports `clock_gettime`, which is not itself a
required-reason API. No `mach_absolute_time`, disk-space APIs,
`NSUserDefaults`/`standardUserDefaults` or active-keyboard API use was found in
the executable scan. The macOS manifest is distinct from the iOS manifest: the
iOS notification plugin's UserDefaults use is not part of this desktop app.
Recheck dependency call sites and symbols after updates; symbol inspection alone
cannot prove the absence of dynamically invoked APIs.

Tracking is disabled. This manifest does not claim that the configured server
collects no data. Task text, responses and account/device identifiers may be
sent to that server. App Privacy disclosures and a privacy policy must match the
actual deployment before external or public review.

The encryption declaration retains the platform-only encryption exemption:
WebKit HTTPS/TLS and macOS Keychain. Provider processes and credentials remain
in the separately installed Local Agent. Review the declaration if this changes.

References:

- [Apple required-reason APIs](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)
- [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/)
