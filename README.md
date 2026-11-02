# Control de ingreso y salida de estudiantes · I.E. El Pescador

Aplicación web para registrar la entrada y salida de estudiantes con lector de código de barras (o la cámara del celular), con tablero de asistencia por grado y mes, reportes, carnés y manejo de usuarios con administrador.

Desarrollado por **Control Integral Digital S.A.S** · *Tu entrada segura en un solo paso*

## Estructura

```
control-acceso-pescador/
├── public/                      ← lo que se publica (Vercel sirve esta carpeta)
│   ├── index.html               pantallas (HTML)
│   ├── estilos.css              diseño y responsivo (CSS)
│   ├── app.js                   lógica (JavaScript)
│   ├── config.js                GENERADO al desplegar desde las variables de entorno (no está en GitHub)
│   └── img/                     escudo de la institución y logo de la empresa
├── scripts/
│   └── generar-config.mjs       crea public/config.js a partir de las variables de entorno
├── supabase/
│   └── supabase.sql             base de datos: se ejecuta una vez en Supabase → SQL Editor
├── docs/
│   └── GUIA.md                  guía completa de instalación y uso
├── .env.example                 plantilla de variables para trabajar en el computador
├── .gitignore                   evita subir claves, config.js y listados de estudiantes
├── package.json                 comando de build (sin dependencias)
└── vercel.json                  configuración de Vercel
```

## Variables de entorno

| Variable | Obligatoria | Dónde se obtiene |
|---|---|---|
| `SUPABASE_URL` | Sí | Supabase → Project Settings → API Keys (o la página de inicio del proyecto) |
| `SUPABASE_PUBLISHABLE_KEY` | Sí | Supabase → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`). También sirve la **anon public** (`eyJ…`). |
| `INSTITUCION`, `MUNICIPIO`, `LEMA`, `EMPRESA`, `ESLOGAN` | No | Textos que aparecen en la app y los carnés. Ya traen los valores de El Pescador. |

> 🔒 **Nunca** use la *Secret key* ni la *service_role*. Si se pone por error, el despliegue se detiene con un mensaje de aviso.

También se aceptan los nombres que crea la integración oficial Supabase ↔ Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

### ¿Por qué la clave igual se ve en el navegador?

Esta app no tiene servidor: corre completa en el navegador, y el navegador necesita la URL y la clave *publishable* para hablar con Supabase. Las variables de entorno sirven para que la clave **no quede escrita en el código ni en GitHub** y para cambiarla sin tocar archivos. La clave *publishable* está hecha para ser pública: lo que protege los datos son los usuarios con contraseña y los permisos por rol definidos en `supabase.sql` (Row Level Security). Sin iniciar sesión con una cuenta aprobada, esa clave no permite leer ni escribir nada.

## Desplegar en Vercel

1. **Base de datos:** en Supabase → SQL Editor, pegue todo `supabase/supabase.sql` y ejecútelo (una sola vez).
2. **GitHub:** cree un repositorio **privado** y suba esta carpeta (sin `.env`).
3. **Vercel:** *Add New → Project* → importe el repositorio.
   - *Framework Preset:* **Other** (el resto lo toma de `vercel.json`).
   - *Environment Variables:* agregue `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`.
   - **Deploy.**
4. **Supabase → Authentication → URL Configuration:** ponga la dirección de Vercel (`https://….vercel.app`) en *Site URL* y en *Redirect URLs*.
5. Abra la app y cree su cuenta: **la primera cuenta queda como administrador.**

Los pasos detallados, con la configuración de Authentication, están en [`docs/GUIA.md`](docs/GUIA.md).

> Si cambia una variable de entorno en Vercel, haga **Deployments → ⋯ → Redeploy**: la configuración se genera en cada despliegue.

## Trabajar en el computador

Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
cp .env.example .env        # en Windows: copy .env.example .env   — y complete la clave
npm run build               # genera public/config.js
npm run dev                 # genera config.js y abre la app en http://localhost:3000
```

Sin variables de Supabase la app arranca en **modo demostración** (datos solo en el navegador). Cuentas de prueba: `admin@demo.co` / `admin123` y `porteria@demo.co` / `porteria123`.
