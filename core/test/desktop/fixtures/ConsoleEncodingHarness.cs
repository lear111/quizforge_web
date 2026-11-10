// Test-only entry: force an encoding that cannot represent Chinese before
// invoking the real launcher entry or its in-assembly control path.
using System;
using System.Reflection;
using System.Text;
using QuizForge.Desktop;

internal static class ConsoleEncodingHarness
{
    [STAThread]
    private static int Main(string[] args)
    {
        Console.Error.WriteLine("initialOutputCodePage=" + Console.OutputEncoding.CodePage);
        Console.OutputEncoding = Encoding.GetEncoding(437);
        Console.Error.WriteLine("forcedOutputCodePage=" + Console.OutputEncoding.CodePage);
        var forwarded = new string[args.Length - 1];
        Array.Copy(args, 1, forwarded, 0, forwarded.Length);
        if (args[0] == "run") return Program.Run(Options.Parse(forwarded));
        return (int)typeof(Program).GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic)
            .Invoke(null, new object[] { forwarded });
    }
}
