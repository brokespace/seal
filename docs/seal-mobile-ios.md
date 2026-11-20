# Seal Mobile on your iPhone

Seal Mobile (`mobile/`, bundle id `com.brokespace.seal.mobile`, URL scheme `seal://`) isn't on the App Store. You build it yourself, either as a **dev client** (Debug, connected iPhone, sandbox push) or as an **ad-hoc** Release IPA (registered devices, production push). Neither path needs EAS or an Expo account.

## What you need to provide

| Item                                               | Where it comes from                                                                                                                           | Used for                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program membership (paid)          | developer.apple.com                                                                                                                           | Push notifications and ad-hoc signing (free Apple IDs cannot use APNs)                                        |
| Apple **Team ID** (10 characters)                  | developer.apple.com → Membership details                                                                                                      | `SEAL_APPLE_TEAM_ID` for signing                                                                              |
| Xcode signed in with that Apple ID                 | Xcode → Settings → Accounts                                                                                                                   | Automatic signing / `-allowProvisioningUpdates`                                                               |
| **APNs auth key** `.p8`, its **Key ID**            | developer.apple.com → Certificates, IDs & Profiles → Keys → + → "Apple Push Notifications service (APNs)", environment "Sandbox & Production" | The relay Worker's `APNS_PRIVATE_KEY` / `APNS_KEY_ID` / `APNS_TEAM_ID` secrets (`cloud/seal-relay/deploy.md`) |
| iPhone with **Developer Mode** on, UDID registered | Settings → Privacy & Security → Developer Mode; Xcode registers a connected device automatically                                              | Installing dev and ad-hoc builds                                                                              |
| Mac with Xcode 26+, CocoaPods, Node 22+, pnpm      |                                                                                                                                               | Building                                                                                                      |
| Deployed Seal relay (optional for LAN-only use)    | `cloud/seal-relay/deploy.md`                                                                                                                  | Remote access and push                                                                                        |

The App ID `com.brokespace.seal.mobile` with the Push Notifications capability is created by Xcode automatic signing on the first build. If your team disallows that, create it by hand under Identifiers and enable Push Notifications.

## Build

```bash
pnpm install            # repo root
cd mobile && pnpm install

# Dev client on a connected iPhone (Debug, sandbox APNs). Then run Metro with `pnpm start`.
SEAL_APPLE_TEAM_ID=ABCDE12345 node scripts/seal-ios-build.mjs dev
SEAL_APPLE_TEAM_ID=ABCDE12345 node scripts/seal-ios-build.mjs dev --device "Brian's iPhone"

# Ad-hoc Release IPA (production APNs) for registered devices; --install pushes it over USB/Wi-Fi.
SEAL_APPLE_TEAM_ID=ABCDE12345 node scripts/seal-ios-build.mjs adhoc
SEAL_APPLE_TEAM_ID=ABCDE12345 node scripts/seal-ios-build.mjs adhoc --install <device-udid>
```

For TestFlight, `testflight` archives the same Release build and uploads it to App Store Connect. It signs with an App Store Connect API key (role Admin, so Xcode can create the distribution certificate), so it doesn't need an Xcode account session. Raise `expo.ios.buildNumber` in `mobile/app.json` before each upload.

```bash
SEAL_APPLE_TEAM_ID=ABCDE12345 ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8 \
  ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=<issuer-uuid> node scripts/seal-ios-build.mjs testflight
```

The App Store Connect app record for the bundle id has to exist before the first upload.

`xcrun devicectl list devices` shows UDIDs. The ad-hoc IPA lands in `mobile/build/ios-adhoc/Seal.ipa`, and you can also install it with Apple Configurator.

`ORCA_IOS_APS_ENVIRONMENT` picks the `aps-environment` entitlement. The script sets `development` for `dev` and `production` for `adhoc`. The app reports the matching APNs environment when it registers for push, and the relay Worker sends each device to the matching APNs host.

## Pair

1. On the desktop (the Seal app), open Settings → Mobile and show the pairing QR code.
2. In Seal Mobile, tap **Pair** and scan it. On the same LAN, the phone connects directly. Off-LAN, it goes through `relay.seal.wotarmelon.com`, end-to-end encrypted.
3. Allow notifications when asked. The desktop registers the phone's push token with `push.seal.wotarmelon.com`.

**Without the relay:** on the desktop, pick **LAN** as the connection in Settings → Mobile. For a headless host, run `seal serve --bind <LAN or Tailscale IP> --mobile-pairing` (or `seal pair --mobile` without `--relay`). The QR code then holds only the direct `ws://` address, ranking a Tailscale address first, and the phone never contacts the relay. Without the push service, the host refuses push registration, so the phone shows "your turn" and other alerts as local notifications from its live connection. That works while Seal is open or was just backgrounded. Once iOS suspends the app, nothing arrives until you open it again.

Headless hosts pair the same way: run `seal serve --mobile-pairing` and scan the printed QR code, or run `seal pair` later. `seal serve` joins the Seal relay with its own pairing key, so you can reach it off-LAN without a desktop.

## Troubleshooting

- **No push on a dev build:** dev builds get sandbox tokens. Make sure the APNs key covers Sandbox.
- **No push on an ad-hoc build:** rebuild with the `adhoc` mode so the entitlement says `production`.
- **"No profiles for com.brokespace.seal.mobile":** open Xcode once, sign in under Accounts, and re-run. `-allowProvisioningUpdates` needs that session.
- **Device not registered (ad-hoc):** connect the iPhone and run the `dev` mode once, or add its UDID under Devices in the developer portal. Then rebuild ad-hoc.
