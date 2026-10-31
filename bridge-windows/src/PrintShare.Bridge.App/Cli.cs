using System.Runtime.InteropServices;
using PrintShare.Bridge.Core;

namespace PrintShare.Bridge.App;

/// <summary>Scripted setup for unattended machines (and automated end-to-end tests).</summary>
internal static class Cli
{
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    public static int Run(string[] args)
    {
        AttachConsole(-1); // print to the calling console when launched from one
        var service = new BridgeService();
        try
        {
            if (args.Contains("--list-printers"))
            {
                foreach (var p in service.LocalPrinters())
                    Console.WriteLine($"{p.Name} | driver: {p.DriverName} | port: {p.PortName} | {p.State.State}{(p.IsHpM1005 ? " | HP M1005" : "")}");
            }

            var pair = Array.IndexOf(args, "--pair");
            if (pair >= 0)
            {
                if (pair + 2 >= args.Length) return Fail("Usage: --pair <server-url> <pairing-code>");
                service.PairAsync(args[pair + 1], args[pair + 2], CancellationToken.None).GetAwaiter().GetResult();
                service.StopAsync().GetAwaiter().GetResult();
                Console.WriteLine($"Paired with {service.Settings.ServerUrl} as {service.Settings.AccountEmail}.");
            }

            for (var i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--share")
                {
                    service.SetShared(args[i + 1], true);
                    Console.WriteLine($"Sharing printer: {args[i + 1]}");
                }
                if (args[i] == "--output-dir")
                {
                    service.SetVirtualOutputDir(args[i + 1]);
                    Console.WriteLine($"Virtual printer output folder: {args[i + 1]}");
                }
            }
            return 0;
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
