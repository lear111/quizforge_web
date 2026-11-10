// Separate test entry point. This file is never compiled into the shipped EXE.
using System;
using System.IO;
using System.Net;
using System.Web.Script.Serialization;
using QuizForge.Desktop;

internal static class HubImportHarness
{
    private static void Write(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); }
    private static HubPackageImport Importer()
    {
        return new HubPackageImport(uri =>
        {
            if (uri.GetLeftPart(UriPartial.Authority) != HubPackageImport.Origin) throw new Exception("Non-official production URI");
            var request = (HttpWebRequest)WebRequest.Create(Environment.GetEnvironmentVariable("QF_TEST_HUB_ORIGIN") + uri.PathAndQuery);
            request.Proxy = null;
            return request;
        }, TimeSpan.FromMilliseconds(int.Parse(Environment.GetEnvironmentVariable("QF_TEST_TIMEOUT") ?? "10000")));
    }
    [STAThread]
    private static int Main(string[] args)
    {
        Program.ConfigureConsoleEncoding();
        try
        {
            if (args[0] == "framework")
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.SystemDefault;
                bool legacyTls;
                AppContext.TryGetSwitch("Switch.System.Net.DontEnableSystemDefaultTlsVersions", out legacyTls);
                Write(new { targetFramework = AppDomain.CurrentDomain.SetupInformation.TargetFrameworkName, legacyTls });
                return 0;
            }
            if (args[0] == "parse")
            {
                var parsed = HubImportRequest.Parse(args[1]); Write(new { parsed.PackId, parsed.Revision, parsed.Key }); return 0;
            }
            if (args[0] == "command") { Write(new { valid = HubImportRequest.FromCommand(args[1]) != null }); return 0; }
            if (args[0] == "cleanup") { HubPackageImport.CleanStale(args[1], warning => Console.Error.WriteLine(warning)); Write(true); return 0; }
            if (args[0] == "fetch")
            {
                var result = Importer().Import(args[3], args[2], HubImportRequest.Parse(args[1]), (state, message) => { }, warning => Console.Error.WriteLine(warning)).GetAwaiter().GetResult();
                Write(new { result.Name, result.BankId }); return 0;
            }
            string[] forwarded = new string[args.Length - 1]; Array.Copy(args, 1, forwarded, 0, forwarded.Length);
            var options = Options.Parse(forwarded);
            if (args[0] == "options") { Write(new { hub = options.HubImport != null }); return 0; }
            if (args[0] != "run") throw new Exception("Unknown test operation");
            // Strict production argument parsing happened above. Layout and
            // transport overrides exist only in this separately compiled test.
            var isolated = Options.Parse(new[] { "--root", Environment.GetEnvironmentVariable("QF_TEST_ROOT"), "--data-root", Environment.GetEnvironmentVariable("QF_TEST_DATA"), "--port", "0", "--no-browser" });
            isolated.Command = options.Command; isolated.ImportFile = options.ImportFile; isolated.HubImport = options.HubImport;
            return Program.Run(isolated, Importer());
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
