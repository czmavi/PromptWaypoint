#!/usr/bin/env python3
"""Validate the actual signed Mac App Store package before uploading it."""

import argparse
import datetime
import hashlib
import json
import plistlib
import subprocess
import tempfile
from pathlib import Path


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("team")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "src-tauri"
    config = json.loads((root / "tauri.conf.json").read_text())
    store = json.loads((root / "tauri.appstore.conf.json").read_text())
    signature = subprocess.check_output(
        ["pkgutil", "--check-signature", str(args.package.resolve())], text=True
    )
    require("3rd Party Mac Developer Installer:" in signature and
            f"({args.team})" in signature, "Package requires the team's Mac Installer Distribution signature.")
    with tempfile.TemporaryDirectory(prefix="pmai-macos-check-") as temporary:
        folder = Path(temporary)
        subprocess.run(["pkgutil", "--expand-full", str(args.package.resolve()),
                        str(folder / "package")], check=True)
        apps = list((folder / "package").rglob("*.app"))
        require(len(apps) == 1, "Expected exactly one app, without nested applications.")
        app = apps[0]
        contents = app / "Contents"
        info = plistlib.loads((contents / "Info.plist").read_bytes())
        for key, value in {
            "CFBundleIdentifier": config["identifier"],
            "CFBundleShortVersionString": config["version"],
            "CFBundleVersion": store["bundle"]["macOS"]["bundleVersion"],
            "LSMinimumSystemVersion": config["bundle"]["macOS"]["minimumSystemVersion"],
            "CFBundleSupportedPlatforms": ["MacOSX"],
            "ITSAppUsesNonExemptEncryption": False,
        }.items():
            require(info.get(key) == value, f"Unexpected {key}: {info.get(key)!r}")
        binary = contents / "MacOS" / info["CFBundleExecutable"]
        architectures = subprocess.check_output(["lipo", "-archs", str(binary)], text=True).split()
        require(set(architectures) == {"x86_64", "arm64"}, "Both Mac architectures are required.")
        subprocess.run(["codesign", "--verify", "--all-architectures", "--deep", "--strict",
                        str(app)], check=True)
        expected = plistlib.loads((root / "appstore/Entitlements.plist").read_bytes())
        expected.update({
            "com.apple.application-identifier": f"{args.team}.{config['identifier']}",
            "com.apple.developer.team-identifier": args.team,
        })
        for arch in architectures:
            signed = plistlib.loads(subprocess.check_output(
                ["codesign", "-d", "--arch", arch, "--entitlements", ":-", str(app)],
                stderr=subprocess.DEVNULL,
            ))
            require(signed == expected, f"Unexpected signed {arch} entitlements: {signed}")
        profile = plistlib.loads(subprocess.check_output(
            ["security", "cms", "-D", "-i", str(contents / "embedded.provisionprofile")]
        ))
        require(profile.get("Platform") == ["OSX"] and not profile.get("ProvisionedDevices")
                and not profile.get("ProvisionsAllDevices"), "Expected a Mac App Store profile.")
        require(profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                "The profile has expired.")
        for key in ("com.apple.application-identifier", "com.apple.developer.team-identifier"):
            require(profile["Entitlements"].get(key) == expected[key], f"Profile mismatch: {key}")
        certificate = folder / "signer"
        subprocess.run(["codesign", "-d", f"--extract-certificates={certificate}", str(app)],
                       check=True, stderr=subprocess.DEVNULL)
        digest = hashlib.sha256(certificate.with_name("signer0").read_bytes()).digest()
        require(digest in {hashlib.sha256(cert).digest() for cert in profile["DeveloperCertificates"]},
                "Profile does not authorize the application's signing certificate.")
        require(plistlib.loads((contents / "Resources/PrivacyInfo.xcprivacy").read_bytes()) ==
                plistlib.loads((root / "appstore/PrivacyInfo.xcprivacy").read_bytes()),
                "Privacy manifest differs from source.")
        require((contents / "Resources" / info["CFBundleIconFile"]).is_file(), "App icon is missing.")
        require(not list(contents.rglob("*.a")), "A static library was accidentally packaged.")
        print(f"Validated {config['productName']} {info['CFBundleShortVersionString']} ({info['CFBundleVersion']}).")
        print(f"Universal Mac app, macOS {info['LSMinimumSystemVersion']}+, sandbox + outgoing network + user-selected read-only files.")
        print(f"App/installer signatures, team/profile, resources and privacy manifest passed: {args.package}")


if __name__ == "__main__":
    main()
