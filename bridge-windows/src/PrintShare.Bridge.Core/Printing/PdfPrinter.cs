using System.Drawing;
using System.Drawing.Printing;
using PrintShare.Bridge.Core.Logging;

namespace PrintShare.Bridge.Core.Printing;

public sealed class PrintFailure(string code, string message, Exception? inner = null) : Exception(message, inner)
{
    public string Code { get; } = code;
}

public sealed record PrintRequest(
    string PrinterName,
    string DocumentTitle,
    string PdfPath,
    IReadOnlyList<int> Pages,
    int Copies,
    string PaperSize,
    bool Landscape,
    bool Color,
    int Dpi,
    bool FitToPage,
    string? OutputFile);

/// <summary>
/// Prints a PDF through the printer's installed Windows driver: each page is rendered with PDFium and
/// drawn into a GDI+ PrintDocument, which the driver (e.g. HP LaserJet M1005) converts into its own
/// printer language. Print() returns when the job has been fully spooled, not when paper comes out —
/// completion is decided separately from the spooler queue (see JobOutcomeTracker).
/// </summary>
public sealed class PdfPrinter(ILog log)
{
    public void Print(PrintRequest request, CancellationToken ct, Action<int>? pageSpooled = null)
    {
        var bytes = File.ReadAllBytes(request.PdfPath);
        using var raster = new PdfRasterizer(bytes, request.Dpi);
        foreach (var p in request.Pages)
            if (p < 1 || p > raster.PageCount)
                throw new PrintFailure("PAGE_RANGE", $"Page {p} does not exist in this {raster.PageCount}-page document.");
        if (request.Pages.Count == 0) throw new PrintFailure("PAGE_RANGE", "No pages selected.");

        using var document = new PrintDocument
        {
            DocumentName = request.DocumentTitle,
            PrintController = new StandardPrintController(), // no "Printing page x" dialog
            OriginAtMargins = false,
        };
        var printer = document.PrinterSettings;
        printer.PrinterName = request.PrinterName;
        if (!printer.IsValid) throw new PrintFailure("PRINTER_NOT_FOUND", $"Printer '{request.PrinterName}' is not installed on this computer.");
        if (request.OutputFile is not null)
        {
            printer.PrintToFile = true;
            printer.PrintFileName = request.OutputFile;
        }

        // Let the driver produce copies when it can (one rendering pass); otherwise repeat pages ourselves.
        var driverCopies = request.Copies > 1 && printer.MaximumCopies >= request.Copies;
        var sequence = driverCopies ? request.Pages.ToList() : Enumerable.Range(0, request.Copies).SelectMany(_ => request.Pages).ToList();
        printer.Copies = (short)(driverCopies ? request.Copies : 1);
        printer.Collate = true;

        var kind = PaperSizeMap.ToPaperKind(request.PaperSize);
        var paper = printer.PaperSizes.Cast<PaperSize>().FirstOrDefault(s => s.Kind == kind)
                    ?? throw new PrintFailure("PAPER_UNSUPPORTED", $"The {request.PrinterName} driver does not offer {request.PaperSize} paper.");
        var pageSettings = document.DefaultPageSettings;
        pageSettings.PaperSize = paper;
        pageSettings.Landscape = request.Landscape;
        pageSettings.Color = request.Color && printer.SupportsColor;
        var resolution = printer.PrinterResolutions.Cast<PrinterResolution>()
            .FirstOrDefault(r => r.Kind == PrinterResolutionKind.Custom && r.X == request.Dpi);
        if (resolution is not null) pageSettings.PrinterResolution = resolution;

        log.Info($"Spooling '{request.DocumentTitle}' to {request.PrinterName}: {sequence.Count} page(s){(driverCopies ? $" x{request.Copies} (driver copies)" : "")}, {request.PaperSize}, {(request.Landscape ? "landscape" : "portrait")}, {request.Dpi} dpi, {(request.FitToPage ? "fit" : "actual size")}");

        var index = 0;
        Exception? renderError = null;
        document.PrintPage += (_, e) =>
        {
            if (ct.IsCancellationRequested)
            {
                e.Cancel = true;
                return;
            }
            try
            {
                using var page = raster.Render(sequence[index]);
                var graphics = e.Graphics!;
                var target = PageLayout.Compute(new SizeF(page.WidthHundredths, page.HeightHundredths), graphics.VisibleClipBounds, request.FitToPage);
                graphics.DrawImage(page.Bitmap, target);
            }
            catch (Exception ex)
            {
                renderError = ex;
                e.Cancel = true; // aborts the spool job; nothing half-printed is left queued
                return;
            }
            index++;
            pageSpooled?.Invoke(index);
            e.HasMorePages = index < sequence.Count;
        };

        try
        {
            document.Print();
        }
        catch (InvalidPrinterException ex)
        {
            throw new PrintFailure("PRINTER_NOT_FOUND", ex.Message, ex);
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            throw new PrintFailure("SPOOLER_ERROR", $"Windows could not start the print job: {ex.Message}", ex);
        }
        if (renderError is not null) throw new PrintFailure("RENDER_FAILED", $"Could not render the document: {renderError.Message}", renderError);
        ct.ThrowIfCancellationRequested();
    }
}
