# Changelog

Notable changes to noor-frame are documented here. This follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versions.

## [0.1.0] - Unreleased

### Added

- Family wall dashboard with prayer times and athan, Quran verse and recitation, calendars,
  weather, and optional travel times.
- Phone companion for household settings, calendar setup, optional integrations, and approved
  screen management.
- Optional Claude assistant for daily briefs and calendar questions.
- Raspberry Pi server and kiosk installation with phone-based Wi-Fi setup.
- Android kiosk app and tested AEEZO PF1007L Allwinner A33 access, backup and root-ADB guides.
- Cloudflare Worker hosting option and integration authoring guide.
- Screens find the server by themselves: the server announces `_noor-frame._tcp`, and the
  Android frame and Pi screens look for it, following it to a new address.
- Location search by town or ZIP/postal code, on the frame and the phone.
- Noor boot animation and boot logos for the Android frame; optional Pi boot splash.

### Security

- Hardened before the first release: malformed requests can't crash the server; forwarded
  headers are trusted only with `NOOR_TRUST_PROXY`; calendar UIDs and setup tokens can't inject
  script; calendar feeds are size- and repeat-limited; device registration is rate limited;
  the AI daily limit holds without storage.
- Only Noor's own server and setup page can use the Android app's device bridge, and only ADB
  can change its server address.
- Home-server API keys are encrypted at rest, and screens receive no API secrets.
- A33 eMMC backups, which can contain saved Wi-Fi passwords, are excluded from Git; the guide
  records the tested board identifiers and measured storage details without device serials.
