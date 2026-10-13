# Security policy

noor-frame runs in people's homes and holds family calendars and API keys, so we
take security reports seriously.

## Reporting a vulnerability

Please **don't open a public issue.** Report it privately through GitHub:
**[Report a vulnerability](https://github.com/rosman21/noor-frame/security/advisories/new)**
(the repository's **Security** tab, then **Report a vulnerability**).

Include:

- what's affected (server, dashboard, companion, Pi tooling, Android app or
  frame tooling) and which version or commit;
- steps to reproduce, and what an attacker could do;
- whether it needs network access, a phone on the home Wi-Fi, or physical access.

We aim to acknowledge reports within a week and to agree a disclosure date with
you. We'll credit you in the release notes unless you'd rather we didn't.

## Supported versions

This is an early project. Security fixes go to the latest `main` only.

## How noor-frame is meant to be deployed

Knowing the model helps judge what counts as a vulnerability.

- **Run the server on your home network.** Reading the dashboard needs no key,
  because screens on the wall have no way to sign in. Anyone who can reach the
  server can see what the dashboard shows, including calendar events. Don't
  expose it to the internet without an authenticating proxy, such as Cloudflare
  Access.
- **Changing anything needs an approved device.** Each screen and phone has its
  own random key; only a hash of it is stored.
  - Screens on a private network address are approved automatically, unless
    `NOOR_AUTO_APPROVE=0` is set.
  - Phones are approved by scanning a short-lived QR code on an approved screen.
- **API keys are encrypted at rest** (AES-GCM, with `FRAME_SECRET` or
  `data/secret.key`). Only their last four characters are ever sent back, and
  screens never receive them.
- **Outside services:** the server calls only the services its enabled
  integrations need. The ayah recitation relay only serves the current ayah's
  audio; it isn't a general proxy.

## Hardware notes

- **Rooted frames.** The Android frame route turns on root ADB over USB. Anyone
  with physical access to the frame's USB port can control it.
- **AiMOR.** On the tested firmware, the stock AiMOR app has a
  [reported remote command channel](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md).
  The guides say to keep it offline until it's disabled. Problems in vendor
  firmware belong with the vendor, but we're glad to document mitigations.
- **eMMC backups** contain everything on the frame, including saved Wi-Fi
  passwords. They're excluded from Git; never share them.
