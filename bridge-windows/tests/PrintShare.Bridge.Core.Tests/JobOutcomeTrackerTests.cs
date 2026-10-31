using PrintShare.Bridge.Core.Printing;
using static PrintShare.Bridge.Core.Printing.SpoolerFlags;

namespace PrintShare.Bridge.Core.Tests;

public class JobOutcomeTrackerTests
{
    private static SpoolSnapshot Snap(uint status, int printed = 0, int total = 1) => new(42, status, null, total, printed);

    [Fact]
    public void Printed_flag_completes_even_while_job_stays_in_queue()
    {
        var t = new JobOutcomeTracker();
        Assert.Equal(SpoolOutcome.Pending, t.Observe(Snap(JobSpooling), false, false).Outcome);
        var d = t.Observe(Snap(JobPrinted, 1), true, false);
        Assert.Equal(SpoolOutcome.Completed, d.Outcome);
        Assert.Equal("SPOOLER_PRINTED_FLAG", d.ConfirmationSource);
    }

    [Fact]
    public void Clean_drain_after_successful_spool_completes_as_queue_drained()
    {
        var t = new JobOutcomeTracker();
        t.Observe(Snap(JobSpooling | JobPrinting), false, false);
        t.Observe(Snap(JobPrinting), true, false);
        var d = t.Observe(null, true, false);
        Assert.Equal(SpoolOutcome.Completed, d.Outcome);
        Assert.Equal("SPOOLER_QUEUE_DRAINED", d.ConfirmationSource);
    }

    [Fact]
    public void Complete_flag_is_preferred_over_drain()
    {
        var t = new JobOutcomeTracker();
        t.Observe(Snap(JobComplete), true, false);
        Assert.Equal("SPOOLER_COMPLETE_FLAG", t.Observe(null, true, false).ConfirmationSource);
    }

    [Fact]
    public void Never_completes_if_spooling_did_not_finish()
    {
        var t = new JobOutcomeTracker();
        t.Observe(Snap(JobSpooling), false, false);
        var d = t.Observe(null, false, false);
        Assert.Equal(SpoolOutcome.Failed, d.Outcome);
        Assert.Equal("OUTCOME_UNKNOWN", d.ErrorCode);
    }

    [Fact]
    public void Never_seen_job_is_unknown_not_completed()
    {
        var t = new JobOutcomeTracker();
        Assert.Equal(SpoolOutcome.Pending, t.Observe(null, false, false).Outcome);
        var d = t.Observe(null, true, false);
        Assert.Equal(SpoolOutcome.Failed, d.Outcome);
        Assert.Equal("OUTCOME_UNKNOWN", d.ErrorCode);
    }

    [Fact]
    public void Paper_out_is_an_alert_not_a_failure_and_recovers()
    {
        var t = new JobOutcomeTracker();
        Assert.Equal(SpoolOutcome.Pending, t.Observe(Snap(JobPrinting | JobPaperOut), true, false).Outcome);
        Assert.Equal("Printer is out of paper", t.Alert);
        t.Observe(Snap(JobPrinting), true, false);
        Assert.Null(t.Alert);
        Assert.Equal(SpoolOutcome.Completed, t.Observe(null, true, false).Outcome);
    }

    [Fact]
    public void Vanishing_while_in_error_is_reported_as_unknown()
    {
        var t = new JobOutcomeTracker();
        t.Observe(Snap(JobPrinting | JobError), true, false);
        var d = t.Observe(null, true, false);
        Assert.Equal(SpoolOutcome.Failed, d.Outcome);
        Assert.Equal("OUTCOME_UNKNOWN", d.ErrorCode);
    }

    [Fact]
    public void Deleted_by_us_is_cancelled_by_someone_else_is_failed()
    {
        var mine = new JobOutcomeTracker();
        mine.Observe(Snap(JobPrinting), true, true);
        Assert.Equal(SpoolOutcome.Cancelled, mine.Observe(null, true, true).Outcome);

        var theirs = new JobOutcomeTracker();
        theirs.Observe(Snap(JobDeleting), true, false);
        var d = theirs.Observe(null, true, false);
        Assert.Equal(SpoolOutcome.Failed, d.Outcome);
        Assert.Equal("DELETED_IN_WINDOWS", d.ErrorCode);
    }

    [Fact]
    public void Restored_flags_survive_restart()
    {
        var t = new JobOutcomeTracker();
        t.Restore(seenPrinting: true, seenPrintedFlag: true, seenCompleteFlag: false, everSeen: true);
        Assert.Equal("SPOOLER_PRINTED_FLAG", t.Observe(null, false, false).ConfirmationSource);
    }

    [Fact]
    public void Tracks_page_progress()
    {
        var t = new JobOutcomeTracker();
        t.Observe(Snap(JobPrinting, printed: 2, total: 5), true, false);
        Assert.Equal(2, t.PagesPrinted);
        Assert.Equal(5, t.TotalPages);
    }
}
