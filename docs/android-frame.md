# Noor on a cheap Android photo frame

> This route stands on **[Wes Bos](https://github.com/wesbos)'s
> [photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard)**:
> his write-up and hardware notes for the AEEZO PF1007L showed these frames can
> become dashboards, and his findings about the stock AiMOR app are why we
> disable it. Thank you, Wes.

Wall-mounted Android photo frames are cheap, have good screens and draw little
power. They're also locked down, run old Android, and ship with vendor software
you may not want on your network.

## Bought a frame? Start with Wes Bos's guides

Getting into the frame is the hard part, and it depends on which board is
inside. That work lives in Wes's repo, so begin there:

1. **Identify your frame.** Check **Settings → About** on the frame, then find
   it in his [Which frame do you have?](https://github.com/wesbos/photo-frame-dashboard#which-frame-do-you-have) section
   and [device index](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/devices.md). Frames sold under the same
   name can have different boards.
2. **Follow his guide for that board** until you can reach the frame with ADB
   over USB. For the PF1007L that's his
   [PF1007L start here](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pf1007l-start-here.md) page. Read
   his notes on the vendor app before the frame goes online.
3. **Come back here** and continue with the
   [Android kiosk guide](../apps/kiosk-android/README.md): update the WebView if
   needed, install Noor, make it the Home app and disable the vendor apps.

This repo adds two things for the frame we tested:

- **[A33 frame guide](../scripts/a33-frame/README.md):** our verified route for
  the AEEZO PF1007L (a full read-only eMMC backup, then root ADB), if you want
  that extra safety net or his route doesn't fit your unit.
- **[Android kiosk guide](../apps/kiosk-android/README.md):** installing Noor
  on any Android 6+ frame that has ADB.

> **Risk.** Some stages write to the frame's internal storage. A skipped check
> can leave it unbootable. Everything here was tested on **one** frame model.
> Frames sold under the same name can have different boards. Measure your own
> unit, keep the backups, and stop when a check fails. You do this at your own
> risk.

## The tested frame

| | |
| --- | --- |
| Sold as | AEEZO 10.1-inch digital photo frame, made by YHK |
| Model | PF1007L |
| Board | Allwinner A33 (`astar_m86_8723cs`), 1 GB RAM |
| Display | 1280 × 800 IPS, 160 dpi |
| Storage | 15.8 GB eMMC |
| Software | Android 6.0.1 with the AiMOR frame app (`com.efercro.os.aimor`) |

If your frame differs, the general shape still applies: get a backup, get ADB,
get a modern WebView, install Noor as Home. Only the hardware-specific steps
change.

## Before you start: is there an easier way?

Check these first. They avoid opening anything up.

- **Developer options.** If the frame's settings have Android's own **About
  device → Build number**, tap it seven times. Then turn on USB debugging. You
  may have ADB already, and can skip to the [kiosk guide](../apps/kiosk-android/README.md).
  On the tested frame, the vendor's settings app hid this.
- **A Raspberry Pi, a TV or any browser.** Noor runs on any screen with a
  modern browser. The [Pi guide](pi-server.md) sets up a Pi as a wall screen
  with Wi-Fi setup from a phone.

## The route, stage by stage

| Stage | What changes on the frame | Undo |
| --- | --- | --- |
| 1. FEL boot card | Nothing on the frame. A spare SD card holds the frame in Allwinner's recovery mode. The card's first sectors are saved first. | Restore the card from its saved prefix. |
| 2. Read-only backup | Nothing. U-Boot runs from RAM and exposes the eMMC to your computer as a **read-only** USB disk. The whole disk is read twice and checked. | Not needed. |
| 3. Root ADB | One file in the boot ramdisk: the USB setting that starts ADB. It's generated from *your* backup, checked byte by byte, and written only after you approve. | A generated restore script puts the original bytes back. |
| 4. WebView 106 | `/system/app/webview` is replaced. The stock tree is kept beside it. | Move the stock tree back. |
| 5. Noor as Home | The Noor app is installed as a normal app and chosen as Home. | Uninstall it, or pick another Home. |
| 6. Vendor apps off | AiMOR, the OTA updater and the factory test app are disabled. They aren't removed. | `pm enable <package>`. |

Afterwards the frame boots straight into Noor. Wi-Fi is chosen on Noor's own
screen, and volume is set in **Settings → Sound**. Noor loads its data from your
Noor server on the home network. That server can be a Pi, an always-on computer
or Cloudflare; see the [Pi guide](pi-server.md) and [configuration](configuration.md).

## Security notes

- **Keep the stock frame app offline until it's disabled.** On the tested
  firmware, AiMOR has a reported
  [unencrypted remote command channel](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md)
  that can run shell commands as root.
- **Treat a rooted frame as a trusted device on your network.** Root ADB over
  USB needs physical access, so keep the frame's USB port in a place you
  control.
- **Backups are private.** A full eMMC image holds everything on the frame,
  including saved Wi-Fi passwords. The repo's `.gitignore` excludes `backups/`
  and `diagnostics/`; never force-add them.

## Credits

The A33 research builds on **Wes Bos's** [photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard)
notes for the PF1007L. The FEL method is from [linux-sunxi](https://linux-sunxi.org/FEL),
and the WebView is a LineageOS prebuilt.
