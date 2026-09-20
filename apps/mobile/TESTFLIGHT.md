# Prompt Waypoint — TestFlight release

Updated **2026-09-20**. Target: a first internal iPhone/iPad beta through
TestFlight. Public App Store release has additional onboarding, privacy and
review work recorded in the [earlier audit](../../testflight.md).

## Current status

- App: **Prompt Waypoint**, bundle ID `com.caretsix.aiproductmanager`, version
  **0.1.0**, build **1**, minimum **iOS/iPadOS 16.4**.
- Xcode **26.2** / iOS SDK **26.2**. Apple currently requires Xcode 26+ and the
  iOS 26+ SDK for uploads; the deployment minimum is a separate setting.
- Regeneration, 18 canonical icons, source configuration, production frontend,
  and a new **unsigned Release archive** all passed. The archive contains the
  privacy manifest, compiled icons and launch screen, and an arm64 executable.
- Repository format, lint and type checks passed. Full test suite with a
  temporary PostgreSQL database: **101 passed, 0 failed**.
- Valid Apple Development and Apple Distribution identities exist in the local
  keychain. A sandboxed identity query incorrectly reported none; signing/build
  commands need normal access to Xcode and the keychain.
- A **signed App Store IPA** was exported and passed local distribution checks:
  correct app/team, `aps-environment=production`, `get-task-allow=false`, valid
  signature, embedded distribution profile and privacy manifest. This used the
  profile-based route below, without registering a development device.
