using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging.EventLog;
using Pignus.SoftGuard.Sync;

var builder = Host.CreateApplicationBuilder(args);
var isWindowsService = WindowsServiceHelpers.IsWindowsService();
if (isWindowsService)
{
    builder.Services.AddWindowsService(options => options.ServiceName = "PignusSoftGuardSync");
}
else if (OperatingSystem.IsWindows())
{
    builder.Logging.AddFilter<EventLogLoggerProvider>(null, LogLevel.None);
}
builder.Services.AddOptions<SyncOptions>()
    .Bind(builder.Configuration.GetSection(SyncOptions.SectionName))
    .ValidateDataAnnotations()
    .Validate(options => Uri.TryCreate(options.Endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps,
        "Sync:Endpoint debe ser una URL HTTPS absoluta.")
    .Validate(options => options.BatchSize is >= 1 and <= 500, "Sync:BatchSize debe estar entre 1 y 500.")
    .Validate(options => options.IntervalSeconds >= 30, "Sync:IntervalSeconds debe ser al menos 30.")
    .ValidateOnStart();
builder.Services.AddSingleton<SoftGuardRepository>();
builder.Services.AddSingleton<SnapshotValidator>();
builder.Services.AddSingleton<SyncOrchestrator>();
builder.Services.AddHttpClient<SyncApiClient>((services, client) =>
{
    var options = services.GetRequiredService<IOptions<SyncOptions>>().Value;
    client.BaseAddress = new Uri(options.Endpoint);
    client.Timeout = TimeSpan.FromSeconds(options.HttpTimeoutSeconds);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("Pignus-SoftGuard-Sync/1.0");
});
builder.Services.AddHostedService<Worker>();

await builder.Build().RunAsync();
