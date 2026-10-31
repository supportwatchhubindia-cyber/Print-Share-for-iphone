using static PrintShare.Bridge.Core.Printing.SpoolerFlags;

namespace PrintShare.Bridge.Core.Printing;

public enum SpoolOutcome
{
    Pending,
    Completed,
    Cancelled,
    Failed,
}

public sealed record SpoolSnapshot(int JobId, uint Status, string? StatusText, int TotalPages, int PagesPrinted);

public sealed record OutcomeDecision(SpoolOutcome Outcome, string? ConfirmationSource = null, string? ErrorCode = null, string? Message = null);

/// <summary>
/// Decides when a Windows spooler job has really finished, from successive snapshots of the queue.
///
/// Confirmation rules (never optimistic):
///  * JOB_STATUS_PRINTED seen            -> Completed (SPOOLER_PRINTED_FLAG)
///  * JOB_STATUS_COMPLETE seen           -> Completed (SPOOLER_COMPLETE_FLAG) once it leaves the queue
///  * job left the queue after the spooler finished receiving it, with no delete/error flag
///                                       -> Completed (SPOOLER_QUEUE_DRAINED)
///  * DELETING/DELETED seen              -> Cancelled (we asked) or Failed (someone deleted it in Windows)
///  * left the queue while in error, or was never seen at all -> Failed (OUTCOME_UNKNOWN), so the user
///    checks the output instead of the bridge risking a duplicate print.
/// </summary>
public sealed class JobOutcomeTracker
{
    public bool EverSeen { get; private set; }
    public bool SeenPrinting { get; private set; }
    public bool SeenPrintedFlag { get; private set; }
    public bool SeenCompleteFlag { get; private set; }
    public bool SeenDeleting { get; private set; }
    public bool InError { get; private set; }
    public int PagesPrinted { get; private set; }
    public int TotalPages { get; private set; }
    public string? Alert { get; private set; }

    /// <summary>Restores flags persisted in the job journal after a bridge restart.</summary>
    public void Restore(bool seenPrinting, bool seenPrintedFlag, bool seenCompleteFlag, bool everSeen)
    {
        SeenPrinting = seenPrinting;
        SeenPrintedFlag = seenPrintedFlag;
        SeenCompleteFlag = seenCompleteFlag;
        EverSeen = everSeen;
    }

    /// <param name="snapshot">Current queue entry, or null if the job is no longer in the queue.</param>
    /// <param name="spoolingFinished">True once PrintDocument.Print() has returned successfully.</param>
    /// <param name="cancelRequested">True if this bridge deleted the job because the user cancelled.</param>
    public OutcomeDecision Observe(SpoolSnapshot? snapshot, bool spoolingFinished, bool cancelRequested)
    {
        if (snapshot is not null)
        {
            EverSeen = true;
            var s = snapshot.Status;
            if ((s & JobPrinting) != 0) SeenPrinting = true;
            if ((s & JobPrinted) != 0) SeenPrintedFlag = true;
            if ((s & JobComplete) != 0) SeenCompleteFlag = true;
            if ((s & (JobDeleting | JobDeleted)) != 0) SeenDeleting = true;
            Alert = PrinterStateMapper.JobAlert(s, snapshot.StatusText);
            InError = Alert is not null && (s & JobPaused) == 0;
            PagesPrinted = Math.Max(PagesPrinted, snapshot.PagesPrinted);
            TotalPages = Math.Max(TotalPages, snapshot.TotalPages);

            // "Keep printed documents" leaves the job in the queue marked PRINTED.
            if (SeenPrintedFlag && !SeenDeleting) return new(SpoolOutcome.Completed, ConfirmationSourceName.PrintedFlag);
            return new(SpoolOutcome.Pending);
        }

        if (!EverSeen)
        {
            return spoolingFinished
                ? new(SpoolOutcome.Failed, ErrorCode: "OUTCOME_UNKNOWN", Message: "Windows accepted the job but never listed it in the print queue, so it could not be confirmed. Check the printer before retrying.")
                : new(SpoolOutcome.Pending);
        }

        // The job has left the queue.
        if (SeenDeleting || cancelRequested)
        {
            return cancelRequested
                ? new(SpoolOutcome.Cancelled, Message: "Removed from the Windows print queue")
                : new(SpoolOutcome.Failed, ErrorCode: "DELETED_IN_WINDOWS", Message: "The job was deleted from the Windows print queue on the bridge computer.");
        }
        if (SeenPrintedFlag) return new(SpoolOutcome.Completed, ConfirmationSourceName.PrintedFlag);
        if (SeenCompleteFlag) return new(SpoolOutcome.Completed, ConfirmationSourceName.CompleteFlag);
        if (InError)
            return new(SpoolOutcome.Failed, ErrorCode: "OUTCOME_UNKNOWN", Message: $"The job left the Windows queue while the printer reported: {Alert}. Check the output before retrying.");
        if (!spoolingFinished)
            return new(SpoolOutcome.Failed, ErrorCode: "OUTCOME_UNKNOWN", Message: "The job disappeared from the Windows queue before spooling finished. Check the output before retrying.");
        return new(SpoolOutcome.Completed, ConfirmationSourceName.QueueDrained);
    }

    private static class ConfirmationSourceName
    {
        public const string PrintedFlag = "SPOOLER_PRINTED_FLAG";
        public const string CompleteFlag = "SPOOLER_COMPLETE_FLAG";
        public const string QueueDrained = "SPOOLER_QUEUE_DRAINED";
    }
}
