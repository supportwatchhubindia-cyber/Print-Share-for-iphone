package com.printshare.companion.usb

enum class Verdict {
    /** Printer advertises PCL 3/5: this app can send PCL raster directly (experimental). */
    DIRECT_PCL,
    /** Printer advertises a language Android could drive (PostScript, PDF, PWG/URF raster) but this app doesn't implement it. */
    LANGUAGE_NOT_IMPLEMENTED,
    /** Host-based printer: needs the manufacturer's host driver to render pages. Android can't drive it. */
    HOST_BASED,
    NOT_A_PRINTER,
    UNKNOWN,
}

data class Assessment(val verdict: Verdict, val title: String, val detail: String) {
    val canPrintDirectly: Boolean get() = verdict == Verdict.DIRECT_PCL
}

/**
 * Decides whether a phone can print to a USB printer without a computer, from what the printer
 * itself reports. It never guesses "yes": anything not positively identified as PCL is routed to the
 * PrintShare Windows Bridge.
 */
object Compatibility {
    const val HP_VENDOR_ID = 0x03F0

    // HP LaserJet models known to be host-based (no on-board PDL). Extend after verifying on hardware.
    private val hostBasedHpModels = Regex("""(?i)\b(M1005|M1120|M1132|M1136|M1212|M1319|P1005|P1006|P1007|P1008|P1102|P1505|P1566|P1606|1018|1020|1022)\b""")

    // Command-set tokens of host-based (driver-rendered) protocols.
    private val hostBasedTokens = setOf("ZJS", "XQX", "LIDIL", "HBS", "QPDL", "SPL", "GDI", "CAPT", "LIPS-LX")

    private val pclTokens = setOf("PCL", "PCL3", "PCL3GUI", "PCL5", "PCL5E", "PCL5C")
    private val otherPdlTokens = setOf("POSTSCRIPT", "PS", "PDF", "PWG", "PWGRASTER", "PWG-RASTER", "URF", "PCLXL", "PCL6")

    fun assess(id: DeviceId?, hasPrinterInterface: Boolean, vendorId: Int, productName: String?): Assessment {
        if (!hasPrinterInterface && id == null) {
            return Assessment(Verdict.NOT_A_PRINTER, "Not a USB printer", "This USB device does not expose a USB Printer Class interface.")
        }
        val model = listOfNotNull(id?.model, id?.description, productName).joinToString(" ")
        val cmd = id?.commandSet.orEmpty().toSet()

        if (vendorId == HP_VENDOR_ID && hostBasedHpModels.containsMatchIn(model)) {
            return Assessment(
                Verdict.HOST_BASED,
                "Direct printing from Android is not possible",
                "${modelLabel(id, productName)} is a host-based printer: it has no PCL or PostScript interpreter, so every page must be " +
                    "rendered by HP's driver on a computer. Android has no driver for it. Connect it by USB to a Windows PC running " +
                    "PrintShare Bridge and print from your phone through PrintShare instead.",
            )
        }
        if (cmd.any { it in hostBasedTokens }) {
            return Assessment(
                Verdict.HOST_BASED,
                "Direct printing from Android is not possible",
                "The printer reports a host-based command set (${cmd.joinToString()}). It needs its manufacturer's computer driver. " +
                    "Use PrintShare Bridge on a Windows PC.",
            )
        }
        if (cmd.any { it in pclTokens }) {
            return Assessment(
                Verdict.DIRECT_PCL,
                "Direct printing may work (experimental)",
                "The printer reports PCL (${cmd.joinToString()}). This app can send pages as PCL raster over USB. USB printers do not " +
                    "report completion to Android, so check the output. PrintShare Bridge remains the supported path.",
            )
        }
        if (cmd.any { it in otherPdlTokens }) {
            return Assessment(
                Verdict.LANGUAGE_NOT_IMPLEMENTED,
                "Printer language not supported by this app",
                "The printer understands ${cmd.joinToString()}, which this app does not generate. Use PrintShare Bridge, or Android's " +
                    "built-in print service if the printer is on Wi-Fi.",
            )
        }
        return Assessment(
            Verdict.UNKNOWN,
            "Could not confirm a supported printer language",
            if (id == null) "The printer did not return an IEEE 1284 Device ID. Use PrintShare Bridge on a Windows PC."
            else "The printer's command set (${cmd.joinToString().ifEmpty { "not reported" }}) is not one this app can drive. Use PrintShare Bridge.",
        )
    }

    private fun modelLabel(id: DeviceId?, productName: String?) =
        id?.model?.takeIf { it.isNotBlank() } ?: productName?.takeIf { it.isNotBlank() } ?: "This printer"
}
