using System.Drawing;
using System.Drawing.Printing;
using PrintShare.Bridge.Core.Config;
using PrintShare.Bridge.Core.Printing;
using static PrintShare.Bridge.Core.Printing.SpoolerFlags;

namespace PrintShare.Bridge.Core.Tests;

public class PrinterStateMapperTests
{
    [Theory]
    [InlineData(0u, 0u, "READY")]
    [InlineData(PrinterPrinting, 0u, "PRINTING")]
    [InlineData(PrinterPaperOut, 0u, "PAPER_OUT")]
    [InlineData(PrinterPaperJam, 0u, "PAPER_JAM")]
    [InlineData(PrinterDoorOpen, 0u, "DOOR_OPEN")]
    [InlineData(PrinterNoToner, 0u, "NO_TONER")]
    [InlineData(PrinterPaused, 0u, "PAUSED")]
    [InlineData(PrinterError, 0u, "ERROR")]
    [InlineData(PrinterOffline, 0u, "OFFLINE")]
    [InlineData(0u, AttributeWorkOffline, "OFFLINE")]
    [InlineData(PrinterPaperOut | PrinterOffline, 0u, "OFFLINE")]
    public void Maps_spooler_flags(uint status, uint attributes, string expected)
    {
        Assert.Equal(expected, PrinterStateMapper.FromPrinter(status, attributes).State);
    }

    [Fact]
    public void Only_ready_or_printing_accepts_jobs()
    {
        Assert.True(PrinterStateMapper.FromPrinter(0, 0).CanAcceptJobs);
        Assert.True(PrinterStateMapper.FromPrinter(PrinterPrinting, 0).CanAcceptJobs);
        Assert.False(PrinterStateMapper.FromPrinter(0, AttributeWorkOffline).CanAcceptJobs);
        Assert.False(PrinterStateMapper.FromPrinter(PrinterPaperOut, 0).CanAcceptJobs);
    }

    [Fact]
    public void Toner_low_is_ready_with_message()
    {
        var m = PrinterStateMapper.FromPrinter(PrinterTonerLow, 0);
        Assert.Equal("READY", m.State);
        Assert.Equal("Toner is low.", m.Message);
    }

    [Fact]
    public void Job_alerts_are_human_readable()
    {
        Assert.Equal("Printer is out of paper", PrinterStateMapper.JobAlert(JobPaperOut, null));
        Assert.Equal("Printer is offline", PrinterStateMapper.JobAlert(JobOffline | JobPrinting, null));
        Assert.Equal("Driver says hi", PrinterStateMapper.JobAlert(JobError, " Driver says hi "));
        Assert.Null(PrinterStateMapper.JobAlert(JobPrinting | JobSpooling, null));
    }
}

public class PageLayoutTests
{
    private static readonly RectangleF A4Printable = new(0, 0, 794, 1129); // ~8.27 x 11.69 in minus 1/6" margins

    [Fact]
    public void Fit_scales_down_keeping_aspect_and_centres()
    {
        var r = PageLayout.Compute(new SizeF(1100, 850), A4Printable, fitToPage: true); // landscape Letter page on portrait A4
        Assert.Equal(794, r.Width, 1);
        Assert.Equal(850 * 794f / 1100, r.Height, 1);
        Assert.Equal(0, r.X, 1);
        Assert.Equal((1129 - r.Height) / 2, r.Y, 1);
    }

    [Fact]
    public void Actual_size_keeps_100_percent()
    {
        var r = PageLayout.Compute(new SizeF(583, 827), A4Printable, fitToPage: false); // A5 on A4
        Assert.Equal(583, r.Width, 1);
        Assert.Equal(827, r.Height, 1);
        Assert.Equal((794 - 583) / 2f, r.X, 1);
    }

    [Fact]
    public void Rejects_empty_content() =>
        Assert.Throws<ArgumentException>(() => PageLayout.Compute(new SizeF(0, 10), A4Printable, true));
}

public class PaperAndServerTests
{
    [Theory]
    [InlineData(PaperKind.A4, "A4")]
    [InlineData(PaperKind.A5, "A5")]
    [InlineData(PaperKind.Letter, "LETTER")]
    [InlineData(PaperKind.Legal, "LEGAL")]
    [InlineData(PaperKind.Executive, null)]
    public void Maps_paper_kinds(PaperKind kind, string? expected) => Assert.Equal(expected, PaperSizeMap.ToServerName(kind));

    [Fact]
    public void Round_trips_supported_papers()
    {
        foreach (var name in new[] { "A4", "A5", "LETTER", "LEGAL" })
            Assert.Equal(name, PaperSizeMap.ToServerName(PaperSizeMap.ToPaperKind(name)));
    }

    [Theory]
    [InlineData("print.example.com", "https://print.example.com/")]
    [InlineData("https://print.example.com/some/path?x=1", "https://print.example.com/")]
    [InlineData("http://localhost:3000", "http://localhost:3000/")]
    [InlineData("http://127.0.0.1:3000/", "http://127.0.0.1:3000/")]
    public void Normalizes_server_addresses(string input, string expected) => Assert.Equal(expected, ServerAddress.Normalize(input).ToString());

    [Theory]
    [InlineData("http://print.example.com")]
    [InlineData("http://192.168.1.20:3000")]
    [InlineData("ftp://print.example.com")]
    [InlineData("https://user:pass@print.example.com")]
    [InlineData("")]
    public void Rejects_insecure_or_invalid_addresses(string input) => Assert.Throws<ArgumentException>(() => ServerAddress.Normalize(input));

    [Fact]
    public void Builds_websocket_uri()
    {
        Assert.Equal("wss://print.example.com/ws", ServerAddress.WebSocketUri(new Uri("https://print.example.com/")).ToString());
        Assert.Equal("ws://localhost:3000/ws", ServerAddress.WebSocketUri(new Uri("http://localhost:3000/")).ToString());
    }
}
