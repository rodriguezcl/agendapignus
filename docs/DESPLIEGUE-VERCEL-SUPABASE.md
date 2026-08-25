# Despliegue en Vercel con Supabase

La versión web conserva React/Vite y reemplaza la persistencia de producción por PostgreSQL de Supabase. SQLite continúa disponible para desarrollo local y funciona como origen de la migración inicial.

## Arquitectura

- Vercel publica `dist/` y ejecuta `api/index.cjs` como función Node.js.
- Supabase almacena roles, empleados, clientes, servicios, historial, agenda, preferencias y auditoría.
- Las sesiones y los intentos fallidos de acceso también se guardan en PostgreSQL; no dependen de la memoria de una función.
- El navegador nunca recibe `DATABASE_URL` ni accede directamente a las tablas. RLS está activado y los roles `anon` y `authenticated` no tienen permisos sobre los datos operativos.
- Las escrituras del estado se realizan dentro de una transacción y conservan el control de revisión para detectar ediciones concurrentes.

## 1. Crear el proyecto de Supabase

1. Crear un proyecto en Supabase. Elegir, si está disponible, una región cercana a la función de Vercel.
2. En **Connect**, copiar la URI de **Transaction pooler**, puerto `6543`. Es la conexión adecuada para funciones serverless.
3. Después de configurar `.env.local` y recibir autorización explícita para modificar el proyecto remoto, aplicar y verificar el esquema con `npm run schema:supabase -- --confirm`.

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

## 3. Migrar los datos actuales

Detener la aplicación local para que SQLite complete sus escrituras. Conservar una copia de `data/agenda-tecnica.db` antes de comenzar.

El script `migrate:supabase` carga `.env.local` mediante el soporte nativo de Node 22. Primero validar únicamente el origen:

```powershell
npm run migrate:supabase -- --dry-run
```

Después de revisar el conteo y obtener autorización explícita para escribir en la base remota:

```powershell
npm run schema:supabase -- --confirm
npm run migrate:supabase -- --confirm
```

El primer comando sólo cuenta y valida el origen. El segundo migra todo dentro de una transacción. Si Supabase ya contiene información, el proceso se detiene para no sobrescribirla.

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
