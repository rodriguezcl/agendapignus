using Microsoft.Extensions.Options;

namespace Pignus.SoftGuard.Sync;

public sealed class SnapshotValidator(IOptions<SyncOptions> options)
{
    private readonly SyncOptions _options = options.Value;

    public void Validate(SoftGuardSnapshot snapshot)
    {
        if (!_options.AllowEmptySubscriberSnapshot && snapshot.Subscribers.Count == 0)
            throw new InvalidDataException("El snapshot no contiene abonados. Se rechaza para impedir una baja lógica masiva accidental.");

        Unique(snapshot.Subscribers.Select(item => item.IdInterno), "IdInterno");
        Unique(snapshot.Zones.Select(item => item.IdInternoZona), "IdInternoZona");
        Unique(snapshot.ServiceTypes.Select(item => item.CodigoTipoServicio), "CodigoTipoServicio");

        var subscriberIds = snapshot.Subscribers.Select(item => item.IdInterno).ToHashSet(StringComparer.Ordinal);
        var serviceTypeIds = snapshot.ServiceTypes.Select(item => item.CodigoTipoServicio).ToHashSet(StringComparer.Ordinal);
        if (snapshot.Zones.Any(zone => !subscriberIds.Contains(zone.IdInternoAbonado)))
            throw new InvalidDataException("El snapshot contiene una zona cuyo IdInternoAbonado no existe en abonados.");
        // "0" es una clave legítima normalizada por SoftGuard para "Sin especificar".
        // Sólo null/whitespace omite la relación; nunca se usa una conversión numérica.
        if (snapshot.Subscribers.Any(item => !string.IsNullOrWhiteSpace(item.CodigoTipoServicio)
                                             && !serviceTypeIds.Contains(item.CodigoTipoServicio)))
            throw new InvalidDataException("El snapshot contiene un CodigoTipoServicio sin correspondencia en tipos de servicio.");
    }

    private static void Unique(IEnumerable<string> keys, string label)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var key in keys)
        {
            if (string.IsNullOrWhiteSpace(key)) throw new InvalidDataException($"{label} contiene valores nulos o vacíos.");
            if (!seen.Add(key)) throw new InvalidDataException($"{label} contiene claves duplicadas. La sincronización fue cancelada.");
        }
    }
}
