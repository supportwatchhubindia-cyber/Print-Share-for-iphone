using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Docnet.Core;
using Docnet.Core.Converters;
using Docnet.Core.Models;
using Docnet.Core.Readers;

namespace PrintShare.Bridge.Core.Printing;

public sealed class RenderedPage(Bitmap bitmap, float widthHundredths, float heightHundredths) : IDisposable
{
    public Bitmap Bitmap { get; } = bitmap;
    /// <summary>Physical page size in hundredths of an inch (from the PDF's MediaBox at 72 pt/inch).</summary>
    public float WidthHundredths { get; } = widthHundredths;
    public float HeightHundredths { get; } = heightHundredths;
    public void Dispose() => Bitmap.Dispose();
}

/// <summary>Renders PDF pages with PDFium (Docnet.Core) at the requested DPI on a white background.</summary>
public sealed class PdfRasterizer : IDisposable
{
    private readonly IDocReader _reader;
    private readonly int _dpi;

    public PdfRasterizer(byte[] pdf, int dpi)
    {
        if (dpi is < 72 or > 1200) throw new ArgumentOutOfRangeException(nameof(dpi));
        _dpi = dpi;
        _reader = DocLib.Instance.GetDocReader(pdf, new PageDimensions(dpi / 72.0));
    }

    public int PageCount => _reader.GetPageCount();

    /// <param name="pageNumber">1-based page number.</param>
    public RenderedPage Render(int pageNumber)
    {
        using var page = _reader.GetPageReader(pageNumber - 1);
        var width = page.GetPageWidth();
        var height = page.GetPageHeight();
        var bgra = page.GetImage(new NaiveTransparencyRemover(255, 255, 255));

        var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        var data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try
        {
            var rowBytes = width * 4;
            for (var y = 0; y < height; y++) Marshal.Copy(bgra, y * rowBytes, data.Scan0 + y * data.Stride, rowBytes);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
        bitmap.SetResolution(_dpi, _dpi);
        return new RenderedPage(bitmap, width * 100f / _dpi, height * 100f / _dpi);
    }

    public void Dispose() => _reader.Dispose();
}
