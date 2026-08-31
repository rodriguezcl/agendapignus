# Despliegue en Vercel con Supabase

La versión web conserva React/Vite y reemplaza la persistencia de producción por PostgreSQL de Supabase. SQLite continúa disponible para desarrollo local y funciona como origen de la migración inicial.

## Arquitectura

- Vercel publica `dist/` y ejecuta `api/index.js` como función Node.js.
- Supabase almacena roles, empleados, clientes, servicios, historial, agenda, preferencias y auditoría.
- Las sesiones y los intentos fallidos de acceso también se guardan en PostgreSQL; no dependen de la memoria de una función.
- El navegador nunca recibe `DATABASE_URL` ni accede directamente a las tablas. RLS está activado y los roles `anon` y `authenticated` no tienen permisos sobre los datos operativos.
- Las escrituras del estado se realizan dentro de una transacción y conservan el control de revisión para detectar ediciones concurrentes.

## 1. Crear el proyecto de Supabase

1. Crear un proyecto en Supabase. Elegir, si está disponible, una región cercana a la función de Vercel.
2. En **Connect**, copiar la URI de **Transaction pooler**, puerto `6543`. Es la conexión adecuada para funciones serverless.
3. Después de configurar `.env.local`, inspeccionar el esquema sin escribir mediante `npm run schema:supabase`. El aplicador clasifica instalación inicial, baseline sin historial, migración incremental, esquema actualizado o estado parcial. La opción genérica `--confirm` está prohibida.

No usar la clave pública de Supabase para estas tablas. La API de PIGNUS utiliza solamente la conexión PostgreSQL del servidor.

## 2. Configurar la conexión local sin publicarla

Rotar inmediatamente cualquier contraseña que se haya compartido por chat, correo o capturas. Copiar después la URI nueva directamente desde **Supabase > Connect > Transaction pooler** sin incluirla en documentación ni comandos guardados.

Crear manualmente `.env.local` en la raíz del proyecto con una sola línea:

```dotenv
DATABASE_URL=postgresql://USUARIO:CONTRASENA_CODIFICADA@HOST:6543/postgres?sslmode=require
```

- No agregar comillas, espacios ni una barra invertida antes de `@`.
- Si la contraseña contiene caracteres reservados, usar la URI ya codificada que entrega Supabase o codificar sólo la contraseña para URL.
- `.env.local` está cubierto por `.gitignore`. Verificarlo con `git check-ignore -v .env.local`; nunca usar `git add -f` con ese archivo.
- Los scripts sólo leen la variable en memoria. No imprimen la URI ni la contraseña.

Después de guardar `DATABASE_URL`, completar `sslmode=require` y generar los dos secretos locales sin mostrarlos:

```powershell
npm run config:local
```

Validar la conexión y el estado del esquema en modo exclusivamente de lectura:

```powershell
npm run check:supabase
```

### Baseline existente y migraciones incrementales

Cuando las 12 tablas `pignus_*` ya existen y coinciden exactamente, pero no existe `supabase_migrations.schema_migrations`, no se debe ejecutar nuevamente `202608250001_pignus_schema.sql`. El procedimiento previsto es:

1. Ejecutar `npm run schema:supabase` en modo de inspección y confirmar que informa `baseline-without-history`.
2. Solicitar autorización específica para modificar el historial remoto.
3. Registrar `202608250001` como aplicada mediante el mecanismo oficial de reparación de migraciones de Supabase, sin ejecutar su SQL:

   ```powershell
   supabase migration repair --status applied 202608250001
   ```

4. Volver a inspeccionar y confirmar que el estado es `softguard-migration-pending`.
5. Ejecutar solamente el ensayo oficial:

   ```powershell
   supabase db push --dry-run
   ```

6. Comprobar que el dry-run proponga exclusivamente `202608300001_softguard_sync.sql`. Detenerse si muestra otra migración, DDL u operación.
7. Presentar el resultado y solicitar una autorización distinta antes de ejecutar `supabase db push` sin `--dry-run`.

