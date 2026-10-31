using System.ComponentModel;
using System.Runtime.InteropServices;

namespace PrintShare.Bridge.Core.Printing;

/// <summary>Minimal winspool.drv interop: enumerate printers and jobs, delete a job.</summary>
internal static partial class Winspool
{
    public const uint PRINTER_ENUM_LOCAL = 0x00000002;
    public const uint PRINTER_ENUM_CONNECTIONS = 0x00000004;
    public const uint JOB_CONTROL_DELETE = 5;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;

    [StructLayout(LayoutKind.Sequential)]
    private struct PRINTER_INFO_2
    {
        public IntPtr pServerName, pPrinterName, pShareName, pPortName, pDriverName, pComment, pLocation, pDevMode,
            pSepFile, pPrintProcessor, pDatatype, pParameters, pSecurityDescriptor;
        public uint Attributes, Priority, DefaultPriority, StartTime, UntilTime, Status, cJobs, AveragePPM;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEMTIME
    {
        public ushort wYear, wMonth, wDayOfWeek, wDay, wHour, wMinute, wSecond, wMilliseconds;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOB_INFO_1
    {
        public uint JobId;
        public IntPtr pPrinterName, pMachineName, pUserName, pDocument, pDatatype, pStatus;
        public uint Status, Priority, Position, TotalPages, PagesPrinted;
        public SYSTEMTIME Submitted;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "EnumPrintersW")]
    private static extern bool EnumPrinters(uint flags, string? name, uint level, IntPtr buffer, uint cbBuf, out uint needed, out uint returned);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "OpenPrinterW")]
    private static extern bool OpenPrinter(string printerName, out IntPtr handle, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "EnumJobsW")]
    private static extern bool EnumJobs(IntPtr printer, uint firstJob, uint noJobs, uint level, IntPtr buffer, uint cbBuf, out uint needed, out uint returned);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SetJobW")]
    private static extern bool SetJob(IntPtr printer, uint jobId, uint level, IntPtr job, uint command);

    public sealed record PrinterRow(string Name, string? PortName, string? DriverName, uint Status, uint Attributes, int QueuedJobs);

    public sealed record JobRow(int JobId, string? Document, uint Status, string? StatusText, int TotalPages, int PagesPrinted);

    public static List<PrinterRow> EnumeratePrinters()
    {
        var flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        EnumPrinters(flags, null, 2, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return new();
        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!EnumPrinters(flags, null, 2, buffer, needed, out _, out var returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
            var size = Marshal.SizeOf<PRINTER_INFO_2>();
            var rows = new List<PrinterRow>((int)returned);
            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<PRINTER_INFO_2>(buffer + i * size);
                rows.Add(new PrinterRow(
                    Marshal.PtrToStringUni(info.pPrinterName) ?? "",
                    Marshal.PtrToStringUni(info.pPortName),
                    Marshal.PtrToStringUni(info.pDriverName),
                    info.Status,
                    info.Attributes,
                    (int)info.cJobs));
            }
            return rows;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static List<JobRow> EnumerateJobs(string printerName)
    {
        if (!OpenPrinter(printerName, out var handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), $"Cannot open printer '{printerName}'");
        try
        {
            if (!EnumJobs(handle, 0, 512, 1, IntPtr.Zero, 0, out var needed, out _))
            {
                var err = Marshal.GetLastWin32Error();
                if (err != ERROR_INSUFFICIENT_BUFFER && needed == 0) return new();
            }
            if (needed == 0) return new();
            var buffer = Marshal.AllocHGlobal((int)needed);
            try
            {
                if (!EnumJobs(handle, 0, 512, 1, buffer, needed, out _, out var returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var size = Marshal.SizeOf<JOB_INFO_1>();
                var rows = new List<JobRow>((int)returned);
                for (var i = 0; i < returned; i++)
                {
                    var job = Marshal.PtrToStructure<JOB_INFO_1>(buffer + i * size);
                    rows.Add(new JobRow((int)job.JobId, Marshal.PtrToStringUni(job.pDocument), job.Status,
                        Marshal.PtrToStringUni(job.pStatus), (int)job.TotalPages, (int)job.PagesPrinted));
                }
                return rows;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            ClosePrinter(handle);
        }
    }

    /// <summary>Deletes a job from the Windows queue (user cancelled). Requires the job to belong to the current user.</summary>
    public static bool DeleteJob(string printerName, int jobId)
    {
        if (!OpenPrinter(printerName, out var handle, IntPtr.Zero)) return false;
        try
        {
            return SetJob(handle, (uint)jobId, 0, IntPtr.Zero, JOB_CONTROL_DELETE);
        }
        finally
        {
            ClosePrinter(handle);
        }
    }
}
