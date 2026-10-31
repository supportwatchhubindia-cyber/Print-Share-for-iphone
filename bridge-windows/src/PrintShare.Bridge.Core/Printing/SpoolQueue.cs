namespace PrintShare.Bridge.Core.Printing;

/// <summary>Read/cancel access to a printer's Windows queue.</summary>
public static class SpoolQueue
{
    public static SpoolSnapshot? FindById(string printerName, int jobId) =>
        Winspool.EnumerateJobs(printerName).Where(j => j.JobId == jobId).Select(ToSnapshot).FirstOrDefault();

    /// <summary>Finds our job by the unique document title we gave it (used to learn the spooler job id).</summary>
    public static SpoolSnapshot? FindByDocument(string printerName, string documentTitle) =>
        Winspool.EnumerateJobs(printerName)
            .Where(j => string.Equals(j.Document, documentTitle, StringComparison.Ordinal))
            .OrderByDescending(j => j.JobId)
            .Select(ToSnapshot)
            .FirstOrDefault();

    public static bool Delete(string printerName, int jobId) => Winspool.DeleteJob(printerName, jobId);

    private static SpoolSnapshot ToSnapshot(Winspool.JobRow j) => new(j.JobId, j.Status, j.StatusText, j.TotalPages, j.PagesPrinted);
}
