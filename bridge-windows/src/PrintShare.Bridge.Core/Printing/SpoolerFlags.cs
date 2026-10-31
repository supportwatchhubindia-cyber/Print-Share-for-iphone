namespace PrintShare.Bridge.Core.Printing;

/// <summary>PRINTER_STATUS_* / PRINTER_ATTRIBUTE_* / JOB_STATUS_* values from winspool.h.</summary>
public static class SpoolerFlags
{
    public const uint PrinterPaused = 0x00000001;
    public const uint PrinterError = 0x00000002;
    public const uint PrinterPendingDeletion = 0x00000004;
    public const uint PrinterPaperJam = 0x00000008;
    public const uint PrinterPaperOut = 0x00000010;
    public const uint PrinterManualFeed = 0x00000020;
    public const uint PrinterPaperProblem = 0x00000040;
    public const uint PrinterOffline = 0x00000080;
    public const uint PrinterIoActive = 0x00000100;
    public const uint PrinterBusy = 0x00000200;
    public const uint PrinterPrinting = 0x00000400;
    public const uint PrinterOutputBinFull = 0x00000800;
    public const uint PrinterNotAvailable = 0x00001000;
    public const uint PrinterWaiting = 0x00002000;
    public const uint PrinterProcessing = 0x00004000;
    public const uint PrinterInitializing = 0x00008000;
    public const uint PrinterWarmingUp = 0x00010000;
    public const uint PrinterTonerLow = 0x00020000;
    public const uint PrinterNoToner = 0x00040000;
    public const uint PrinterUserIntervention = 0x00100000;
    public const uint PrinterOutOfMemory = 0x00200000;
    public const uint PrinterDoorOpen = 0x00400000;
    public const uint PrinterServerUnknown = 0x00800000;

    public const uint AttributeWorkOffline = 0x00000400;

    public const uint JobPaused = 0x00000001;
    public const uint JobError = 0x00000002;
    public const uint JobDeleting = 0x00000004;
    public const uint JobSpooling = 0x00000008;
    public const uint JobPrinting = 0x00000010;
    public const uint JobOffline = 0x00000020;
    public const uint JobPaperOut = 0x00000040;
    public const uint JobPrinted = 0x00000080;
    public const uint JobDeleted = 0x00000100;
    public const uint JobBlockedDevq = 0x00000200;
    public const uint JobUserIntervention = 0x00000400;
    public const uint JobRestart = 0x00000800;
    public const uint JobComplete = 0x00001000;
    public const uint JobRetained = 0x00002000;
}
