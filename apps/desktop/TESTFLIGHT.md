# Prompt Waypoint for macOS — TestFlight

Updated **2026-09-20**. The Mac version uses the existing App Store Connect app
**6814106323**, bundle ID `com.caretsix.aiproductmanager`, and internal testing
group created for iOS. The macOS platform has been added to that app record.

## Current build

- Version **0.1.0**, build **1**, minimum **macOS 13.3**.
- Universal executable: **Apple Silicon and Intel**. Built with Xcode **26.2**
  and the macOS **26.2 SDK**.
- App Sandbox enabled, with outgoing network connections to the separately
  running Local Agent and optional HTTPS server. No broad filesystem exception.
- Login launch uses Apple's `SMAppService`, in response to the Settings toggle.
  A conflicting global shortcut no longer prevents the application from opening.
- JavaScript and CSS target Safari 16.4. Local Agent requests use the shared
  cancellation/timeout helper, including response-body reads.
- The exported package passed app/installer signatures, both architectures,
  app/team identity, embedded profile, entitlement, icon and privacy checks.
- A development-signed copy of the same executable opened successfully with the
  same App Sandbox/network permissions; Inbox and Settings were verified. No
  live provider action or login-item registration was performed.
- Apple confirmed the upload at **11:09 CEST** and completed processing. The
  macOS build is assigned to **Internal Testing** and reports **Testing**. The
  group has one tester and two active builds: iOS and macOS **0.1.0 (1)**. Xcode
  reported a non-blocking missing **dSYM** warning: detailed native crash
  symbolication is unavailable for this first build. Retain matching debug
  symbols in future release archives.
- Full repository tests with a disposable PostgreSQL database: **101 passed, 0
  failed**. Desktop/API checks, lint, formatting and universal compilation
  passed.

## Install and connect

Accept the invitation for the existing internal tester account and use
**TestFlight on the Mac**. The Local Agent must be installed and running
separately. In Settings, enter its localhost URL (default
`http://127.0.0.1:7431`) and the token from `~/.pmai-agent/local-token` once.
The App Store sandbox cannot automatically read this file from the user's real
home directory; the token is subsequently stored in macOS Keychain.

The cloud server is optional for local work. On 2026-09-20,
`https://promptwaypoint.com/health` and `/api/revision` returned HTTP 404. Cloud
features need a working server and account token. Connecting repositories and
provider profiles happens through the Local Agent, which owns provider access.

The final TestFlight installation, Keychain round trip, live local operations,
notifications, login launch and behavior on an Intel Mac still need device QA.
The local launch check does not substitute for testing the Apple-distributed
app.

## Repeat the release

The next build adds a native project folder picker in Settings. Its source
entitlements include read-only access to user-selected files for the sandboxed
dialog. The Local Agent still owns project access and execution. Verify folder
selection, cancellation and adding a repository in the next signed build; the
build 1 validation above predates this change.

Install both Rust targets once:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

Before the next upload, increment `bundle.macOS.bundleVersion` in
`src-tauri/tauri.appstore.conf.json`. From `apps/desktop`:

```sh
deno task macos:build:store
deno task macos:archive APPLE_DISTRIBUTION_SHA1 TEAM_ID
```

Use the actual identity returned by `security find-identity -v -p codesigning`.
The archiver verifies source/bundle version, minimum OS, universal
architectures, SDK linkage and privacy resources, then signs a staged copy. It
adds metadata from the actual installed Xcode and SDK and refuses to overwrite
an existing archive. Preserve earlier release archives before starting another
release.

An existing Mac App Store profile can be supplied with
`--profile /path/to/app.provisionprofile`; its platform, app/team, expiration
and signing certificate are checked. Otherwise, Xcode can create the profile
during automatic export using the signed-in developer account. A provisioning
profile must be present in the exported app for TestFlight.

```sh
xcodebuild -exportArchive \
  -archivePath "src-tauri/target/testflight/Prompt Waypoint.xcarchive" \
  -exportPath src-tauri/target/testflight/final \
  -exportOptionsPlist src-tauri/target/testflight/ExportOptions.plist \
  -allowProvisioningUpdates

deno task macos:package:check \
  "src-tauri/target/testflight/final/Prompt Waypoint.pkg" TEAM_ID
```

The package requires an **Apple Distribution** app identity and a **Mac
Installer Distribution** installer identity (displayed in Keychain as
`3rd Party Mac
Developer Installer`). Developer ID certificates serve a
different distribution channel. Profiles and signing keys are not committed to
the repository.

Upload via Xcode with a copy of `ExportOptions.plist` whose `destination` is
`upload`, retaining `manageAppVersionAndBuildNumber=false`, or upload the
verified package with Transporter. Wait for processing, then assign the macOS
build to **Internal Testing**. Automatic group distribution is disabled, so each
build must be assigned explicitly. Do not submit the public distribution draft
for review as part of this internal beta workflow.

## Release artifacts and references

- Archive: `src-tauri/target/testflight/Prompt Waypoint.xcarchive`
- Installer: `src-tauri/target/testflight/final/Prompt Waypoint.pkg`
- [macOS privacy inventory](src-tauri/appstore/PRIVACY.md)
- [App Store Connect / TestFlight](https://appstoreconnect.apple.com/teams/67971fc9-3638-4a56-b9d2-811f661fcdaf/apps/6814106323/testflight)
- [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/)
- [Apple provisioning profiles](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
- [Apple SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)
