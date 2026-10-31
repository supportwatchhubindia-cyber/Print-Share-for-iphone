using System.Drawing.Printing;
using PrintShare.Bridge.Core.Api;
using PrintShare.Bridge.Core.Logging;

namespace PrintShare.Bridge.Core.Printing;

public sealed record LocalPrinter(
    string Name,
    string? DriverName,
    string? PortName,
    bool IsDefault,
    uint Status,
    uint Attributes,
    int QueuedJobs,
    PrinterStateMapper.Mapped State)
{
    public bool IsHpM1005 => (DriverName ?? Name).Contains("M1005", StringComparison.OrdinalIgnoreCase);

    /// <summary>Port that asks the user for a file name (Microsoft Print to PDF, XPS Document Writer).</summary>
    public bool PromptsForFile => string.Equals(PortName, "PORTPROMPT:", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Finds installed printers and reads what their drivers support.</summary>
public sealed class PrinterDiscovery(ILog log)
{
    public IReadOnlyList<LocalPrinter> Discover()
    {
        string? defaultName = null;
        try
        {
            defaultName = new PrinterSettings().PrinterName;
        }
        catch (Exception ex)
        {
            log.Debug($"No default printer: {ex.Message}");
        }

        return Winspool.EnumeratePrinters()
            .Where(p => !string.IsNullOrWhiteSpace(p.Name))
            .Select(p => new LocalPrinter(p.Name, p.DriverName, p.PortName, string.Equals(p.Name, defaultName, StringComparison.OrdinalIgnoreCase),
                p.Status, p.Attributes, p.QueuedJobs, PrinterStateMapper.FromPrinter(p.Status, p.Attributes)))
            .OrderByDescending(p => p.IsHpM1005)
            .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public LocalPrinter? Find(string systemName) =>
        Discover().FirstOrDefault(p => string.Equals(p.Name, systemName, StringComparison.OrdinalIgnoreCase));

    /// <summary>Reads driver capabilities via System.Drawing.Printing (DEVMODE/DeviceCapabilities under the hood).</summary>
    public DriverCapabilities? ReadCapabilities(string printerName)
    {
        try
        {
            var settings = new PrinterSettings { PrinterName = printerName };
            if (!settings.IsValid) return null;
            var papers = new HashSet<string>();
            foreach (PaperSize size in settings.PaperSizes)
            {
                var mapped = PaperSizeMap.ToServerName(size.Kind);
                if (mapped is not null) papers.Add(mapped);
            }
            var dpis = new HashSet<int>();
            foreach (PrinterResolution res in settings.PrinterResolutions)
                if (res.Kind == PrinterResolutionKind.Custom && res.X > 0) dpis.Add(res.X);
            return new DriverCapabilities(
                settings.SupportsColor,
                settings.CanDuplex,
                papers.OrderBy(p => p).ToList(),
                dpis.OrderBy(d => d).ToList(),
                settings.MaximumCopies);
        }
        catch (Exception ex)
        {
            log.Warn($"Could not read capabilities for '{printerName}': {ex.Message}");
            return null;
        }
    }
}

public static class PaperSizeMap
{
    public static string? ToServerName(PaperKind kind) => kind switch
    {
        PaperKind.A4 or PaperKind.A4Rotated => "A4",
        PaperKind.A5 or PaperKind.A5Rotated => "A5",
        PaperKind.Letter or PaperKind.LetterRotated => "LETTER",
        PaperKind.Legal => "LEGAL",
        _ => null,
    };

    public static PaperKind ToPaperKind(string serverName) => serverName.ToUpperInvariant() switch
    {
        "A4" => PaperKind.A4,
        "A5" => PaperKind.A5,
        "LETTER" => PaperKind.Letter,
        "LEGAL" => PaperKind.Legal,
        _ => throw new ArgumentOutOfRangeException(nameof(serverName), serverName, "Unsupported paper size"),
    };
}
