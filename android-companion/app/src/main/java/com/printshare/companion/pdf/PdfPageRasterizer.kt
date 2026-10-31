package com.printshare.companion.pdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor

/**
 * Renders PDF pages (Android's built-in PdfRenderer) fitted to A4 at [dpi] and thresholds them to
 * 1-bit rows for monochrome PCL raster. One page in memory at a time.
 */
class PdfPageRasterizer(fd: ParcelFileDescriptor, private val dpi: Int = 300) : AutoCloseable {
    private val renderer = PdfRenderer(fd)
    val pageCount: Int get() = renderer.pageCount

    // A4 printable area with ~4.2 mm margins, the common minimum for laser printers.
    val widthPx: Int = ((210.0 - 8.4) / 25.4 * dpi).toInt() and 0x7FFFFFF8.toInt()
    private val heightPx: Int = ((297.0 - 8.4) / 25.4 * dpi).toInt()

    /** Returns packed rows (MSB first, 1 = black). */
    fun renderRows(pageIndex: Int): List<ByteArray> {
        renderer.openPage(pageIndex).use { page ->
            val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(Color.WHITE)
                val scale = minOf(widthPx / page.width.toFloat(), heightPx / page.height.toFloat())
                val matrix = Matrix().apply {
                    postScale(scale, scale)
                    postTranslate((widthPx - page.width * scale) / 2f, (heightPx - page.height * scale) / 2f)
                }
                page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                val rowBytes = (widthPx + 7) / 8
                val pixels = IntArray(widthPx)
                return List(heightPx) { y ->
                    bitmap.getPixels(pixels, 0, widthPx, 0, y, widthPx, 1)
                    val row = ByteArray(rowBytes)
                    for (x in 0 until widthPx) {
                        val p = pixels[x]
                        val luminance = (Color.red(p) * 299 + Color.green(p) * 587 + Color.blue(p) * 114) / 1000
                        if (luminance < 128) row[x shr 3] = (row[x shr 3].toInt() or (0x80 ushr (x and 7))).toByte()
                    }
                    row
                }
            } finally {
                bitmap.recycle()
            }
        }
    }

    override fun close() = renderer.close()
}
