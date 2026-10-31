package com.printshare.companion

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import com.printshare.companion.pdf.PdfPageRasterizer
import com.printshare.companion.usb.PclRasterEncoder
import com.printshare.companion.usb.ProbeResult
import com.printshare.companion.usb.UsbPrinterProbe
import com.printshare.companion.usb.UsbPrinterTransport
import java.util.concurrent.Executors

/**
 * USB OTG compatibility checker. It identifies the attached printer, reads its IEEE 1284 Device ID,
 * and says plainly whether a phone can drive it. For the HP LaserJet M1005 the answer is no, and the
 * user is sent to PrintShare (Windows Bridge). Direct printing is offered only for PCL printers.
 */
class MainActivity : Activity() {
    private lateinit var usb: UsbManager
    private lateinit var probe: UsbPrinterProbe
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var current: ProbeResult? = null

    private lateinit var verdictTitle: TextView
    private lateinit var verdictDetail: TextView
    private lateinit var details: TextView
    private lateinit var progress: TextView
    private lateinit var printDirect: Button
    private lateinit var share: Button
    private lateinit var server: EditText

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val device = intent.usbDevice()
            when (intent.action) {
                ACTION_USB_PERMISSION ->
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) runProbe(device)
                    else showMessage("USB permission denied", "Allow access to the printer to check it.")
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> scan()
                UsbManager.ACTION_USB_DEVICE_DETACHED -> if (device != null && device.deviceId == current?.device?.deviceId) {
                    current = null
                    render(null)
                    showMessage("Printer disconnected", getString(R.string.no_device))
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        usb = getSystemService(Context.USB_SERVICE) as UsbManager
        probe = UsbPrinterProbe(usb)
        verdictTitle = findViewById(R.id.verdictTitle)
        verdictDetail = findViewById(R.id.verdictDetail)
        details = findViewById(R.id.details)
        progress = findViewById(R.id.progress)
        printDirect = findViewById(R.id.printDirect)
        share = findViewById(R.id.share)
        server = findViewById(R.id.server)
        server.setText(getPreferences(MODE_PRIVATE).getString("server", ""))

        findViewById<Button>(R.id.scan).setOnClickListener { scan() }
        share.setOnClickListener { current?.let { shareReport(it) } }
        printDirect.setOnClickListener {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf"), PICK_PDF)
        }
        findViewById<Button>(R.id.openPrintShare).setOnClickListener { openPrintShare() }

        val filter = IntentFilter(ACTION_USB_PERMISSION).apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, filter)

        intent.usbDevice()?.let { requestAndProbe(it) } ?: scan()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.usbDevice()?.let { requestAndProbe(it) }
    }

    override fun onDestroy() {
        unregisterReceiver(receiver)
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun scan() {
        val devices = probe.candidates()
        if (devices.isEmpty()) {
            render(null)
            showMessage("No USB printer found", getString(R.string.no_device))
            return
        }
        requestAndProbe(devices.first())
    }

    private fun requestAndProbe(device: UsbDevice) {
        if (usb.hasPermission(device)) return runProbe(device)
        val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        val permissionIntent = PendingIntent.getBroadcast(this, 0, Intent(ACTION_USB_PERMISSION).setPackage(packageName), flags)
        showMessage("Waiting for permission…", "Android will ask whether PrintShare USB may access the printer.")
        usb.requestPermission(device, permissionIntent)
    }

    private fun runProbe(device: UsbDevice) {
        showMessage("Checking the printer…", "")
        worker.execute {
            val result = runCatching { probe.probe(device) }
            main.post {
                result.onSuccess { render(it) }.onFailure { showMessage("Could not read the printer", it.message ?: it.toString()) }
            }
        }
    }

    private fun render(result: ProbeResult?) {
        current = result
        share.isEnabled = result != null
        printDirect.isEnabled = result?.assessment?.canPrintDirectly == true && result.bulkOut != null
        details.text = result?.report() ?: ""
        progress.text = ""
        if (result != null) showMessage(result.assessment.title, result.assessment.detail)
    }

    private fun showMessage(title: String, detail: String) {
        verdictTitle.text = title
        verdictDetail.text = detail
    }

    @Deprecated("Activity result API kept framework-only to avoid extra dependencies")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode == PICK_PDF && resultCode == RESULT_OK && uri != null) current?.let { printDirect(it, uri) }
    }

    /** Experimental: PDF -> 300 dpi 1-bit PCL raster -> USB bulk OUT. Completion cannot be confirmed over USB. */
    private fun printDirect(target: ProbeResult, uri: Uri) {
        printDirect.isEnabled = false
        progress.text = "Preparing pages…"
        worker.execute {
            val outcome = runCatching {
                val fd = contentResolver.openFileDescriptor(uri, "r") ?: error("Cannot open the PDF")
                PdfPageRasterizer(fd, dpi = 300).use { pdf ->
                    val pages = sequence {
                        yield(PclRasterEncoder.jobStart())
                        for (i in 0 until pdf.pageCount) {
                            main.post { progress.text = "Sending page ${i + 1} of ${pdf.pageCount}…" }
                            yield(PclRasterEncoder.page(pdf.renderRows(i), pdf.widthPx, 300, PclRasterEncoder.Paper.A4))
                        }
                        yield(PclRasterEncoder.jobEnd())
                    }
                    UsbPrinterTransport(usb, target).send(pages) { } to pdf.pageCount
                }
            }
            main.post {
                printDirect.isEnabled = true
                outcome.onSuccess { (bytes, pages) ->
                    progress.text = "Sent $pages page(s) (${bytes / 1024} KB) to the printer. USB printers don't report completion to Android — check the output tray."
                }.onFailure { progress.text = "Not printed: ${it.message}" }
            }
        }
    }

    private fun shareReport(result: ProbeResult) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, "PrintShare USB printer report")
            .putExtra(Intent.EXTRA_TEXT, result.report())
        startActivity(Intent.createChooser(send, getString(R.string.share_report)))
    }

    private fun openPrintShare() {
        val text = server.text.toString().trim()
        if (text.isEmpty()) return
        val url = if (text.startsWith("http://") || text.startsWith("https://")) text else "https://$text"
        getPreferences(MODE_PRIVATE).edit().putString("server", url).apply()
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.trimEnd('/') + "/upload")))
    }

    @Suppress("DEPRECATION")
    private fun Intent.usbDevice(): UsbDevice? =
        if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java) else getParcelableExtra(UsbManager.EXTRA_DEVICE)

    companion object {
        private const val ACTION_USB_PERMISSION = "com.printshare.companion.USB_PERMISSION"
        private const val PICK_PDF = 42
    }
}
