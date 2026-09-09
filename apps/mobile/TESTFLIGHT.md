# PM.ai — first Internal TestFlight release

## Repository preparation

**Identity:** PM.ai, `com.caretsix.aiproductmanager`, iOS 15.0+, marketing
version **0.1.0**, build **1**. This document does not certify a signed archive
or a successful upload. No Apple account operations were performed.

Canonical iOS settings are in `src-tauri/tauri.ios.conf.json`. Tauri merges this
over `tauri.conf.json`; the base identifier is retained for the existing Android
application and is not the effective iOS identifier. Internal crate, directory,
scheme and target names remain `mobile` / `mobile_iOS`.

`bundle.iOS.template` points to `src-tauri/ios/project.yml.hbs`, relative to the
mobile application directory as required by the installed CLI. This template
preserves automatic signing, display name, URL scheme, export declaration and
APNs configuration when running `deno task tauri ios init`. Its version and
deployment values come from Tauri. The CocoaPods `Podfile` reads the minimum
version from the same Tauri iOS configuration. The optional team comes from
`APPLE_DEVELOPMENT_TEAM` or `bundle.iOS.developmentTeam`; none is committed.

The generated entitlement contains `$(PMAI_APNS_ENVIRONMENT)`. Xcode resolves
that build setting to `development` in Debug and `production` in Release. The
raw entitlement file is a template, not proof of the signed entitlement. Keep
the generated `ExportOptions.plist` using `debugging` for local device exports.
For uploads, use Organizer or explicitly choose `app-store-connect`; do not
reuse the debugging export options. Xcode 26.2 supports this method.
`release-testing` is ad-hoc distribution, not an App Store Connect upload.

For subsequent uploads change only `bundle.iOS.bundleVersion` in
`tauri.ios.conf.json` to `"2"`, `"3"`, etc. Keep `version: "0.1.0"` unless
changing the marketing version intentionally. Regenerate and verify the plist
before building. Do not use `0.1.0` as the build number or rely on CLI
`--build-number` suffix behavior.

From the repository root:

```sh
deno install
deno fmt
deno lint
deno check
deno task test
# Include PostgreSQL integration and server build/reload tests:
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
```

From `apps/mobile`:

```sh
deno task tauri ios init --ci
deno task ios:check
deno task build
# Release, archive only, then open Xcode; requires configured signing/toolchain:
deno task ios:release
# Equivalent:
deno task tauri ios build --archive-only --open
# Optional explicit App Store Connect IPA export:
deno task ios:export
# Normal CLI Release build is also supported after signing setup:
deno task tauri ios build
```

`ios:check` validates regenerated plist values, both signing configurations, the
`pmai` scheme, launch-screen reference, and all 18 icon PNG entries and
dimensions, including the 1024×1024 App Store icon. The marketing PNG has no
alpha channel. The template artwork has been replaced by a generated PM.ai mark:
stacked task cards with a forward/run symbol, in forest green, ivory and sage.
The original master and generation prompt are in `assets/branding/`; canonical
iOS sizes are in `src-tauri/icons/ios/`. The iOS before-build hook runs
`ios:icons:sync` to restore them into the generated asset catalog. Run that task
after `tauri ios init` when validating without building.

The Swift plugin retains APNs permission/registration, token delivery,
foreground notifications, notification taps and durable pending taps for cold
starts. There is one notification delegate bridge. Keychain service was
normalized to `com.caretsix.aiproductmanager.companion-auth` before the first
release. Existing development installs using the former service must sign in
again. The provider credentials remain on the Local Agent and never enter the
mobile application.

