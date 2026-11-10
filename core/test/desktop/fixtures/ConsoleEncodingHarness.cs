// Test-only entry: force an encoding that cannot represent Chinese before
// invoking the real launcher entry or its in-assembly control path.
using System;
using System.Reflection;
using System.Text;
using System.IO;
using System.Threading.Tasks;
using QuizForge.Desktop;

internal static class ConsoleEncodingHarness
{
    [STAThread]
    private static int Main(string[] args)
    {
        Console.Error.WriteLine("initialOutputCodePage=" + Console.OutputEncoding.CodePage);
        Console.OutputEncoding = Encoding.GetEncoding(437);
        Console.Error.WriteLine("forcedOutputCodePage=" + Console.OutputEncoding.CodePage);
        if (args[0] == "once")
        {
            var outputs = new TextWriter[32];
            var errors = new TextWriter[32];
            Parallel.For(0, outputs.Length, i => {
                Program.ConfigureConsoleEncoding(); outputs[i] = Console.Out; errors[i] = Console.Error;
            });
            for (int i = 0; i < outputs.Length; i++)
                if (!Object.ReferenceEquals(outputs[0], outputs[i]) || !Object.ReferenceEquals(errors[0], errors[i])) return 2;
            Program.ConfigureConsoleEncoding();
            if (!Object.ReferenceEquals(Console.Out, outputs[0]) || !Object.ReferenceEquals(Console.Error, errors[0])) return 3;
            Console.WriteLine("encoding-initialized-once"); return 0;
        }
        var forwarded = new string[args.Length - 1];
        Array.Copy(args, 1, forwarded, 0, forwarded.Length);
        if (args[0] == "run") return Program.Run(Options.Parse(forwarded));
        return (int)typeof(Program).GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic)
            .Invoke(null, new object[] { forwarded });
    }
}
