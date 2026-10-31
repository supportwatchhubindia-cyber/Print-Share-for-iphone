package com.printshare.companion.usb

/**
 * IEEE 1284 Device ID, e.g. "MFG:Hewlett-Packard;MDL:HP LaserJet M1005;CMD:...;CLS:PRINTER;".
 * Returned by the USB Printer Class GET_DEVICE_ID request. Keys have long and short forms.
 */
data class DeviceId(val raw: String, val fields: Map<String, String>) {
    val manufacturer: String? get() = fields["MFG"] ?: fields["MANUFACTURER"]
    val model: String? get() = fields["MDL"] ?: fields["MODEL"]
    val description: String? get() = fields["DES"] ?: fields["DESCRIPTION"]
    val deviceClass: String? get() = fields["CLS"] ?: fields["CLASS"]

    /** Page description / command languages the printer accepts, upper-cased (e.g. PCL5E, POSTSCRIPT, PWGRASTER). */
    val commandSet: List<String>
        get() = (fields["CMD"] ?: fields["COMMAND SET"] ?: "")
            .split(',')
            .map { it.trim().uppercase() }
            .filter { it.isNotEmpty() }

    companion object {
        fun parse(raw: String): DeviceId {
            val fields = LinkedHashMap<String, String>()
            raw.split(';').forEach { part ->
                val idx = part.indexOf(':')
                if (idx > 0) {
                    val key = part.substring(0, idx).trim().uppercase()
                    val value = part.substring(idx + 1).trim()
                    if (key.isNotEmpty() && !fields.containsKey(key)) fields[key] = value
                }
            }
            return DeviceId(raw, fields)
        }

        /** The response starts with a 2-byte big-endian length that includes those two bytes. */
        fun fromResponse(buffer: ByteArray, received: Int): DeviceId? {
            if (received < 3) return null
            val declared = ((buffer[0].toInt() and 0xFF) shl 8) or (buffer[1].toInt() and 0xFF)
            val end = minOf(maxOf(declared, 2), received)
            if (end <= 2) return null
            return parse(String(buffer, 2, end - 2, Charsets.ISO_8859_1).trim('\u0000', ' '))
        }
    }
}
