package com.printshare.companion.usb

import android.hardware.usb.UsbManager
import java.io.IOException

/** Writes raw bytes to the printer's bulk OUT endpoint. USB gives no "page printed" confirmation. */
class UsbPrinterTransport(private val usb: UsbManager, private val probe: ProbeResult) {

    fun send(chunks: Sequence<ByteArray>, onProgress: (Long) -> Unit): Long {
        val intf = probe.printerInterface ?: throw IOException("No printer interface")
        val out = probe.bulkOut ?: throw IOException("Printer interface has no bulk OUT endpoint")
        val conn = usb.openDevice(probe.device) ?: throw IOException("Cannot open the USB device (permission revoked?)")
        var total = 0L
        try {
            if (!conn.claimInterface(intf, true)) throw IOException("Cannot claim the printer interface")
            for (chunk in chunks) {
                var offset = 0
                while (offset < chunk.size) {
                    val len = minOf(16 * 1024, chunk.size - offset)
                    val written = conn.bulkTransfer(out, chunk, offset, len, 30_000)
                    if (written <= 0) throw IOException("USB write failed after $total bytes (printer busy, out of paper or disconnected)")
                    offset += written
                    total += written
                    onProgress(total)
                }
            }
            conn.releaseInterface(intf)
        } finally {
            conn.close()
        }
        return total
    }
}
