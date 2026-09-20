# iOS privacy manifest inventory

Reviewed for the first TestFlight build on 2026-09-20. The canonical
`PrivacyInfo.xcprivacy` is referenced by `project.yml.hbs` as an application
resource, so `tauri ios init` preserves it. `ios:archive:check` compares the
manifest in the actual application bundle with this source.

| Category      | Reason | Use in this app                                                                                                                                                                                                         |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UserDefaults  | CA92.1 | `CompanionNativePlugin.swift` stores and drains this app's pending notification destinations in `UserDefaults.standard`. No shared defaults suite or cross-app access.                                                  |
| FileTimestamp | C617.1 | The linked Rust runtime uses `stat`/`fstat` while accessing the app's own bundle/container files. The API also returns timestamps even when only file metadata/size is used. No file timestamps are sent to the server. |

The inventory includes the app's Swift plugin and the linked Tauri 2.11.5, Tao
0.35.3, Wry 0.55.1 and deep-link 2.4.10 code. The existing device binary imports
`NSUserDefaults`, `stat`, `fstat` and `clock_gettime`; no `mach_absolute_time`,
disk-space API or active-keyboard API imports were found. Tao uses Rust
`Instant` for event-loop intervals. `clock_gettime` itself is not on Apple's
required-reason list. Recheck symbols and actual call sites when updating
dependencies; a symbol scan alone cannot prove completeness of dynamic calls.

Tracking is disabled and there are no tracking domains. The manifest records
required-reason APIs; it deliberately does not assert that no user data is
collected. Task text, responses, account/device identifiers and push tokens can
reach the configured server. App Privacy disclosures and a privacy policy must
be completed against the actual hosted/self-hosted service before external
review. This file is not a substitute for those disclosures or Apple validation.

References:

- [Apple required-reason APIs and approved reasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)
- [Apple: adding required-reason entries](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest)
- [Tauri file timestamp declaration](https://v2.tauri.app/plugin/file-system/#privacy-manifest)
