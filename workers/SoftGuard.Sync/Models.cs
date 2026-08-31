using System.Text.Json.Serialization;

namespace Pignus.SoftGuard.Sync;

public sealed record SoftGuardSubscriber(
    [property: JsonPropertyName("id_interno")] string IdInterno,
    [property: JsonPropertyName("numero_abonado")] string? NumeroAbonado,
    [property: JsonPropertyName("nombre_abonado")] string? NombreAbonado,
    [property: JsonPropertyName("direccion")] string? Direccion,
    [property: JsonPropertyName("localidad")] string? Localidad,
    [property: JsonPropertyName("primer_contacto")] string? PrimerContacto,
    [property: JsonPropertyName("telefono_primer_contacto")] string? TelefonoPrimerContacto,
    [property: JsonPropertyName("codigo_tipo_servicio")] string? CodigoTipoServicio);

public sealed record SoftGuardZone(
    [property: JsonPropertyName("id_interno_zona")] string IdInternoZona,
    [property: JsonPropertyName("id_interno_abonado")] string IdInternoAbonado,
    [property: JsonPropertyName("numero_abonado")] string? NumeroAbonado,
    [property: JsonPropertyName("codigo_zona")] string? CodigoZona,
    [property: JsonPropertyName("descripcion_zona")] string? DescripcionZona);

public sealed record SoftGuardServiceType(
    [property: JsonPropertyName("codigo_tipo_servicio")] string CodigoTipoServicio,
    [property: JsonPropertyName("tipo_servicio")] string? TipoServicio,
    [property: JsonPropertyName("estado")] string? Estado);

public sealed record SoftGuardSnapshot(
    DateTimeOffset SourceGeneratedAt,
    IReadOnlyList<SoftGuardSubscriber> Subscribers,
    IReadOnlyList<SoftGuardZone> Zones,
    IReadOnlyList<SoftGuardServiceType> ServiceTypes);
