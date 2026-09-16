# Prompt Waypoint Mobile

Tauri 2 Mobile, Preact, TypeScript, Tailwind CSS and Deno. Mobile communicates
only with the Prompt Waypoint server. It never connects directly to a Local
Agent or reads provider credentials.

## Run and connect

```sh
# repository root
deno install
deno task mobile
```

The browser preview runs on port 1430. Add its development origin to the
server’s explicit CORS allowlist for browser testing. A phone requires an HTTPS
server reachable from that phone. `localhost` refers to the phone itself.

Connect using a Prompt Waypoint user token. The server field is prefilled with
`https://promptwaypoint.com` and can be changed for a self-hosted deployment.
Native builds store Prompt Waypoint authentication in iOS Keychain or Android
Keystore (AES-GCM encrypted private preferences). Browser previews keep the
token in memory only. Cached snapshots and pending changes are scoped to the
server and authentication identity. Settings can renew a token for the same
workspace without dropping pending changes. Android backups are disabled to
avoid restoring encrypted authentication without its device-bound key.

Home shows running/waiting/ready tasks, devices and New Task. Projects groups
repositories by computer. A repository presents touch-friendly sections and
filters; Task detail exposes supported Run, Queue, Resume, Stop, Move to Ready
and waiting-input replies. An offline device still permits task creation, edits,
Ready and server-side Queue. Run clearly indicates the unavailable device.

## Offline and command delivery

`src/model/controller.ts` owns one revision polling subscription and one timed
fallback per app. The app also refreshes on reconnect and when returning to the
foreground. `src/model/store.ts` persists the last snapshot, new drafts and
ordered mutations in one local storage record. Saving a draft does not wait for
the network.

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
Prompt Waypoint authentication and APNs/FCM. No third-party push plugin is
needed. Notifications supported by the server are completed, failed, waiting
input and resumed. Settings requests permission explicitly, obtains a native
token, and registers it through `ServerClient.registerPush`. Token rotation uses
the same registration ID and a new persisted idempotency key. Registration
retries after reconnect.

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

The iOS application is **Prompt Waypoint**, bundle ID
`com.caretsix.aiproductmanager`, minimum iOS 15.0, marketing version 0.1.0 and
build number 1. Canonical settings live in `src-tauri/tauri.ios.conf.json` and
its `src-tauri/ios/project.yml.hbs` template. Regeneration preserves Debug APNs
`development` and Release APNs `production`, automatic signing, the `pmai`
scheme and the export-compliance declaration. Internal Rust/Xcode target names
remain `mobile` / `mobile_iOS`.

See [TESTFLIGHT.md](TESTFLIGHT.md) for release validation, required Apple steps,
version increments, APNs `.p8` server configuration and current blockers. The
new Prompt Waypoint icon is sourced from `assets/branding/app-icon.png`. The
unsigned Release archive and LaunchScreen compile successfully. No signed
TestFlight archive or live push delivery has been validated.

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
Configure matching FCM credentials on the Prompt Waypoint server. The plugin
manifest registers its `FirebaseMessagingService` and Android 13 notification
permission.

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
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo check \
  --manifest-path apps/mobile/src-tauri/Cargo.toml --target aarch64-apple-ios
```

This compiles the Rust and Swift plugin code against the device SDK; it does not
replace simulator/device interaction, signing or a live APNs/FCM delivery test.
