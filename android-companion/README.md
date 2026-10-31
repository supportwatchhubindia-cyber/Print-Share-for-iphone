# PrintShare USB — Android OTG companion

A small Kotlin app that answers one question honestly: **can this phone print to the USB printer plugged into it?**

It detects the printer over USB OTG, asks for USB permission, reads the printer's **IEEE 1284 Device ID**
(USB Printer Class `GET_DEVICE_ID`), and classifies what the printer understands. For the
**HP LaserJet MFP M1005 the answer is no** — the app explains why and sends the user to PrintShare, where
the job is printed by the Windows Bridge.

See [`../docs/ANDROID_USB_OTG.md`](../docs/ANDROID_USB_OTG.md) for the full investigation.

## What it does

| Step | API |
|---|---|
| Detect devices on launch and on attach | `UsbManager.deviceList`, `USB_DEVICE_ATTACHED` intent filter (`res/xml/usb_device_filter.xml`: class 7 printers, HP vendor 0x03F0) |
| Permission | `UsbManager.requestPermission` with an explicit, mutable `PendingIntent` (Android 12–14 rules) |
| Identify | VID:PID, manufacturer/product strings, every interface (printer, vendor-specific scanner, storage) |
| Read capabilities | Control transfer `0xA1 / GET_DEVICE_ID`, parse `MFG`, `MDL`, `CMD` (command set), `CLS` |
| Decide | `Compatibility.assess` — PCL ⇒ *direct (experimental)*; host-based (M1005 and similar, `ZJS`/`XQX`/…) ⇒ *use the bridge*; anything unrecognised ⇒ *use the bridge* |
| Report | Text report via the Android share sheet (useful for adding verified models) |
| Experimental direct print | **Only when the printer advertises PCL 3/5**: PDF → `PdfRenderer` at 300 dpi → 1‑bit → PCL 5 raster (PackBits) → USB bulk OUT |

The app never reports a page as printed: USB printers give Android no completion signal, so it says how many bytes
were sent and asks the user to check the output tray.

## Build

Requirements: Android Studio Koala (2024.1) or newer, JDK 17, Android SDK 34.

```bash
# from android-companion/
gradle wrapper --gradle-version 8.7   # once, if you don't use Android Studio's bundled Gradle
./gradlew testDebugUnitTest           # DeviceId, compatibility rules, PackBits/PCL encoder
./gradlew assembleDebug               # app/build/outputs/apk/debug/app-debug.apk
```

The project has no third-party runtime dependencies (framework `UsbManager` and `PdfRenderer` only).

> Status: written and unit-tested at the source level, **not yet built or run on a phone** in this environment
> (no Android SDK here). See `docs/HARDWARE_VERIFICATION.md` for the device checklist.