Encryption review: the iOS normal Rust dependency tree, native plugin and client
code use platform Security/Keychain, WebKit HTTPS/TLS and hashing (SHA-256). No
custom encryption algorithm, VPN, end-to-end encrypted messaging or bundled
non-platform TLS implementation was found in the iOS dependency tree. The
Android Keystore implementation is not linked into iOS; APNs ES256 signing is
server-only. On that inspected basis the canonical template sets
`ITSAppUsesNonExemptEncryption=false`. Reassess if cryptographic dependencies or
features change. See
[Apple's declaration guidance](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption).

The server now signs APNs JWTs using an external `.p8` key, ES256, configured
Key ID and Team ID. It reuses a token for 50 minutes and coalesces concurrent
requests, instead of signing every push. It rereads the key at renewal; restart
when changing Key ID/Team ID. Keep the host clock synchronized. Configure these
server-only variables via deployment secret storage:

```text
PMAI_APNS_KEY_FILE       path to the mounted .p8 private key
PMAI_APNS_KEY_ID         actual Apple Key ID
PMAI_APNS_TEAM_ID        actual Apple Team ID
PMAI_APNS_TOPIC=com.caretsix.aiproductmanager
PMAI_APNS_SANDBOX=false
```

The key file should be readable only by the server account, mounted read-only
and never copied into the repository or app. The obsolete `PMAI_APNS_TOKEN_FILE`
is rejected. Debug APNs needs a separate server environment with
`PMAI_APNS_SANDBOX=true`; TestFlight uses production APNs. See
[server configuration](../server/README.md) and
[Apple's token authentication requirements](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).

After installing the iOS platform, the unsigned Release archive and LaunchScreen
compilation succeeded (2026-09-09). The archive is
`src-tauri/gen/apple/build/mobile_iOS.xcarchive`. Its application plist confirms
PM.ai, `com.caretsix.aiproductmanager`, version 0.1.0/build 1, iOS 15.0, `pmai`
deep links and the encryption declaration. This archive was built with
`--no-sign`: it is not a validated distribution archive and was not uploaded.
Signing, production APNs delivery and the final Organizer upload still require
the manual steps below. To repeat the launch-screen check:

```sh
xcrun ibtool --compile /tmp/PMai-LaunchScreen.storyboardc \
  src-tauri/gen/apple/LaunchScreen.storyboard \
  --sdk iphoneos --minimum-deployment-target 15.0
```

The Release Rust/Swift SDK-only check passed, including the native push plugin,
with the following command. It does not validate the final app link, storyboard,
signing, archive or delivery:

```sh
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo check --release \
  --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios
```

Files changed for this release preparation (paths relative to the repository):

| File                                                                             | Change                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.gitignore`                                                                     | Ignore Apple signing credentials and APNs keys.                          |
| `apps/mobile/README.md`                                                          | Link current iOS release settings and checklist.                         |
| `apps/mobile/TESTFLIGHT.md`                                                      | Release workflow, verification and manual Apple steps.                   |
| `apps/mobile/deno.json`                                                          | Add ios:check, ios:release and ios:export tasks.                         |
| `apps/mobile/scripts/ios-check.ts`                                               | Validate canonical/generated settings and PNG dimensions.                |
| `apps/mobile/src-tauri/tauri.conf.json`                                          | Raise base iOS deployment target to 15.0.                                |
| `apps/mobile/src-tauri/tauri.ios.conf.json`                                      | Set PM.ai, version/build and canonical iOS template.                     |
| `apps/mobile/src-tauri/ios/project.yml.hbs`                                      | Preserve signing, APNs environments, plist and version settings on init. |
| `apps/mobile/src-tauri/gen/apple/project.yml`                                    | Regenerated XcodeGen configuration.                                      |
| `apps/mobile/src-tauri/gen/apple/mobile.xcodeproj/project.pbxproj`               | Regenerated Debug/Release build settings.                                |
| `apps/mobile/src-tauri/gen/apple/mobile_iOS/Info.plist`                          | Regenerated identity, version, scheme and encryption declaration.        |
| `apps/mobile/src-tauri/gen/apple/mobile_iOS/mobile_iOS.entitlements`             | Resolve APNs environment from Debug/Release build setting.               |
| `apps/mobile/src-tauri/gen/apple/Podfile`                                        | Read minimum iOS version from canonical Tauri settings.                  |
| `apps/mobile/src-tauri/companion-native/ios/Package.swift`                       | Swift tools 5.5 and minimum iOS 15.                                      |
| `apps/mobile/src-tauri/companion-native/ios/Sources/CompanionNativePlugin.swift` | Normalize the first-release Keychain service identity.                   |
| `apps/server/src/push/apns_token.ts`                                             | ES256 token generation, caching and renewal.                             |
| `apps/server/src/runtime.ts`                                                     | Wire .p8 configuration into the existing APNs provider.                  |
| `apps/server/tests/apns_token_test.ts`                                           | Verify signatures, claims, caching, renewal and redacted failures.       |
| `apps/server/README.md`                                                          | Document permanent APNs key configuration and rotation.                  |

## Manual Apple steps

1. In Apple Developer Portal, use an active Apple Developer Program membership.
   Register or select the explicit App ID `com.caretsix.aiproductmanager` and
   enable **Push Notifications**. Do not create a second identifier for this
   release.
2. Create an APNs signing key with access to this app's topic and production
   environment. Download its `.p8` file once, store it securely, and record the
   actual Key ID and Team ID for the server configuration above. Do not send
   private-key contents to clients or commit them.
3. In Xcode **Settings → Accounts**, add the authorized Apple account. In target
   `mobile_iOS → Signing & Capabilities`, select the correct Team and enable
   **Automatically manage signing** for Debug and Release. Retain Push
   Notifications. For regeneration, supply the same actual team through
   `APPLE_DEVELOPMENT_TEAM` in your shell or a local Tauri configuration. Allow
   Xcode to create the appropriate signing/provisioning assets.
4. In App Store Connect, create the iOS app **PM.ai** with bundle ID
   `com.caretsix.aiproductmanager`, selecting your own unique SKU and primary
   language. Complete required agreements and app information. Review the
   encryption declaration against the actual archive and app behavior.
5. Run the Release workflow above, open the generated project in Xcode, select
   the `mobile_iOS` scheme and a generic iOS device, confirm Archive uses
   **release**, then **Product → Archive**. In Organizer inspect the archived
   app before distributing. For the actual archive path, run:

   ```sh
   # Set PMAI_ARCHIVE to the actual .xcarchive path from Organizer.
   plutil -p "$PMAI_ARCHIVE/Products/Applications/PM.ai.app/Info.plist"
   codesign -d --entitlements :- \
     "$PMAI_ARCHIVE/Products/Applications/PM.ai.app"
   ```

   Verify identifier `com.caretsix.aiproductmanager`, display name `PM.ai`,
   version `0.1.0`, build `1`, minimum iOS 15.0, the `pmai` scheme and
   `ITSAppUsesNonExemptEncryption=false`. In the **signed** entitlements verify
   `aps-environment=production` and the expected application/team identity. The
   distribution export must not enable `get-task-allow`. Also inspect the
   exported app if Organizer re-signs it during distribution.
6. In Organizer choose **Distribute App → App Store Connect → Upload**. Resolve
   signing/validation issues, upload and wait for App Store Connect processing.
   No upload or signed archive has been performed by Codex.
7. Under **TestFlight**, provide any required test information, create an
   **Internal Testing** group and add eligible App Store Connect users. Assign
   the processed build and install it through TestFlight. On a real iPhone, test
   notification permission, production APNs delivery, warm/cold Task and Session
   taps and secure sign-in. No external beta onboarding is required.
