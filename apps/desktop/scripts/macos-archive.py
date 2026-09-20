#!/usr/bin/env python3
"""Prepare an Xcode archive from the universal Tauri App Store build; no upload."""

import argparse
import datetime
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("identity", help="Installed Apple Distribution identity SHA-1")
    parser.add_argument("team", help="Apple Developer team ID")
    parser.add_argument("--profile", type=Path, help="Optional existing Mac App Store profile")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "src-tauri"
    config = json.loads((root / "tauri.conf.json").read_text())
    store = json.loads((root / "tauri.appstore.conf.json").read_text())
    product = config["productName"]
    source = root / "target/universal-apple-darwin/release/bundle/macos" / f"{product}.app"
    build = root / "target/testflight"
    build.mkdir(parents=True, exist_ok=True)
    archive = build / f"{product}.xcarchive"
    if archive.exists():
        raise SystemExit(f"Archive already exists: {archive}. Move it aside before creating another.")
    if not re.fullmatch(r"[A-Fa-f0-9]{40}", args.identity):
        raise SystemExit("Use an installed signing identity's SHA-1 to avoid name/locale ambiguity.")
    identities = output("security", "find-identity", "-v", "-p", "codesigning")
    if not any(args.identity.upper() in line and "Apple Distribution:" in line
               and f"({args.team})" in line for line in identities.splitlines()):
        raise SystemExit("Matching Apple Distribution identity/team is not installed.")
    with tempfile.TemporaryDirectory(prefix="macos-archive-", dir=build) as temp:
        staged = Path(temp) / archive.name
        app = staged / "Products/Applications" / source.name
        shutil.copytree(source, app, symlinks=True)
        contents = app / "Contents"
        info_path = contents / "Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        expected = {
            "CFBundleIdentifier": config["identifier"],
            "CFBundleShortVersionString": config["version"],
            "CFBundleVersion": store["bundle"]["macOS"]["bundleVersion"],
            "LSMinimumSystemVersion": config["bundle"]["macOS"]["minimumSystemVersion"],
            "LSApplicationCategoryType": "public.app-category.productivity",
            "ITSAppUsesNonExemptEncryption": False,
        }
        for key, value in expected.items():
            if info.get(key) != value:
                raise SystemExit(f"Unexpected {key}: {info.get(key)!r}, expected {value!r}")
        binary = contents / "MacOS" / info["CFBundleExecutable"]
        architectures = output("lipo", "-archs", str(binary)).split()
        if set(architectures) != {"arm64", "x86_64"}:
            raise SystemExit(f"Expected a universal binary, got {architectures}")
        if list(contents.rglob("*.dylib")) or list(contents.rglob("*.framework")):
            raise SystemExit("Nested code requires explicit inside-out signing support.")
        manifest = contents / "Resources/PrivacyInfo.xcprivacy"
        if plistlib.loads(manifest.read_bytes()) != plistlib.loads(
            (root / "appstore/PrivacyInfo.xcprivacy").read_bytes()
        ):
            raise SystemExit("Bundled privacy manifest differs from source.")
        sdk = output("xcrun", "--sdk", "macosx", "--show-sdk-version")
        load_commands = output("xcrun", "vtool", "-show-build", str(binary))
        if len(re.findall(r"platform MACOS", load_commands)) != 2 or len(
            re.findall(r"sdk " + re.escape(sdk) + r"\b", load_commands)
        ) != 2:
            raise SystemExit("Both binary slices must have been linked with the selected macOS SDK.")
        xcode = output("xcodebuild", "-version").splitlines()
        version = [int(n) for n in xcode[0].split()[1].split(".")]
        info.update({
            "CFBundleSupportedPlatforms": ["MacOSX"],
            "DTPlatformName": "macosx",
            "DTPlatformVersion": sdk,
            "DTSDKName": f"macosx{sdk}",
            "DTSDKBuild": output("xcrun", "--sdk", "macosx", "--show-sdk-build-version"),
            "DTXcode": f"{version[0]:02}{version[1] if len(version) > 1 else 0}0",
            "DTXcodeBuild": xcode[1].split()[-1],
            "BuildMachineOSBuild": output("sw_vers", "-buildVersion"),
        })
        info_path.write_bytes(plistlib.dumps(info))
        entitlements = plistlib.loads((root / "appstore/Entitlements.plist").read_bytes())
        entitlements.update({
            "com.apple.application-identifier": f"{args.team}.{config['identifier']}",
            "com.apple.developer.team-identifier": args.team,
        })
        if args.profile:
            profile = plistlib.loads(subprocess.check_output(
                ["security", "cms", "-D", "-i", str(args.profile.resolve())]
            ))
            allowed = profile["Entitlements"]
            if ("OSX" not in profile.get("Platform", []) or profile.get("ProvisionedDevices")
                    or profile.get("ProvisionsAllDevices") or allowed.get("com.apple.security.get-task-allow")):
                raise SystemExit("Expected a Mac App Store distribution profile.")
            if args.identity.upper() not in {
                hashlib.sha1(cert).hexdigest().upper() for cert in profile["DeveloperCertificates"]
            }:
                raise SystemExit("The profile does not authorize the selected distribution certificate.")
            if profile["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
                raise SystemExit("Provisioning profile expired.")
            for key in ("com.apple.application-identifier", "com.apple.developer.team-identifier"):
                if allowed.get(key) != entitlements[key]:
                    raise SystemExit(f"Profile mismatch: {key}")
            shutil.copy2(args.profile, contents / "embedded.provisionprofile")
        entitlements_path = Path(temp) / "entitlements.plist"
        entitlements_path.write_bytes(plistlib.dumps(entitlements))
        subprocess.run(["codesign", "--force", "--sign", args.identity, "--options", "runtime",
                        "--entitlements", str(entitlements_path), str(app)], check=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        (staged / "Info.plist").write_bytes(plistlib.dumps({
            "ArchiveVersion": 2,
            "CreationDate": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
            "Name": product,
            "SchemeName": "desktop",
            "ApplicationProperties": {
                "ApplicationPath": f"Applications/{app.name}",
                "Architectures": architectures,
                "CFBundleIdentifier": config["identifier"],
                "CFBundleShortVersionString": info["CFBundleShortVersionString"],
                "CFBundleVersion": info["CFBundleVersion"],
                "SigningIdentity": args.identity,
                "Team": args.team,
            },
        }))
        export = {
            "method": "app-store-connect", "destination": "export",
            "teamID": args.team, "signingStyle": "automatic",
            "manageAppVersionAndBuildNumber": False,
        }
        (build / "ExportOptions.plist").write_bytes(plistlib.dumps(export))
        staged.rename(archive)
    print(f"Archive ready: {archive}")
    print("Use xcodebuild -exportArchive with target/testflight/ExportOptions.plist and -allowProvisioningUpdates.")
    print("Validate the exported package and its entitlements before uploading.")


if __name__ == "__main__":
    main()
