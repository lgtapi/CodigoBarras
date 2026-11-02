// ---------------------------------------------------------------------------
//  Genera public/config.js a partir de las VARIABLES DE ENTORNO.
//
//  - En Vercel se ejecuta solo en cada despliegue (npm run build) y toma las
//    variables de Settings → Environment Variables.
//  - En su computador lee el archivo .env (copie .env.example como .env).
//
//  No necesita instalar nada: usa solo Node.js.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'config.js');
const EN_VERCEL = !!process.env.VERCEL;

// 1. Cargar .env.local y .env (solo en el computador; en Vercel no existen)
for (const archivo of ['.env.local', '.env']) {
  const ruta = join(RAIZ, archivo);
  if (!existsSync(ruta)) continue;
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(linea)) continue;
    const m = linea.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let valor = m[2];
    if (/^(['"]).*\1$/.test(valor)) valor = valor.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;   // el panel de Vercel / la terminal tienen prioridad
  }
}

const leer = (...nombres) => {
  for (const n of nombres) { const v = (process.env[n] || '').trim(); if (v) return v; }
  return '';
};

// 2. Variables. Se aceptan también los nombres que crea la integración Supabase ↔ Vercel.
const url = leer('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
const clave = leer('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
                   'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

const errores = [], avisos = [];

// 3. Validaciones de seguridad
function rolJWT(k) {
  try {
    const p = k.split('.')[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || null;
  } catch { return null; }
}
if (clave) {
  if (/^sb_secret_/i.test(clave) || rolJWT(clave) === 'service_role') {
    errores.push('SUPABASE_PUBLISHABLE_KEY contiene una clave SECRETA (secret / service_role). ' +
                 'Esa clave salta todos los permisos y NUNCA debe ir al navegador. ' +
                 'Use la "Publishable key" (sb_publishable_…) o la "anon public".');
  } else if (!/^sb_publishable_/i.test(clave) && rolJWT(clave) !== 'anon') {
    avisos.push('La clave no parece una "publishable" ni una "anon". Revísela en Supabase → Project Settings → API Keys.');
  }
}
if (url && !/^https:\/\/\S+$/i.test(url)) errores.push(`SUPABASE_URL debe empezar por https:// (valor recibido: "${url}").`);
if (url && !/\.supabase\.(co|in)$/i.test(url)) avisos.push(`SUPABASE_URL no termina en .supabase.co (valor: "${url}"). Verifique que esté bien copiada.`);
if (!!url !== !!clave) errores.push(`Falta ${url ? 'SUPABASE_PUBLISHABLE_KEY' : 'SUPABASE_URL'}. Deben estar las dos.`);
if (!url && !clave) {
  if (EN_VERCEL) errores.push('No hay variables de entorno de Supabase. En Vercel: Settings → Environment Variables → agregue SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY y vuelva a desplegar.');
  else avisos.push('Sin variables de Supabase: la app se generó en MODO DEMOSTRACIÓN (datos solo en el navegador).');
}

avisos.forEach(a => console.warn('⚠  ' + a));
if (errores.length) {
  errores.forEach(e => console.error('✖  ' + e));
  console.error('\nNo se generó config.js. Corrija lo anterior y vuelva a intentar.');
  process.exit(1);
}

// 4. Escribir config.js (datos institucionales: variables opcionales con valores por defecto)
const CONFIG = {
  SUPABASE_URL: url,
  SUPABASE_KEY: clave,
  INSTITUCION:  leer('INSTITUCION') || 'Institución Educativa El Pescador',
  MUNICIPIO:    leer('MUNICIPIO')   || 'La Argentina – Huila',
  LEMA:         leer('LEMA')        || 'Humanismo y Productividad',
  EMPRESA:      leer('EMPRESA')     || 'Control Integral Digital S.A.S',
  ESLOGAN:      leer('ESLOGAN')     || 'Tu entrada segura en un solo paso',
  ZONA_HORARIA: 'America/Bogota',
  UTC_OFFSET:   '-05:00',           // Colombia no tiene horario de verano
};

writeFileSync(SALIDA,
`// ARCHIVO GENERADO AUTOMÁTICAMENTE por scripts/generar-config.mjs (npm run build).
// No lo edite ni lo suba a GitHub: se crea a partir de las variables de entorno.
'use strict';
const CONFIG = ${JSON.stringify(CONFIG, null, 2)};
`);

const oculta = clave ? clave.slice(0, 16) + '…' + clave.slice(-4) : '(vacía)';
console.log(`✔  public/config.js generado · ${url ? 'Supabase: ' + url : 'MODO DEMO'} · clave: ${oculta}${EN_VERCEL ? ' · entorno Vercel: ' + (process.env.VERCEL_ENV || '') : ''}`);
