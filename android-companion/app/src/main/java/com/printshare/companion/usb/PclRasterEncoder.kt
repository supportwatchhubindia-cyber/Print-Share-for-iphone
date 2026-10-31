package com.printshare.companion.usb

import java.io.ByteArrayOutputStream

/**
 * Minimal monochrome PCL 5 raster writer (used only for printers that advertise PCL).
 * Rows are 1 bit per pixel, MSB first, 1 = black, compressed with TIFF PackBits (mode 2).
 */
object PclRasterEncoder {
    private const val ESC = 0x1B

    enum class Paper(val pclCode: Int) { A4(26), LETTER(2), LEGAL(3), A5(25) }

    fun jobStart(): ByteArray = ascii("\u001B%-12345X@PJL ENTER LANGUAGE=PCL\r\n") + byteArrayOf(ESC.toByte(), 'E'.code.toByte())

    fun jobEnd(): ByteArray = byteArrayOf(ESC.toByte(), 'E'.code.toByte()) + ascii("\u001B%-12345X")

    fun page(rows: List<ByteArray>, widthPixels: Int, dpi: Int, paper: Paper): ByteArray {
        require(dpi == 75 || dpi == 100 || dpi == 150 || dpi == 300 || dpi == 600) { "Unsupported PCL raster resolution $dpi" }
        val out = ByteArrayOutputStream()
        out.write(ascii("\u001B&l${paper.pclCode}A"))  // paper size
        out.write(ascii("\u001B&l0O"))                  // portrait
        out.write(ascii("\u001B*t${dpi}R"))             // raster resolution
        out.write(ascii("\u001B*p0x0Y"))                // cursor to top-left of the logical page
        out.write(ascii("\u001B*r0F"))                  // raster follows logical page orientation
        out.write(ascii("\u001B*r${widthPixels}S"))     // source raster width
        out.write(ascii("\u001B*r1A"))                  // start raster graphics at cursor
        out.write(ascii("\u001B*b2M"))                  // compression: TIFF PackBits
        for (row in rows) {
            val packed = packBits(row)
            out.write(ascii("\u001B*b${packed.size}W"))
            out.write(packed)
        }
        out.write(ascii("\u001B*rB"))                   // end raster graphics
        out.write(0x0C)                                 // form feed: eject page
        return out.toByteArray()
    }

    /** TIFF PackBits (Apple TN1023), as used by PCL compression mode 2. */
    fun packBits(input: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < input.size) {
            var run = 1
            while (i + run < input.size && run < 128 && input[i + run] == input[i]) run++
            if (run >= 2) {
                out.write(-(run - 1) and 0xFF)
                out.write(input[i].toInt())
                i += run
                continue
            }
            val start = i
            var literal = 0
            while (i < input.size && literal < 128) {
                if (i + 2 < input.size && input[i] == input[i + 1] && input[i] == input[i + 2]) break
                i++
                literal++
            }
            out.write(literal - 1)
            out.write(input, start, literal)
        }
        return out.toByteArray()
    }

    private fun ascii(s: String) = s.toByteArray(Charsets.US_ASCII)
}
