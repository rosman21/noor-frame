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

### Security

- Home-server API keys are encrypted at rest, and screens receive no API secrets.
- A33 eMMC backups, which can contain saved Wi-Fi passwords, are excluded from Git; the guide
  records the tested board identifiers and measured storage details without device serials.
