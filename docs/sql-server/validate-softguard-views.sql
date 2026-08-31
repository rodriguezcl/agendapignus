-- Solo lectura. Ejecutar antes de instalar el Worker y conservar los conteos,
-- nunca las filas con datos personales, en el registro de validación.
SET NOCOUNT ON;

SELECT 'abonados' AS entidad, COUNT_BIG(*) AS total
FROM [_Datos].[api].[vw_AbonadosPIG];
SELECT 'zonas' AS entidad, COUNT_BIG(*) AS total
FROM [_Datos].[api].[vw_ZonasPIG];
SELECT 'tipos_servicio' AS entidad, COUNT_BIG(*) AS total
FROM [_Tablas].[api].[vw_TiposServicio];

SELECT 'abonados_clave_nula' AS validacion, COUNT_BIG(*) AS errores
FROM [_Datos].[api].[vw_AbonadosPIG]
WHERE IdInterno IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(200), IdInterno))) = '';

SELECT 'abonados_clave_duplicada' AS validacion, COUNT_BIG(*) AS errores
FROM (
  SELECT CONVERT(nvarchar(200), IdInterno) AS clave
  FROM [_Datos].[api].[vw_AbonadosPIG]
  GROUP BY CONVERT(nvarchar(200), IdInterno)
  HAVING COUNT_BIG(*) > 1
) duplicates;

SELECT 'abonados_tipo_nulo' AS validacion, COUNT_BIG(*) AS errores
FROM [_Datos].[api].[vw_AbonadosPIG]
WHERE CodigoTipoServicio IS NULL
   OR LTRIM(RTRIM(CONVERT(nvarchar(200), CodigoTipoServicio))) = '';

SELECT 'zonas_clave_nula' AS validacion, COUNT_BIG(*) AS errores
FROM [_Datos].[api].[vw_ZonasPIG]
WHERE IdInternoZona IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(200), IdInternoZona))) = '';

SELECT 'zonas_clave_duplicada' AS validacion, COUNT_BIG(*) AS errores
FROM (
  SELECT CONVERT(nvarchar(200), IdInternoZona) AS clave
  FROM [_Datos].[api].[vw_ZonasPIG]
  GROUP BY CONVERT(nvarchar(200), IdInternoZona)
  HAVING COUNT_BIG(*) > 1
) duplicates;

SELECT 'zonas_abonado_nulo' AS validacion, COUNT_BIG(*) AS errores
FROM [_Datos].[api].[vw_ZonasPIG]
WHERE IdInternoAbonado IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(200), IdInternoAbonado))) = '';

SELECT 'zonas_huerfanas' AS validacion, COUNT_BIG(*) AS errores
FROM [_Datos].[api].[vw_ZonasPIG] zone
LEFT JOIN [_Datos].[api].[vw_AbonadosPIG] subscriber
  ON CONVERT(nvarchar(200), subscriber.IdInterno) = CONVERT(nvarchar(200), zone.IdInternoAbonado)
WHERE subscriber.IdInterno IS NULL;

SELECT 'tipos_clave_nula' AS validacion, COUNT_BIG(*) AS errores
FROM [_Tablas].[api].[vw_TiposServicio]
WHERE CodigoTipoServicio IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(200), CodigoTipoServicio))) = '';

SELECT 'tipos_clave_duplicada' AS validacion, COUNT_BIG(*) AS errores
FROM (
  SELECT CONVERT(nvarchar(200), CodigoTipoServicio) AS clave
  FROM [_Tablas].[api].[vw_TiposServicio]
  GROUP BY CONVERT(nvarchar(200), CodigoTipoServicio)
  HAVING COUNT_BIG(*) > 1
) duplicates;

SELECT 'tipo_cero_catalogo_invalido' AS validacion,
  CASE WHEN COUNT_BIG(*) = 1 THEN CONVERT(bigint, 0) ELSE CONVERT(bigint, 1) END AS errores
FROM [_Tablas].[api].[vw_TiposServicio]
WHERE CONVERT(nvarchar(200), CodigoTipoServicio) = '0'
  AND TipoServicio = N'Sin especificar';

SELECT 'abonados_tipo_huerfano' AS validacion, COUNT_BIG(*) AS errores
FROM [_Datos].[api].[vw_AbonadosPIG] subscriber
LEFT JOIN [_Tablas].[api].[vw_TiposServicio] service_type
  ON CONVERT(nvarchar(200), service_type.CodigoTipoServicio) = CONVERT(nvarchar(200), subscriber.CodigoTipoServicio)
WHERE service_type.CodigoTipoServicio IS NULL;