- App Store Connect app record **6814106323** was created with the user's
  approval: **Prompt Waypoint**, iOS, English (U.S.), SKU `prompt-waypoint-ios`.
  [Open TestFlight](https://appstoreconnect.apple.com/teams/67971fc9-3638-4a56-b9d2-811f661fcdaf/apps/6814106323/testflight).
  Apple confirmed a successful upload of **0.1.0 (1)** at 09:53 CEST and
  completed processing. No public App Store review or release has been
  requested.
- Internal group **Internal Testing** exists with automatic distribution
  disabled. The user's own App Store Connect account was added as the first
  internal tester with explicit approval. Build **0.1.0 (1)** is assigned and
  reports **Testing**; the group now has **1 tester and 2 builds** (iOS and
  [macOS](../desktop/TESTFLIGHT.md)). The tester's status is **Invited** as of
  10:01 CEST, ready to accept the invitation and install with TestFlight.
  Installation on a device has not yet been verified.
- The default server's `/health` and `/api/revision` returned **HTTP 404** from
  `https://promptwaypoint.com` on 2026-09-20. Provide a working HTTPS API there
  or connect the installed app to a different configured server. Device behavior
  and live APNs delivery remain unverified.

## Repeatable local preparation

From the repository root:

```sh
deno install
deno fmt --check
deno lint
deno check
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
```

From `apps/mobile`:

```sh
# Regenerate Xcode, restore the approved icons, validate source settings.
deno task ios:prepare
# Build an unsigned device archive and validate its actual contents.
deno task ios:build:unsigned
# Recheck an existing unsigned archive without rebuilding.
deno task ios:archive:check --unsigned
```

The archive is `src-tauri/gen/apple/build/mobile_iOS.xcarchive`; the app inside
is `Products/Applications/Prompt Waypoint.app`. This unsigned archive proves
packaging/build correctness, not TestFlight eligibility. Preserve its matching
`dSYMs` when keeping a release for crash symbolication.

`ios:check` checks identity, version/build, deployment targets, automatic
signing, Debug/Release APNs settings, deep links, privacy resource inclusion and
all canonical RGB icon images (including the 1024px App Store image).
`ios:archive:check` also reads the final application: platform/SDK/architecture,
version/minimum OS, privacy manifest equality, compiled assets, launch screen,
and absence of accidentally copied static libraries.

## Export without registering a development device

An App Store distribution profile is sufficient; registering an iPhone is not
required for this route. Use Python 3 and an **installed App Store Connect
provisioning profile** for this bundle ID with Push Notifications enabled. The
profile created during preparation expires on 2027-09-20. Its private signing
key stays in the macOS keychain.

After `ios:build:unsigned`, from `apps/mobile`:

```sh
deno task ios:export:profile "/secure/path/app-store.mobileprovision" \
  "Apple Distribution: Your Name (YOUR_TEAM_ID)"
```

Use the actual existing certificate identity (or SHA-1); inspect available
identities with `security find-identity -v -p codesigning`. macOS may ask for
permission to use its private key. Confirm in the system dialog, never put the
keychain password in a command or source file.

The exporter checks the profile's app/team, expiration, distribution type and
production APNs permission. It copies the unsigned archive, embeds the profile,
signs using explicit app entitlements and asks Xcode for a local App Store IPA.
It then validates the **exported** app before replacing these generated outputs:

- `src-tauri/gen/apple/build/testflight/Prompt Waypoint.ipa`
- `src-tauri/gen/apple/build/testflight-signed.xcarchive` (including dSYMs)

No upload is performed. The script stops for changed entitlements, embedded
frameworks or extensions so their signing can be reviewed. Exporting an unsigned
archive directly with Xcode is insufficient: it can silently omit the app's push
entitlement even when the embedded profile permits push.

The complete `ios:export:profile` workflow passed on 2026-09-20, including the
exported app's distribution signature and production push entitlement. It
supports both Xcode-managed and manually managed distribution profiles and
resolves certificate names to their SHA-1 identities to avoid locale problems
with accented names. The previous validated IPA is retained until every check on
a new export succeeds.

## Signing and the Apple app record

A registered **Bundle ID / App ID** in the Developer portal is distinct from an
**app record** in App Store Connect. The former identifies the app for signing
and capabilities; the latter holds builds, TestFlight and store data. Use the
existing identifier above in both places.

1. In [Apple Developer](https://developer.apple.com/account/), verify this App
   ID belongs to the intended paid team and has **Push Notifications** enabled.
2. In **Xcode → Settings → Accounts**, verify the membership and sign-in. Select
   that team in `mobile_iOS → Signing & Capabilities`. For automatic development
   signing, connect/register a real iPhone and let Xcode provision it.
   Alternatively, prepare an App Store Connect distribution profile for this App
   ID and the existing distribution certificate with manual signing;
   distribution profiles do not require registered test devices.
3. In [App Store Connect → Apps](https://appstoreconnect.apple.com/apps), find
   the existing app or create an **iOS** app named **Prompt Waypoint** using
   `com.caretsix.aiproductmanager`. Choose the actual primary language and a
   unique SKU. Resolve any required agreements in the account.
4. Confirm whether build **1** has already been uploaded. If so, increment
   `bundle.iOS.bundleVersion` in `src-tauri/tauri.ios.conf.json`, then run
   `ios:prepare` again. Use increasing integer strings (`"2"`, `"3"`, …). Only
   change the marketing `version` when intentional. Do not rely on the CLI
   `--build-number` suffix behavior.

Supply the verified team locally (do not copy the placeholder literally):

```sh
export APPLE_DEVELOPMENT_TEAM="YOUR_TEAM_ID"
deno task ios:prepare
# Archive and open Xcode for Organizer distribution:
deno task ios:release
# Or build and export an App Store Connect IPA:
deno task ios:export
```

The project template accepts the team from `APPLE_DEVELOPMENT_TEAM` or
`bundle.iOS.developmentTeam`. Regeneration without either clears a manually
selected team. Supply the same team on subsequent prepare/build commands. Do not
commit private keys, certificates or provisioning profiles.

For TestFlight use **app-store-connect**, not `release-testing` (ad hoc) or
`debugging`. The checked-in `ExportOptions.plist` remains for local debugging;
`ios:export` selects the distribution method explicitly. The installed Tauri CLI
help misleadingly labels `release-testing` as TestFlight.

## Validate, upload and test

1. Inspect the signed archive with `deno task ios:archive:check`. Xcode may use
   development signing for the archive and re-sign it during distribution.
2. For an exported IPA, extract it outside the repository and validate the
   `.app` under `Payload`:

   ```sh
   deno task ios:archive:check --distribution "/path/to/Payload/Prompt Waypoint.app"
   ```

   This verifies the code signature and signed app/team identity, and requires
   production APNs, disabled `get-task-allow` and an embedded profile. These are
   local checks, not a replacement for Apple's validation of the profile,
   account, privacy disclosures and uploaded build.
3. In Xcode Organizer choose **Distribute App → App Store Connect → Upload**,
   then wait for processing. Alternatively upload the exported IPA with Apple's
   Transporter. Do not distribute the unsigned archive.
4. Under **TestFlight**, complete required beta information and create an
   **Internal Testing** group with eligible App Store Connect users. Assign the
   processed build. An internal build can be tested for up to 90 days. External
   testers require a separate external group and may require Beta App Review; do
   not grant account access merely to make someone a tester.
5. Install via TestFlight on a real iPhone and iPad. Test cold start, secure
   sign-in to a reachable HTTPS server, token renewal, reconnect, offline
   capture/sync without duplicates, Run/Queue/Resume/reply, push permission, and
   warm/cold task/session notification links. Test the minimum iOS 16.4 WebView
   as well as a current version; unit tests do not replace device QA.

## Compatibility and privacy

Minimum iOS 16.4 matches Tailwind 4's Safari requirement. Vite explicitly
targets Safari 16.4 for JavaScript and CSS; both Tauri configurations, the
generated Xcode project and the Swift package agree. The shared API client uses
`AbortController` with a 15-second deadline and caller cancellation, including
response-body reads; it does not require `AbortSignal.any` (Safari 17.4+) or
`AbortSignal.timeout`. Timers/listeners are cleaned up after every request. The
deadline now applies to desktop server requests too.

`src-tauri/ios/PrivacyInfo.xcprivacy` is included through the permanent Xcode
project template. See the [API inventory](src-tauri/ios/PRIVACY.md) for the
UserDefaults and file timestamp reasons. App Privacy answers, privacy policy,
support contact and review access must reflect the real deployment before
external/public review. The required-reason manifest does not claim that the
hosted service collects no user data.

`ITSAppUsesNonExemptEncryption=false` is retained from the existing encryption
review: iOS uses platform Keychain/Security and WebKit HTTPS/TLS, plus SHA-256.
Provider credentials stay on the Local Agent; APNs signing is server-only.
Reassess the declaration when cryptographic features or dependencies change.

## Production push configuration

Release exports/TestFlight use production APNs. Debug uses development APNs. The
native entitlement is resolved through `PMAI_APNS_ENVIRONMENT`; verify the
signed exported application, not just the source entitlement.

Configure these **server-only** values with the actual APNs key and team:

```text
PMAI_APNS_KEY_FILE=/secure/path/to/AuthKey.p8
PMAI_APNS_KEY_ID=actual-key-id
PMAI_APNS_TEAM_ID=actual-team-id
PMAI_APNS_TOPIC=com.caretsix.aiproductmanager
PMAI_APNS_SANDBOX=false
```

Use a separate development environment with `PMAI_APNS_SANDBOX=true` for debug
installs. The server signs ES256 JWTs, reuses them for 50 minutes and coalesces
concurrent requests. Mount the key read-only through deployment secret storage;
never include it in the app/repository. Restart when changing the Key ID/Team
ID. The obsolete `PMAI_APNS_TOKEN_FILE` configuration is rejected. See the
[server guide](../server/README.md).

## Official references

- [Apple SDK upload requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/)
- [Tailwind compatibility](https://tailwindcss.com/docs/compatibility)
- [WebKit: AbortSignal.any in Safari 17.4](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)
