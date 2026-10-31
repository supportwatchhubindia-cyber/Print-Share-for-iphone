package com.printshare.companion.usb

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager

data class ProbeResult(
    val device: UsbDevice,
    val vendorId: Int,
    val productId: Int,
    val manufacturer: String?,
    val product: String?,
    val interfaces: List<String>,
    val printerInterface: UsbInterface?,
    val bulkOut: UsbEndpoint?,
    val deviceId: DeviceId?,
    val deviceIdError: String?,
    val assessment: Assessment,
) {
    fun report(): String = buildString {
        appendLine("PrintShare USB printer report")
        appendLine("Device: ${manufacturer ?: "?"} ${product ?: "?"}")
        appendLine("USB ID: %04x:%04x".format(vendorId, productId))
        appendLine("Interfaces:")
        interfaces.forEach { appendLine("  $it") }
        appendLine("IEEE 1284 Device ID: ${deviceId?.raw ?: "(not available${deviceIdError?.let { ": $it" } ?: ""})"}")
        deviceId?.let {
            appendLine("  Manufacturer: ${it.manufacturer}")
            appendLine("  Model: ${it.model}")
            appendLine("  Command set: ${it.commandSet.joinToString().ifEmpty { "(none)" }}")
        }
        appendLine("Verdict: ${assessment.verdict} — ${assessment.title}")
        appendLine(assessment.detail)
    }
}

/** Enumerates USB devices and reads printer identity. All calls are blocking: run off the UI thread. */
class UsbPrinterProbe(private val usb: UsbManager) {

    fun candidates(): List<UsbDevice> = usb.deviceList.values.filter { d ->
        d.vendorId == Compatibility.HP_VENDOR_ID ||
            d.deviceClass == UsbConstants.USB_CLASS_PRINTER ||
            (0 until d.interfaceCount).any { d.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_PRINTER }
    }

    fun probe(device: UsbDevice): ProbeResult {
        val interfaces = (0 until device.interfaceCount).map { device.getInterface(it) }
        val printer = interfaces.firstOrNull { it.interfaceClass == UsbConstants.USB_CLASS_PRINTER }
        val bulkOut = printer?.let { intf ->
            (0 until intf.endpointCount).map { intf.getEndpoint(it) }
                .firstOrNull { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == UsbConstants.USB_DIR_OUT }
        }
        var deviceId: DeviceId? = null
        var error: String? = null
        if (printer != null) {
            val conn = usb.openDevice(device)
            if (conn == null) {
                error = "could not open the device (permission?)"
            } else {
                try {
                    if (!conn.claimInterface(printer, true)) {
                        error = "could not claim the printer interface"
                    } else {
                        val buffer = ByteArray(1024)
                        // USB Printer Class GET_DEVICE_ID: class request, device-to-host, recipient = interface.
                        val received = conn.controlTransfer(
                            0xA1, 0, 0, (printer.id shl 8) or printer.alternateSetting, buffer, buffer.size, 3000,
                        )
                        deviceId = DeviceId.fromResponse(buffer, received)
                        if (deviceId == null) error = "GET_DEVICE_ID returned $received bytes"
                        conn.releaseInterface(printer)
                    }
                } finally {
                    conn.close()
                }
            }
        }
        val describe = interfaces.map { i ->
            "#${i.id} class=${i.interfaceClass} subclass=${i.interfaceSubclass} protocol=${i.interfaceProtocol}" +
                when (i.interfaceClass) {
                    UsbConstants.USB_CLASS_PRINTER -> " (printer${if (i.interfaceProtocol == 2) ", bidirectional" else if (i.interfaceProtocol == 1) ", unidirectional" else ""})"
                    UsbConstants.USB_CLASS_VENDOR_SPEC -> " (vendor-specific, e.g. scanner)"
                    UsbConstants.USB_CLASS_MASS_STORAGE -> " (storage)"
                    else -> ""
                }
        }
        val product = runCatching { device.productName }.getOrNull()
        return ProbeResult(
            device = device,
            vendorId = device.vendorId,
            productId = device.productId,
            manufacturer = runCatching { device.manufacturerName }.getOrNull(),
            product = product,
            interfaces = describe,
            printerInterface = printer,
            bulkOut = bulkOut,
            deviceId = deviceId,
            deviceIdError = error,
            assessment = Compatibility.assess(deviceId, printer != null, device.vendorId, product),
        )
    }
}
