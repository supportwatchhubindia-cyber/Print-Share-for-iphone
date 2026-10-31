using Microsoft.Win32;

namespace PrintShare.Bridge.App;

/// <summary>Per-user "Start with Windows" via HKCU\...\Run. Only changed when the user opts in.</summary>
internal static class AutoStart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "PrintShareBridge";

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is string;
        }
    }

    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        if (enabled) key.SetValue(ValueName, $"\"{Application.ExecutablePath}\" --minimized");
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
