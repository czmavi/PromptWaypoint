"""Export a TestFlight IPA with an existing App Store profile, without a device."""

import argparse
import datetime
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile


def run(*args, capture=False):
    return subprocess.run(args, check=True, capture_output=capture).stdout


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path, help="Installed App Store .mobileprovision")
    parser.add_argument("identity", help="Existing Apple Distribution identity or SHA-1")
    args = parser.parse_args()
    mobile = Path(__file__).resolve().parents[1]
    root = mobile / "src-tauri"
    config = json.loads((root / "tauri.ios.conf.json").read_text())
    build = root / "gen/apple/build"
    source = build / "mobile_iOS.xcarchive"
    profile_bytes = args.profile.resolve().read_bytes()
    profile = plistlib.loads(run("security", "cms", "-D", "-i", str(args.profile.resolve()), capture=True))
    allowed = profile["Entitlements"]
    team = allowed["com.apple.developer.team-identifier"]
    app_id = allowed["application-identifier"]
    require(team in profile["TeamIdentifier"], "Profile has inconsistent team identifiers")
    require(app_id.endswith("." + config["identifier"]), "Profile belongs to another app")
    require(allowed.get("aps-environment") == "production", "Profile must enable production push")
    require(allowed.get("get-task-allow") is False, "Use a distribution profile")
    require(allowed.get("beta-reports-active") is True, "Profile must support TestFlight")
    require("ProvisionedDevices" not in profile and not profile.get("ProvisionsAllDevices"),
            "Use an App Store profile, not ad hoc or enterprise")
    require(profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc),
            "Provisioning profile has expired")
    identities = run("security", "find-identity", "-v", "-p", "codesigning", capture=True).decode()
    matches = [(digest, name) for digest, name in re.findall(r'\) ([0-9A-F]{40}) "([^"]+)"', identities)
               if args.identity.upper() == digest or args.identity == name]
    require(len(matches) == 1, "Choose one exact available signing identity or SHA-1")
    identity_hash, identity_name = matches[0]
    require(identity_name.startswith("Apple Distribution:"), "Use an Apple Distribution certificate")
    require(identity_hash in {hashlib.sha1(cert).hexdigest().upper() for cert in profile["DeveloperCertificates"]},
            "Provisioning profile does not authorize this signing certificate")
    canonical = plistlib.loads((root / "gen/apple/mobile_iOS/mobile_iOS.entitlements").read_bytes())
    require(canonical == {"aps-environment": "$(PMAI_APNS_ENVIRONMENT)"},
            "App entitlements changed; review this signing workflow before exporting")
    run("deno", "run", "--allow-read", "--allow-run=plutil,codesign,lipo",
        str(mobile / "scripts/ios-archive-check.ts"), "--unsigned", str(source))

    # Work on a copy; keep the original unsigned archive and dSYMs intact.
    with tempfile.TemporaryDirectory(prefix="pmai-testflight-") as directory:
        temp = Path(directory)
        archive = temp / "mobile_iOS.xcarchive"
        run("ditto", str(source), str(archive))
        apps = list((archive / "Products/Applications").glob("*.app"))
        require(len(apps) == 1, "Expected one archived application")
        app = apps[0]
        require(not (app / "Frameworks").exists() and not (app / "PlugIns").exists(),
                "Nested code added; review inside-out signing before exporting")
        (app / "embedded.mobileprovision").write_bytes(profile_bytes)
        entitlements = {key: allowed[key] for key in (
            "application-identifier", "com.apple.developer.team-identifier",
            "beta-reports-active", "get-task-allow", "aps-environment",
        )}
        entitlements_path = temp / "entitlements.plist"
        entitlements_path.write_bytes(plistlib.dumps(entitlements))
        # A digest avoids codesign's locale-dependent handling of accented names.
        run("codesign", "--force", "--sign", identity_hash, "--entitlements",
            str(entitlements_path), "--generate-entitlement-der", str(app))
        archive_info = plistlib.loads((archive / "Info.plist").read_bytes())
        archive_info["ApplicationProperties"]["SigningIdentity"] = identity_name
        archive_info["ApplicationProperties"]["Team"] = team
        (archive / "Info.plist").write_bytes(plistlib.dumps(archive_info))
        options = temp / "ExportOptions.plist"
        export_options = {
            "method": "app-store-connect", "destination": "export", "teamID": team,
            "signingCertificate": identity_hash,
            "manageAppVersionAndBuildNumber": False,
        }
        if profile.get("IsXcodeManaged"):
            export_options["signingStyle"] = "automatic"
        else:
            export_options["signingStyle"] = "manual"
            export_options["provisioningProfiles"] = {config["identifier"]: profile["UUID"]}
        options.write_bytes(plistlib.dumps(export_options))
        exported = temp / "export"
        run("xcodebuild", "-exportArchive", "-archivePath", str(archive),
            "-exportPath", str(exported), "-exportOptionsPlist", str(options))
        ipas = list(exported.glob("*.ipa"))
        require(len(ipas) == 1, "Expected one exported IPA")
        extracted = temp / "extracted"
        run("ditto", "-x", "-k", str(ipas[0]), str(extracted))
        run("deno", "run", "--allow-read", "--allow-run=plutil,codesign,lipo",
            str(mobile / "scripts/ios-archive-check.ts"), "--distribution",
            str(extracted / "Payload" / app.name))
        # Publish generated artifacts only after the exported signature passes.
        for source_path, name in ((archive, "testflight-signed.xcarchive"), (exported, "testflight")):
            destination = build / name
            if destination.exists():
                shutil.rmtree(destination)
            run("ditto", str(source_path), str(destination))
        print(f"Verified TestFlight package: {build / 'testflight' / ipas[0].name}")
        print("No upload performed. App Store Connect processing and device testing remain.")


if __name__ == "__main__":
    main()
