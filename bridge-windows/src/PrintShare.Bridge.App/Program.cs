using PrintShare.Bridge.Core;
using PrintShare.Bridge.Core.Logging;

namespace PrintShare.Bridge.App;

internal static class Program
{
    /// <summary>
    /// PrintShareBridge.exe                  tray app (normal use)
    /// PrintShareBridge.exe --minimized      tray app without opening the window (used by "Start with Windows")
    /// PrintShareBridge.exe --headless       no UI; for Task Scheduler / unattended PCs (logs to file)
    /// PrintShareBridge.exe --pair URL CODE [--share "Printer name"] [--output-dir DIR]
    ///                                       scripted pairing/configuration, then exit
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--pair") || args.Contains("--share") || args.Contains("--output-dir") || args.Contains("--list-printers"))
            return Cli.Run(args);

        using var mutex = new Mutex(true, @"Local\PrintShare.Bridge", out var firstInstance);
        if (!firstInstance)
        {
            if (!args.Contains("--headless"))
                MessageBox.Show("PrintShare Bridge is already running. Look for its icon in the notification area.", "PrintShare Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }

        if (args.Contains("--headless")) return RunHeadless();

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var log = new FileLog();
        Application.ThreadException += (_, e) => log.Error("Unhandled UI exception", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => log.Error("Unhandled exception", e.ExceptionObject as Exception);
        Application.Run(new TrayApplicationContext(new BridgeService(log), startMinimized: args.Contains("--minimized")));
        return 0;
    }

    private static int RunHeadless()
    {
        var service = new BridgeService();
        if (!service.Settings.IsPaired)
        {
            service.Log.Error("Headless mode: the bridge is not paired. Run PrintShareBridge.exe --pair <server> <code> first.");
            return 2;
        }
        service.Log.Info($"PrintShare Bridge {AppInfo.Version} starting in headless mode");
        using var stop = new ManualResetEventSlim();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Set();
        service.Start();
        stop.Wait();
        service.StopAsync().GetAwaiter().GetResult();
        return 0;
    }
}
