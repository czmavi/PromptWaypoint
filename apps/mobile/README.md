# Companion Mobile

Tauri 2 Mobile, Preact, TypeScript, Tailwind CSS and Deno. Mobile communicates
only with the Companion server. It never connects directly to a Local Agent or
reads provider credentials.

## Run and connect

```sh
# repository root
deno install
deno task mobile
```

The browser preview runs on port 1430. Add its development origin to the
server’s explicit CORS allowlist for browser testing. A phone requires an HTTPS
server reachable from that phone. `localhost` refers to the phone itself.

Connect using the server URL and a Companion user token. Native builds store
Companion authentication in iOS Keychain or Android Keystore (AES-GCM encrypted
private preferences). Browser previews keep the token in memory only. Cached
snapshots and pending changes are scoped to the server and authentication
identity. Settings can renew a token for the same workspace without dropping
pending changes. Android backups are disabled to avoid restoring encrypted
authentication without its device-bound key.

Home shows running/waiting/ready tasks, devices and New Task. Projects groups
repositories by computer. A repository presents touch-friendly sections and
filters; Task detail exposes supported Run, Queue, Resume, Stop, Move to Ready
and waiting-input replies. An offline device still permits task creation, edits,
Ready and server-side Queue. Run clearly indicates the unavailable device.

## Offline and command delivery

`src/model/controller.ts` owns one SSE subscription and one timed fallback per
app. The app also refreshes on reconnect and when returning to the foreground.
`src/model/store.ts` persists the last snapshot, new drafts and ordered
mutations in one local storage record. Saving a draft does not wait for the
network.

Create/edit requests and actions receive client-generated IDs before dispatch. A
lost response keeps the same payload and idempotency key for retry. Double
Run/Resume/Send taps are blocked synchronously; the server remains authoritative
for execution state and deduplication. Requests are not reported as completed
until acknowledged by the server. Rejected changes remain visible for review;
uncertain requests cannot be silently discarded. Pending work survives restart.

`CaptureInput` and the Capture component’s `initial` input are the boundary for
future speech/share-sheet capture adapters. They use the same task creation
pipeline; no speech or OS share extension is included in this MVP.

Shared task/status/provider/device/prompt UI comes from `packages/ui`. Mobile
navigation and layouts are independent of Desktop. Session IDs are scoped by
device and profile; notification links do not execute commands.

## Native plugin and push

`src-tauri/companion-native` is the isolated Swift/Kotlin plugin for secure
Companion authentication and APNs/FCM. No third-party push plugin is needed.
Notifications supported by the server are completed, failed, waiting input and
resumed. Settings requests permission explicitly, obtains a native token, and
registers it through `ServerClient.registerPush`. Token rotation uses the same
registration ID and a new persisted idempotency key. Registration retries after
reconnect.

Notification taps are persisted natively until the web UI drains them, including
cold starts. Foreground events refresh the snapshot. Links resolve to
`pmai://tasks/<id>` or `pmai://sessions/<id>?deviceId=…&providerProfileId=…`.
Only task/session destinations are accepted. Tasks are opened preferentially
when the notification includes both task and session IDs.

### iOS

Requirements: Xcode, iOS platform support, an iOS Simulator runtime for
simulator runs, and a signing team for deployment to physical devices.

```sh
cd apps/mobile
deno task tauri ios init
deno task tauri ios dev
# unsigned simulator build, where supported:
deno task tauri ios build --debug --target aarch64-sim --no-sign --ci
```

The iOS application ID is `com.caretsix.aiproductmanager` (set in
`src-tauri/tauri.ios.conf.json`). Enable Push Notifications for this App ID in
your Apple developer account and select your signing team. The checked in
entitlement uses `aps-environment=development`; use the production entitlement
and matching server APNs environment for TestFlight/App Store distribution. The
APNs server topic must match the application ID. APNs credentials stay on the
server. Real delivery requires a provisioned application; compilation alone does
not prove push delivery.

The generated Xcode project preserves its URL scheme and push entitlement in
`gen/apple/project.yml`. When regenerating native projects, review these
settings. The plugin installs APNs callbacks on Tao’s application delegate
without replacing its existing lifecycle methods; do not install a second APNs
delegate plugin alongside it.

### Android

Requirements: JDK 17, Android SDK, NDK and an emulator or device.

```sh
cd apps/mobile
deno task tauri android init
deno task tauri android dev
deno task tauri android build --debug --target aarch64 --apk --ci
```

Create a Firebase Android app for `com.martinvich.mobile`. Put its
`google-services.json` in `src-tauri/gen/android/app/` (gitignored). Gradle
applies Google Services only when the file is present; builds without it remain
usable, and notification registration reports that Firebase is not configured.
Configure matching FCM credentials on the Companion server. The plugin manifest
registers its `FirebaseMessagingService` and Android 13 notification permission.

Debug APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`.
Release builds require your signing configuration. Do not commit signing keys or
Firebase/service-account credentials.

## Validation

```sh
# repository root
deno fmt
deno lint
deno check
deno task test
# Full suite including temporary PostgreSQL integration:
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
```

Mobile tests cover capture/edit, persisted offline sync, response loss,
duplicate Run/Resume/replies, Queue, offline devices, profile isolation,
notification routing, registration retry and rendered waiting/capture forms.
They use fake server responses and do not submit work to live provider accounts.

SDK-only iOS code check when Tauri cannot discover a runnable iOS platform:

```sh
IPHONEOS_DEPLOYMENT_TARGET=14.0 cargo check \
  --manifest-path apps/mobile/src-tauri/Cargo.toml --target aarch64-apple-ios
```

This compiles the Rust and Swift plugin code against the device SDK; it does not
replace simulator/device interaction, signing or a live APNs/FCM delivery test.
