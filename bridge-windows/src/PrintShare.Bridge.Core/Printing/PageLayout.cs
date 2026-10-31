using System.Drawing;

namespace PrintShare.Bridge.Core.Printing;

public static class PageLayout
{
    /// <summary>
    /// Where to draw a rendered PDF page, in hundredths of an inch relative to the printable area
    /// (PrintDocument with OriginAtMargins = false, so the origin is the printer's hard margin).
    /// FIT scales the page to the printable area keeping its aspect ratio; ACTUAL draws it at 100%
    /// centred in the printable area (content outside it is clipped by the printer, as with any app).
    /// </summary>
    public static RectangleF Compute(SizeF content, RectangleF printable, bool fitToPage)
    {
        if (content.Width <= 0 || content.Height <= 0) throw new ArgumentException("Content size must be positive.", nameof(content));
        var scale = fitToPage ? Math.Min(printable.Width / content.Width, printable.Height / content.Height) : 1f;
        var w = content.Width * scale;
        var h = content.Height * scale;
        return new RectangleF(printable.X + (printable.Width - w) / 2f, printable.Y + (printable.Height - h) / 2f, w, h);
    }
}
