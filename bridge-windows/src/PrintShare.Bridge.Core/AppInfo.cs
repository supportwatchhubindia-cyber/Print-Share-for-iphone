using System.Reflection;
using System.Runtime.InteropServices;

namespace PrintShare.Bridge.Core;

public static class AppInfo
{
    public static string Version { get; } =
        typeof(AppInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "1.0.0";

    public static string OsDescription => $"{RuntimeInformation.OSDescription.Trim()} ({RuntimeInformation.OSArchitecture})";

    public static string MachineName => Environment.MachineName;
}
