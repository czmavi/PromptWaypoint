# macOS privacy inventory

Direct distribution includes the privacy manifest at
`Contents/Resources/PrivacyInfo.xcprivacy` via `tauri.macos.conf.json`. Tracking
is disabled. FileTimestamp reason C617.1 covers access to files used by the app.
Review the manifest when dependencies or file access change.

The app bundles a Deno-based agent and Claude session-discovery helper. They
read configured local repositories and provider session metadata. Provider
credentials remain local. User-selected task/prompt content, responses and
account/device identifiers may be sent to the configured server. The privacy
policy must match the actual deployment.

The app has no App Sandbox entitlement. Only the compiled Deno helpers receive
the V8 JIT entitlement; the outer app uses hardened runtime without sandbox or
JIT exceptions. The helpers include TLS implementations, so the previous
platform-only encryption exemption is not declared for this distribution.

[Apple privacy manifest documentation](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