Los comandos `migration repair` y `db push` modifican el proyecto remoto y nunca quedan autorizados por una comprobación previa. El aplicador local recomienda el historial oficial para migraciones incrementales y bloquea estados parciales, nombres inesperados y la reaplicación del baseline.

En una instalación realmente vacía, la única escritura directa admitida por el runner exige la acción y confirmación específicas siguientes:

```powershell
npm run schema:supabase -- --action=initial-install --confirm-initial-install=202608250001+202608300001
```

Antes de escribir, vuelve a comprobar que no existan tablas PIGNUS o SoftGuard. Ejecuta únicamente esas dos migraciones dentro de una sola transacción, elimina sus `BEGIN/COMMIT` externos y verifica los 12 nombres `pignus_*` y los 7 nombres `softguard_*` antes de permitir el commit. Para una instalación administrada normalmente se prefiere `supabase db push`, porque mantiene el historial oficial desde el inicio.

## 3. Migrar los datos actuales

Detener la aplicación local para que SQLite complete sus escrituras. Conservar una copia de `data/agenda-tecnica.db` antes de comenzar.

El script `migrate:supabase` carga `.env.local` mediante el soporte nativo de Node 22. Primero validar únicamente el origen:

```powershell
npm run migrate:supabase -- --dry-run
```

Después de verificar el esquema mediante el historial oficial y obtener autorización explícita para migrar los datos:

```powershell
npm run migrate:supabase -- --confirm
```

El dry-run anterior sólo cuenta y valida el origen. El comando confirmado migra todo dentro de una transacción. Si Supabase ya contiene información, el proceso se detiene para no sobrescribirla.

`--replace` elimina y reemplaza los datos del destino; usarlo únicamente para repetir una migración inicial verificada:

```powershell
npm run migrate:supabase -- --replace --confirm
```

Para migrar otra copia de SQLite:

```powershell
npm run migrate:supabase -- --database='C:\ruta\agenda-tecnica.db'
```

## 4. Configurar Vercel

1. Subir el repositorio a GitHub, GitLab o Bitbucket e importarlo en Vercel.
2. Vercel detectará Vite mediante `vercel.json`.
3. En **Settings > Environment Variables**, cargar para Production, Preview y Development:

   - `DATABASE_URL`: URI de Transaction pooler de Supabase.
   - `PIGNUS_SESSION_SECRET`: valor aleatorio de al menos 32 caracteres.
   - `PIGNUS_RATE_LIMIT_SECRET`: otro valor aleatorio distinto.

Para generar secretos localmente sin publicarlos:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Ejecutar el comando dos veces y guardar cada resultado en una variable diferente. No agregar `.env` al repositorio.

4. Desplegar. El comando de build es `npm run build` y el directorio de salida es `dist`.
5. En **Settings > Functions**, elegir una región de ejecución cercana a la región del proyecto de Supabase para reducir la latencia.

El repositorio local está vinculado a un proyecto Vercel. Si la integración Git está activa y `main` es la rama de producción, un push a `main` puede iniciar automáticamente un despliegue de producción. `vercel.json` define el build, pero no permite comprobar localmente qué rama está configurada como producción. Antes de cualquier push se debe revisar esa asociación en Vercel y tratar `main` como potencialmente desplegable.

## 5. Verificación posterior

1. Abrir `/api/auth/session`: sin iniciar sesión debe responder `401`.
2. Iniciar sesión desde la aplicación con un usuario migrado.
3. Confirmar que carguen clientes, agenda e historial.
4. Realizar un cambio pequeño, recargar y comprobar que persista.
5. Descargar un Excel y un PDF desde el resumen gerencial.
6. Revisar el módulo de auditoría con un administrador.
7. En Supabase, ejecutar Security Advisor y confirmar que las tablas `pignus_*` mantienen RLS habilitado.

## Desarrollo local

`npm run dev` continúa usando SQLite y la API de `server.cjs`. Esto permite trabajar sin conexión a Supabase. Vercel utiliza exclusivamente la función bajo `api/`.

## Copias de seguridad

Después de confirmar el despliegue, conservar la base SQLite original como respaldo histórico. En producción, usar los backups administrados de Supabase y definir una política de recuperación acorde al plan contratado.
