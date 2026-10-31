using static PrintShare.Bridge.Core.Printing.SpoolerFlags;

namespace PrintShare.Bridge.Core.Printing;

/// <summary>Maps Windows spooler flags to the server's PrinterState vocabulary.</summary>
public static class PrinterStateMapper
{
    public readonly record struct Mapped(string State, string? Message)
    {
        public bool CanAcceptJobs => State is "READY" or "PRINTING";
    }

    /// <remarks>
    /// USB printers: when the cable is unplugged or the printer is switched off, Windows' USB port
    /// monitor normally sets "Use Printer Offline" (PRINTER_ATTRIBUTE_WORK_OFFLINE). Host-based
    /// drivers (such as the M1005's) may not report paper/door states at all; those are surfaced
    /// only when the driver provides them.
    /// </remarks>
    public static Mapped FromPrinter(uint status, uint attributes)
    {
        if ((attributes & AttributeWorkOffline) != 0 || (status & (PrinterOffline | PrinterNotAvailable | PrinterServerUnknown)) != 0)
            return new("OFFLINE", "Printer is offline or disconnected. Check the USB cable and power.");
        if ((status & PrinterPaperOut) != 0) return new("PAPER_OUT", "Out of paper. Load paper to continue.");
        if ((status & PrinterPaperJam) != 0) return new("PAPER_JAM", "Paper jam. Clear the jam to continue.");
        if ((status & PrinterDoorOpen) != 0) return new("DOOR_OPEN", "A printer door or cover is open.");
        if ((status & PrinterNoToner) != 0) return new("NO_TONER", "The toner cartridge is empty.");
        if ((status & PrinterPaused) != 0) return new("PAUSED", "Printing is paused in Windows.");
        if ((status & PrinterPendingDeletion) != 0) return new("ERROR", "The printer is being removed from Windows.");
        if ((status & PrinterOutOfMemory) != 0) return new("ERROR", "The printer is out of memory.");
        if ((status & PrinterOutputBinFull) != 0) return new("ERROR", "The output tray is full.");
        if ((status & (PrinterUserIntervention | PrinterPaperProblem | PrinterManualFeed)) != 0)
            return new("ERROR", "The printer needs attention.");
        if ((status & PrinterError) != 0) return new("ERROR", "The printer reported an error.");
        if ((status & (PrinterPrinting | PrinterBusy | PrinterProcessing | PrinterIoActive)) != 0)
            return new("PRINTING", (status & PrinterTonerLow) != 0 ? "Toner is low." : null);
        return new("READY", (status & PrinterTonerLow) != 0 ? "Toner is low." : (status & PrinterWarmingUp) != 0 ? "Warming up." : null);
    }

    /// <summary>A human-readable alert for a job that is stuck in the queue, or null if it is progressing.</summary>
    public static string? JobAlert(uint jobStatus, string? statusText)
    {
        if ((jobStatus & JobPaperOut) != 0) return "Printer is out of paper";
        if ((jobStatus & JobOffline) != 0) return "Printer is offline";
        if ((jobStatus & JobBlockedDevq) != 0) return "The printer driver could not process the job";
        if ((jobStatus & JobUserIntervention) != 0) return "Printer needs attention";
        if ((jobStatus & JobError) != 0) return string.IsNullOrWhiteSpace(statusText) ? "Printer reported an error" : statusText.Trim();
        if ((jobStatus & JobPaused) != 0) return "Job is paused in the Windows print queue";
        return null;
    }
}
