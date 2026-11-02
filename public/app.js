'use strict';
/* Control de ingreso y salida · I.E. El Pescador
   Desarrollado por Control Integral Digital S.A.S
   Lógica de la aplicación. La configuración (config.js) se genera desde las
   variables de entorno con scripts/generar-config.mjs */
if (typeof CONFIG === 'undefined') {          // config.js se genera con "npm run build"
  document.getElementById('vCargando').innerHTML =
    '<div class="card login stack" style="text-align:center"><b>Falta el archivo config.js</b>' +
    '<span class="muted">Se crea a partir de las variables de entorno con <code>npm run build</code>. ' +
    'En Vercel se genera solo al desplegar.</span></div>';
  throw new Error('Falta config.js: ejecute npm run build');
}
const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY;

/* Logos (carpeta img) */
const LOGO_IE = 'img/escudo-pescador.jpg';
const LOGO_EMPRESA = 'img/logo-control-integral.jpg';

/* ============================ UTILIDADES ============================ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' });
const hoyStr   = (d = new Date()) => fmtFecha.format(d);                       // 'YYYY-MM-DD' en Colombia
const inicioDe = s => new Date(`${s}T00:00:00${CONFIG.UTC_OFFSET}`);
const sumarDias = (s, n) => { const d = inicioDe(s); d.setUTCDate(d.getUTCDate() + n); return hoyStr(d); };
const hora      = iso => new Date(iso).toLocaleTimeString('es-CO', { timeZone: CONFIG.ZONA_HORARIA, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const horaCorta = iso => new Date(iso).toLocaleTimeString('es-CO', { timeZone: CONFIG.ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const nombreCompleto = e => `${e.apellidos || ''} ${e.nombres || ''}`.trim();
const curso = e => [e.grado, e.grupo].filter(Boolean).join('-');
const sinTildes = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true, sensitivity: 'base' });
const ordenEst = (a, b) => cmp(a.grado, b.grado) || cmp(a.grupo, b.grupo) || cmp(nombreCompleto(a), nombreCompleto(b));
const H = html => ({ __html: html });
const pillTipo = t => H(`<span class="pill ${t === 'ENTRADA' ? 'in' : 'out'}">${esc(t)}</span>`);

let toastTimer;
function toast(msg, tipo = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'show ' + tipo;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', tipo === 'bad' ? 5000 : 2800);
}

function tabla(sel, headers, filas, max = 1500) {
  const t = $(sel);
  if (!filas.length) { t.innerHTML = '<tbody><tr><td class="muted" style="padding:18px">Sin datos</td></tr></tbody>'; return; }
  const celda = c => (c && typeof c === 'object' && '__html' in c) ? c.__html : esc(c);
  t.innerHTML = `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    filas.slice(0, max).map(r => `<tr>${r.map(c => `<td>${celda(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

function descargarCSV(nombre, headers, filas) {
  const cel = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const txt = '\uFEFF' + [headers, ...filas].map(r => r.map(cel).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const primera = text.split(/\r?\n/)[0] || '';
  const sep = primera.split(';').length >= primera.split(',').length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/* ======================= CAPA DE DATOS: SUPABASE ======================= */
function supaApi() {
  const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  const urlApp = () => location.origin + location.pathname;
  sb.auth.onAuthStateChange(ev => {            // no llamar a Supabase dentro de este callback
    if (ev === 'PASSWORD_RECOVERY') setTimeout(alRecuperarClave, 0);
    if (ev === 'SIGNED_OUT' && PERFIL) setTimeout(() => location.reload(), 0);
  });
  async function todo(fn) {                // trae todas las filas, de 1000 en 1000
    const N = 1000; let desde = 0, out = [];
    for (;;) {
      const { data, error } = await fn().range(desde, desde + N - 1);
      if (error) throw error;
      out = out.concat(data); if (data.length < N) break; desde += N;
    }
    return out;
  }
  const api = {
    async sesion() {
      const { data } = await sb.auth.getSession();
      return data.session ? api.perfil() : null;
    },
    async login(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return api.perfil();
    },
    async logout() { await sb.auth.signOut(); },
    async perfil() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return null;
      const { data, error } = await sb.from('perfiles').select('*').eq('id', user.id).maybeSingle();
      if (error) throw error;
      return data || { id: user.id, email: user.email, rol: 'pendiente' };
    },
    async registrarse(nombre, email, clave) {
      const { data, error } = await sb.auth.signUp({ email, password: clave, options: { data: { nombre }, emailRedirectTo: urlApp() } });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('ya tiene una cuenta');
      return { confirmar: !data.session };
    },
    async recuperar(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: urlApp() });
      if (error) throw error;
    },
    async cambiarClave(clave) {
      const { error } = await sb.auth.updateUser({ password: clave });
      if (error) throw error;
    },
    async actualizarNombre(nombre) {
      const { error } = await sb.from('perfiles').update({ nombre }).eq('id', PERFIL.id);
      if (error) throw error;
    },
    async usuarios() {
      const { data, error } = await sb.rpc('usuarios_lista');
      if (error) throw error;
      return data;
    },
    async cambiarRol(id, rol) {
      const { data, error } = await sb.from('perfiles').update({ rol }).eq('id', id).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('No tiene permiso para cambiar este usuario');
    },
    // Crea la cuenta con un cliente aparte para no cerrar la sesión del administrador
    async crearUsuario({ nombre, email, clave, rol }) {
      const tmp = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-crear-usuario' } });
      const { data, error } = await tmp.auth.signUp({ email, password: clave, options: { data: { nombre }, emailRedirectTo: urlApp() } });
      if (error) throw error;
      if (!data.user || (Array.isArray(data.user.identities) && !data.user.identities.length))
        throw new Error('Ese correo ya tiene una cuenta. Búsquelo en la lista y cámbiele el rol.');
      await api.cambiarRol(data.user.id, rol);
      return { confirmar: !data.session };
    },
    async registrar(codigo, tipo, punto, fechaISO) {
      const { data, error } = await sb.rpc('registrar_movimiento', { p_codigo: codigo, p_tipo: tipo, p_punto: punto, p_fecha_hora: fechaISO || null });
      if (error) throw error;
      return data;
    },
    async resumenHoy() {
      const ini = inicioDe(hoyStr()).toISOString();
      const contar = async t => {
        const { count, error } = await sb.from('movimientos').select('id', { count: 'exact', head: true }).gte('fecha_hora', ini).eq('tipo', t);
        if (error) throw error; return count || 0;
      };
      const pres = sb.from('v_presentes').select('id', { count: 'exact', head: true });
      const [entradas, salidas, p] = await Promise.all([contar('ENTRADA'), contar('SALIDA'), pres]);
      if (p.error) throw p.error;
      return { entradas, salidas, presentes: p.count || 0 };
    },
    movimientos(desdeISO, hastaISO, grado) {
      return todo(() => {
        let q = sb.from('v_movimientos').select('*').gte('fecha_hora', desdeISO).lt('fecha_hora', hastaISO)
          .order('fecha_hora', { ascending: false }).order('id', { ascending: false });
        if (grado) q = q.eq('grado', grado);
        return q;
      });
    },
    async tableroDatos(desde, hasta, limite, conEstudiantes) {
      const { data, error } = await sb.rpc('tablero_datos', { p_desde: desde, p_hasta: hasta, p_limite: limite, p_con_estudiantes: conEstudiantes });
      if (error) throw error;
      return data;
    },
    presentes() { return todo(() => sb.from('v_presentes').select('*').order('id')); },
    estudiantes() { return todo(() => sb.from('estudiantes').select('*').order('id')); },
    async guardarEstudiante(e) {
      const { id, ...datos } = e;
      const { error } = id ? await sb.from('estudiantes').update(datos).eq('id', id)
                           : await sb.from('estudiantes').insert(datos);
      if (error) throw new Error(error.code === '23505' ? 'Ya existe un estudiante con ese código' : error.message);
    },
    async importar(filas) {
      for (let i = 0; i < filas.length; i += 500) {
        const { error } = await sb.from('estudiantes').upsert(filas.slice(i, i + 500), { onConflict: 'codigo' });
        if (error) throw error;
      }
    },
  };
  return api;
}

/* ===================== CAPA DE DATOS: MODO DEMO ===================== */
function demoApi() {
  const K = 'ce_demo_v1';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2));
  const semilla = () => {
    const base = [['Valentina','Rojas Perdomo','6','01'],['Santiago','Muñoz Cerón','6','01'],['Mariana','Gómez Tovar','7','02'],
      ['Juan David','Cabrera Losada','8','01'],['Sofía','Ramírez Quintero','9','01'],['Samuel','Trujillo Vargas','10','01'],
      ['Isabella','Ortiz Calderón','11','01'],['Miguel Ángel','Polanco Rivera','11','02']];
    return { estudiantes: base.map((b, i) => ({ id: uid(), codigo: String(1001 + i), documento: String(1080210000 + i * 137),
      nombres: b[0], apellidos: b[1], grado: b[2], grupo: b[3], jornada: 'MAÑANA', acudiente: '', telefono_acudiente: '', foto_url: '', activo: true })),
      movimientos: [] };
  };
  const SES = 'ce_demo_sesion';
  const usuariosDemo = () => {
    const ahora = new Date().toISOString();
    return [
      { id: 'u-admin', email: 'admin@demo.co', nombre: 'Coordinación (demo)', rol: 'admin', clave: 'admin123', creado_en: ahora, ultimo_ingreso: null },
      { id: 'u-port', email: 'porteria@demo.co', nombre: 'Portería principal (demo)', rol: 'porteria', clave: 'porteria123', creado_en: ahora, ultimo_ingreso: null },
      { id: 'u-pend', email: 'docente@demo.co', nombre: 'Docente que pidió acceso (demo)', rol: 'pendiente', clave: 'docente123', creado_en: ahora, ultimo_ingreso: ahora },
    ];
  };
  let db = store.get(K, null) || semilla();
  if (!Array.isArray(db.usuarios)) db.usuarios = usuariosDemo();
  const guardar = () => store.set(K, db);
  guardar();
  const yo = () => db.usuarios.find(u => u.id === store.get(SES, null));
  const publico = u => u ? { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol } : null;
  const exigirAdmin = () => { const u = yo(); if (!u || u.rol !== 'admin') throw new Error('Solo el administrador puede hacer esto'); };
  const porId = id => db.estudiantes.find(e => e.id === id);
  const info = e => ({ id: e.id, codigo: e.codigo, documento: e.documento, nombres: e.nombres, apellidos: e.apellidos, grado: e.grado, grupo: e.grupo, jornada: e.jornada, foto_url: e.foto_url });
  const api = {
    async sesion() { return publico(yo()); },
    async perfil() { return publico(yo()); },
    async login(email, clave) {
      const u = db.usuarios.find(x => x.email === email.trim().toLowerCase());
      if (!u || u.clave !== clave) throw new Error('Invalid login credentials');
      u.ultimo_ingreso = new Date().toISOString(); guardar(); store.set(SES, u.id);
      return publico(u);
    },
    async logout() { store.set(SES, null); },
    async registrarse(nombre, email, clave) {
      email = email.trim().toLowerCase();
      if (db.usuarios.some(u => u.email === email)) throw new Error('ya tiene una cuenta');
      const ahora = new Date().toISOString();
      const u = { id: uid(), email, nombre, clave, creado_en: ahora, ultimo_ingreso: ahora,
        rol: db.usuarios.some(x => x.rol === 'admin') ? 'pendiente' : 'admin' };
      db.usuarios.push(u); guardar(); store.set(SES, u.id);
      return { confirmar: false };
    },
    async recuperar() { throw new Error('En modo demostración no se envían correos. Use las cuentas de prueba que aparecen arriba.'); },
    async cambiarClave(clave) { yo().clave = clave; guardar(); },
    async actualizarNombre(nombre) { yo().nombre = nombre; guardar(); },
    async usuarios() {
      exigirAdmin();
      return db.usuarios.map(u => ({ ...publico(u), creado_en: u.creado_en, ultimo_ingreso: u.ultimo_ingreso, correo_confirmado: true }));
    },
    async cambiarRol(id, rol) {
      exigirAdmin();
      const u = db.usuarios.find(x => x.id === id); if (!u) throw new Error('Usuario no encontrado');
      if (u.rol === 'admin' && rol !== 'admin' && db.usuarios.filter(x => x.rol === 'admin').length <= 1) throw new Error('Debe quedar al menos un administrador');
      u.rol = rol; guardar();
    },
    async crearUsuario({ nombre, email, clave, rol }) {
      exigirAdmin(); email = email.trim().toLowerCase();
      if (db.usuarios.some(u => u.email === email)) throw new Error('Ese correo ya tiene una cuenta. Búsquelo en la lista y cámbiele el rol.');
      db.usuarios.push({ id: uid(), email, nombre, rol, clave, creado_en: new Date().toISOString(), ultimo_ingreso: null }); guardar();
      return { confirmar: false };
    },
    async registrar(codigo, tipo, punto, fechaISO) {
      const c = String(codigo).trim(); let f = fechaISO ? new Date(fechaISO) : new Date();
      if (f > new Date()) f = new Date();
      const e = db.estudiantes.find(x => x.codigo === c) || db.estudiantes.find(x => x.documento === c);
      if (!e) return { ok: false, estado: 'NO_ENCONTRADO', codigo: c };
      if (!e.activo) return { ok: false, estado: 'INACTIVO', codigo: c, estudiante: info(e) };
      const ini = inicioDe(hoyStr(f));
      const ult = db.movimientos.filter(m => m.estudiante_id === e.id && new Date(m.fecha_hora) >= ini && new Date(m.fecha_hora) <= f)
        .sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora))[0];
      if (ult && f - new Date(ult.fecha_hora) < 60000)
        return { ok: false, estado: 'DUPLICADO', codigo: c, estudiante: info(e), tipo: ult.tipo, fecha_hora: ult.fecha_hora };
      const t = tipo || (ult && ult.tipo === 'ENTRADA' ? 'SALIDA' : 'ENTRADA');
      const adv = t === 'SALIDA' && (!ult || ult.tipo !== 'ENTRADA') ? 'Salida sin entrada registrada hoy'
                : t === 'ENTRADA' && ult && ult.tipo === 'ENTRADA' ? 'Ya tenía una entrada registrada hoy' : null;
      const m = { id: Date.now(), estudiante_id: e.id, tipo: t, fecha_hora: f.toISOString(), punto: punto || 'Principal', registrado_por: store.get(SES, null) };
      db.movimientos.push(m); guardar();
      return { ok: true, estado: 'REGISTRADO', codigo: c, estudiante: info(e), tipo: t, fecha_hora: m.fecha_hora, advertencia: adv };
    },
    async presentes() {
      const ini = inicioDe(hoyStr()); const ult = new Map();
      for (const m of db.movimientos) {
        if (new Date(m.fecha_hora) < ini) continue;
        const u = ult.get(m.estudiante_id);
        if (!u || new Date(m.fecha_hora) > new Date(u.fecha_hora)) ult.set(m.estudiante_id, m);
      }
      return [...ult.values()].filter(m => m.tipo === 'ENTRADA').map(m => ({ ...info(porId(m.estudiante_id) || {}), entrada: m.fecha_hora }));
    },
    async resumenHoy() {
      const ini = inicioDe(hoyStr()); const hoy = db.movimientos.filter(m => new Date(m.fecha_hora) >= ini);
      return { entradas: hoy.filter(m => m.tipo === 'ENTRADA').length, salidas: hoy.filter(m => m.tipo === 'SALIDA').length, presentes: (await api.presentes()).length };
    },
    async movimientos(desdeISO, hastaISO, grado) {
      const a = new Date(desdeISO), b = new Date(hastaISO);
      return db.movimientos.filter(m => { const d = new Date(m.fecha_hora); return d >= a && d < b; })
        .map(m => { const e = porId(m.estudiante_id) || {}; return { ...m, ...info(e), id: m.id, estudiante_id: m.estudiante_id, registrado_por_nombre: (db.usuarios.find(u => u.id === m.registrado_por) || {}).nombre || '' }; })
        .filter(m => !grado || m.grado === grado)
        .sort((x, y) => new Date(y.fecha_hora) - new Date(x.fecha_hora));
    },
    async estudiantes() { return db.estudiantes.map(e => ({ ...e })); },
    async guardarEstudiante(e) {
      if (db.estudiantes.some(x => x.codigo === e.codigo && x.id !== e.id)) throw new Error('Ya existe un estudiante con ese código');
      if (e.id) Object.assign(porId(e.id), e); else db.estudiantes.push({ ...e, id: uid() });
      guardar();
    },
    async importar(filas) {
      for (const r of filas) { const x = db.estudiantes.find(e => e.codigo === r.codigo); if (x) Object.assign(x, r); else db.estudiantes.push({ activo: true, jornada: 'MAÑANA', ...r, id: uid() }); }
      guardar();
    },
    reiniciar() { db = { ...semilla(), usuarios: db.usuarios }; guardar(); },

    // mismo resultado que la función tablero_datos de Supabase
    async tableroDatos(desde, hasta, limite, conEstudiantes) {
      const a = inicioDe(desde), b = inicioDe(sumarDias(hasta, 1)), dia = new Map();
      for (const m of db.movimientos) {
        const d = new Date(m.fecha_hora); if (d < a || d >= b) continue;
        const e = porId(m.estudiante_id); if (!e) continue;
        const f = hoyStr(d), k = f + '|' + e.id;
        let r = dia.get(k);
        if (!r) dia.set(k, r = { fecha: f, grado: e.grado, est: e.id, llegada: null, salida: false });
        if (m.tipo === 'ENTRADA' && (!r.llegada || d < r.llegada)) r.llegada = d;
        if (m.tipo === 'SALIDA') r.salida = true;
      }
      const tarde = r => !!r.llegada && horaCorta(r.llegada) > limite;
      const dias = new Map(), franjas = new Map(), porEst = new Map();
      for (const r of dia.values()) {
        const k = r.fecha + '|' + r.grado;
        const x = dias.get(k) || { fecha: r.fecha, grado: r.grado, presentes: 0, tardes: 0, sin_salida: 0 };
        x.presentes++; if (tarde(r)) x.tardes++; if (!r.salida) x.sin_salida++; dias.set(k, x);
        if (r.llegada) {
          const [hh, mm] = horaCorta(r.llegada).split(':').map(Number);
          const fr = String(hh).padStart(2, '0') + ':' + String(Math.floor(mm / 15) * 15).padStart(2, '0');
          const kf = r.grado + '|' + fr; const y = franjas.get(kf) || { grado: r.grado, franja: fr, n: 0 }; y.n++; franjas.set(kf, y);
        }
        const p = porEst.get(r.est) || { presentes: 0, tardes: 0 }; p.presentes++; if (tarde(r)) p.tardes++; porEst.set(r.est, p);
      }
      const activos = new Map();
      db.estudiantes.filter(e => e.activo).forEach(e => activos.set(e.grado, (activos.get(e.grado) || 0) + 1));
      return {
        dias: [...dias.values()],
        franjas: [...franjas.values()],
        activos: [...activos].map(([grado, n]) => ({ grado, n })),
        estudiantes: conEstudiantes ? db.estudiantes.filter(e => e.activo).map(e => ({
          id: e.id, codigo: e.codigo, nombres: e.nombres, apellidos: e.apellidos, grado: e.grado, grupo: e.grupo,
          acudiente: e.acudiente, telefono_acudiente: e.telefono_acudiente, ...(porEst.get(e.id) || { presentes: 0, tardes: 0 }) })) : [],
      };
    },

    // Crea ~36 estudiantes y lecturas desde febrero hasta ayer, solo para ver el tablero en la demo
    generarHistorial() {
      const N = ['Daniela','Mateo','Laura','Sebastián','Camila','Nicolás','Paula','Andrés','Juliana','Felipe','Sara','Tomás','Gabriela','David','Natalia','Esteban','Manuela','Julián'];
      const A = ['Perdomo','Cerquera','Losada','Tovar','Quintero','Calderón','Rivera','Vargas','Salazar','Bermeo','Polanía','Charry','Cuéllar','Medina'];
      let n = 0;
      for (const g of ['6', '7', '8', '9', '10', '11']) {
        while (db.estudiantes.filter(e => e.grado === g).length < 6) {
          n++;
          db.estudiantes.push({ id: uid(), codigo: String(2000 + db.estudiantes.length), documento: String(1080300000 + db.estudiantes.length * 71),
            nombres: N[(n * 7) % N.length], apellidos: `${A[(n * 5) % A.length]} ${A[(n * 3 + 1) % A.length]}`, grado: g, grupo: '01',
            jornada: 'MAÑANA', acudiente: '', telefono_acudiente: '', foto_url: '', activo: true });
        }
      }
      const hoy = hoyStr(), anio = hoy.slice(0, 4);
      db.movimientos = db.movimientos.filter(m => hoyStr(new Date(m.fecha_hora)) === hoy);
      const receso = s => (s >= `${anio}-03-30` && s <= `${anio}-04-03`) || (s >= `${anio}-06-15` && s <= `${anio}-07-03`) || (s >= `${anio}-10-05` && s <= `${anio}-10-09`);
      let semilla = 12345; const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
      const perfil = new Map(db.estudiantes.map((e, i) => [e.id, { asis: 0.78 + rnd() * 0.2 - (e.grado === '11' ? 0.04 : 0), tarde: rnd() * 0.25 }]));
      let id = 1;
      for (let s = `${anio}-02-02`; s < hoy; s = sumarDias(s, 1)) {
        const dow = inicioDe(s).getUTCDay();
        if (dow === 0 || dow === 6 || receso(s)) continue;
        const mes = +s.slice(5, 7), ajusteMes = mes === 6 || mes === 11 ? -0.05 : 0;
        const base = inicioDe(s).getTime();
        for (const e of db.estudiantes) {
          if (!e.activo) continue;
          const p = perfil.get(e.id);
          if (rnd() > p.asis + ajusteMes) continue;
          const minLlegada = rnd() < p.tarde ? 7 * 60 + 1 + rnd() * 35 : 6 * 60 + 10 + rnd() * 49;
          db.movimientos.push({ id: id++, estudiante_id: e.id, tipo: 'ENTRADA', fecha_hora: new Date(base + minLlegada * 60000 + rnd() * 59000).toISOString(), punto: 'Principal' });
          if (rnd() < 0.92) db.movimientos.push({ id: id++, estudiante_id: e.id, tipo: 'SALIDA', fecha_hora: new Date(base + (12 * 60 + 15 + rnd() * 35) * 60000).toISOString(), punto: 'Principal' });
        }
      }
      guardar();
    },
  };
  return api;
}

let RECUPERANDO = /type=recovery/.test(location.hash);
const api = DEMO ? demoApi() : supaApi();

/* ============================== ESTADO ============================== */
let PERFIL = null;
let EST = null;                                   // caché de estudiantes
const esAdmin = () => PERFIL && PERFIL.rol === 'admin';

async function getEst(forzar = false) {
  if (!EST || forzar) { EST = (await api.estudiantes()).sort(ordenEst); llenarGrados(); }
  return EST;
}
function llenarGrados() {
  const grados = [...new Set((EST || []).map(e => e.grado).filter(Boolean))].sort(cmp);
  $$('.sel-grado').forEach(s => {
    const v = s.value;
    s.innerHTML = '<option value="">Todos</option>' + grados.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    if (grados.includes(v)) s.value = v;
  });
}

/* ========================== INICIO / SESIÓN ========================== */
async function iniciar() {
  $('#nombreInst').textContent = CONFIG.INSTITUCION;
  $('#subInst').textContent = `${CONFIG.MUNICIPIO} · Control de ingreso y salida`;
  $('#logoIEHead').src = LOGO_IE;
  $$('.logoIE').forEach(i => i.src = LOGO_IE);
  $$('.logoEmp').forEach(i => i.src = LOGO_EMPRESA);
  $$('.nomInst').forEach(n => n.textContent = CONFIG.INSTITUCION);
  $$('.nomEmp').forEach(n => n.textContent = 'Desarrollado por ' + CONFIG.EMPRESA);
  $$('.eslogan').forEach(n => n.textContent = CONFIG.ESLOGAN);
  document.title = 'Control de Acceso · ' + CONFIG.INSTITUCION;
  if (DEMO) { $('#badgeDemo').hidden = false; $('#bannerDemo').hidden = false; $('#demoCred').hidden = false; }
  try { PERFIL = await api.sesion(); } catch (err) { console.error(err); PERFIL = null; }
  $('#vCargando').hidden = true;
  PERFIL ? entrar() : ($('#vLogin').hidden = false);
}

const ROLES = { admin: 'Administrador', porteria: 'Portería', pendiente: 'Pendiente', inactivo: 'Desactivado' };
const MSG_AUTH = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos'],
  [/email not confirmed/i, 'Primero confirme su correo: abra el enlace que le llegó (revise también la carpeta de spam)'],
  [/already registered|already been registered|ya tiene una cuenta/i, 'Ese correo ya tiene una cuenta'],
  [/at least \d+ characters|password should be|weak password/i, 'La contraseña es muy corta o muy débil'],
  [/rate limit|too many|for security purposes/i, 'Demasiados intentos seguidos. Espere unos minutos y vuelva a intentar'],
  [/signups? (are )?not allowed|signup is disabled|signups? disabled/i, 'La creación de cuentas está desactivada en Supabase (vea la guía, paso 3)'],
  [/should be different|same as the old|same password/i, 'La nueva contraseña debe ser diferente a la anterior'],
  [/unable to validate email|invalid email|email address .* invalid/i, 'El correo no es válido'],
  [/failed to fetch|networkerror|load failed/i, 'Sin conexión con el servidor. Revise el internet'],
];
const msgAuth = err => { const m = String(err && (err.message || err)); const x = MSG_AUTH.find(([r]) => r.test(m)); return x ? x[1] : m; };

async function conBoton(btn, texto, fn) {
  const t = btn.textContent; btn.disabled = true; btn.textContent = texto;
  try { return await fn(); }
  catch (err) { toast(msgAuth(err), 'bad'); }
  finally { btn.disabled = false; btn.textContent = t; }
}

function vistaAuth(v) {
  const f = { login: '#frmLogin', registro: '#frmRegistro', recuperar: '#frmRecuperar' };
  Object.entries(f).forEach(([k, sel]) => $(sel).hidden = k !== v);
  const em = $('#lgEmail').value || $('#rgEmail').value || $('#rcEmail').value;
  if (em) ['#lgEmail', '#rgEmail', '#rcEmail'].forEach(sel => { if (!$(sel).value) $(sel).value = em; });
  setTimeout(() => { const i = $(f[v] + ' input:not([type=checkbox])'); if (i && !i.value) i.focus(); }, 30);
}
$('#vLogin').addEventListener('click', e => { const a = e.target.closest('[data-ir]'); if (a) { e.preventDefault(); vistaAuth(a.dataset.ir); } });
document.addEventListener('change', e => {
  const c = e.target.closest('.verClave'); if (!c) return;
  c.dataset.campos.split(',').forEach(sel => { const i = document.querySelector(sel.trim()); if (i) i.type = c.checked ? 'text' : 'password'; });
});

$('#frmLogin').addEventListener('submit', ev => {
  ev.preventDefault();
  conBoton($('#btnLogin'), 'Ingresando…', async () => {
    PERFIL = await api.login($('#lgEmail').value.trim(), $('#lgPass').value);
    $('#lgPass').value = '';
    entrar();
  });
});

$('#frmRegistro').addEventListener('submit', ev => {
  ev.preventDefault();
  const nombre = $('#rgNombre').value.trim(), email = $('#rgEmail').value.trim(), c1 = $('#rgPass').value, c2 = $('#rgPass2').value;
  if (c1.length < 8) return toast('La contraseña debe tener mínimo 8 caracteres', 'bad');
  if (c1 !== c2) return toast('Las contraseñas no coinciden', 'bad');
  conBoton($('#btnRegistro'), 'Creando cuenta…', async () => {
    const r = await api.registrarse(nombre, email, c1);
    $('#rgPass').value = $('#rgPass2').value = '';
    if (r.confirmar) {
      vistaAuth('login'); $('#lgEmail').value = email;
      toast('Cuenta creada. Abra el enlace de confirmación que le llegó al correo y luego ingrese.');
    } else { PERFIL = await api.sesion(); if (PERFIL) entrar(); }
  });
});

$('#frmRecuperar').addEventListener('submit', ev => {
  ev.preventDefault();
  conBoton($('#btnRecuperar'), 'Enviando…', async () => {
    await api.recuperar($('#rcEmail').value.trim());
    vistaAuth('login');
    toast('Si el correo está registrado, le llegará un enlace para crear una contraseña nueva.');
  });
});

$('#btnSalir').onclick = $('#btnSalir2').onclick = async () => { await detenerCamara(); try { await api.logout(); } catch {} location.reload(); };
$('#btnReintentar').onclick = () => location.reload();

function pintarUsuario() {
  $('#userName').textContent = `${PERFIL.nombre || PERFIL.email || ''} · ${ROLES[PERFIL.rol] || PERFIL.rol}`;
}

let YA_ENTRO = false;
function entrar() {
  $('#vLogin').hidden = true;
  $('#userbox').hidden = false;
  pintarUsuario();
  if (RECUPERANDO) { RECUPERANDO = false; abrirCuenta(true); }
  if (!['admin', 'porteria'].includes(PERFIL.rol)) {
    const inactivo = PERFIL.rol === 'inactivo';
    $('#spTitulo').textContent = inactivo ? 'Cuenta desactivada' : 'Cuenta pendiente de aprobación';
    $('#spTexto').innerHTML = inactivo
      ? `La cuenta <b>${esc(PERFIL.email || '')}</b> fue desactivada por el administrador. Si cree que es un error, comuníquese con coordinación.`
      : `La cuenta <b>${esc(PERFIL.email || '')}</b> fue creada, pero el administrador todavía no le ha dado acceso. Pídale que la apruebe en la pestaña <b>Usuarios</b> y luego toque "Volver a revisar".`;
    $('#vSinPermiso').hidden = false;
    return;
  }
  if (YA_ENTRO) return; YA_ENTRO = true;
  $('#vSinPermiso').hidden = true;
  $('#app').hidden = false;
  $$('.solo-admin').forEach(el => el.hidden = !esAdmin());
  prepararEscaner();
  irTab('escanear');
  getEst().catch(err => console.warn(err));
  actualizarResumen();
  pintarCola();
  if (esAdmin()) cargarUsuarios(true);
  setInterval(actualizarResumen, 60000);
  setInterval(enviarCola, 30000);
  window.addEventListener('online', enviarCola);
  enviarCola();
}

function alRecuperarClave() {
  if (PERFIL) abrirCuenta(true); else RECUPERANDO = true;
}

/* --------------------------- MI CUENTA --------------------------- */
const dlgCuenta = $('#dlgCuenta'), frmCuenta = $('#frmCuenta');
function abrirCuenta(recuperacion = false) {
  if (!PERFIL || dlgCuenta.open) return;
  frmCuenta.reset();
  frmCuenta.dataset.modo = recuperacion ? 'rec' : '';
  frmCuenta.querySelectorAll('[name=clave],[name=clave2]').forEach(i => i.type = 'password');
  $('#cuentaTitulo').textContent = recuperacion ? 'Cree su nueva contraseña' : 'Mi cuenta';
  $('#cuentaInfo').textContent = `${PERFIL.email || ''} · ${ROLES[PERFIL.rol] || PERFIL.rol}`;
  $('#cuentaNombreWrap').hidden = recuperacion;
  $('#cuentaAyuda').textContent = recuperacion ? 'Mínimo 8 caracteres.' : 'Mínimo 8 caracteres. Deje la contraseña en blanco si no la quiere cambiar.';
  $('#btnCancelarCuenta').hidden = recuperacion;
  frmCuenta.elements.nombre.value = PERFIL.nombre || '';
  dlgCuenta.showModal();
  setTimeout(() => (recuperacion ? frmCuenta.elements.clave : frmCuenta.elements.nombre).focus(), 30);
}
$('#btnCuenta').onclick = () => abrirCuenta(false);
$('#btnCancelarCuenta').onclick = () => dlgCuenta.close();
dlgCuenta.addEventListener('cancel', e => { if (frmCuenta.dataset.modo === 'rec') e.preventDefault(); });
frmCuenta.addEventListener('submit', ev => {
  ev.preventDefault();
  const rec = frmCuenta.dataset.modo === 'rec';
  const nombre = frmCuenta.elements.nombre.value.trim(), c1 = frmCuenta.elements.clave.value, c2 = frmCuenta.elements.clave2.value;
  if (rec || c1 || c2) {
    if (c1.length < 8) return toast('La contraseña debe tener mínimo 8 caracteres', 'bad');
    if (c1 !== c2) return toast('Las contraseñas no coinciden', 'bad');
  }
  conBoton($('#btnGuardarCuenta'), 'Guardando…', async () => {
    if (!rec && nombre && nombre !== PERFIL.nombre) { await api.actualizarNombre(nombre); PERFIL.nombre = nombre; pintarUsuario(); }
    if (c1) await api.cambiarClave(c1);
    dlgCuenta.close();
    toast(c1 ? 'Contraseña actualizada' : 'Datos guardados');
  });
});

/* --------------------------- USUARIOS (admin) --------------------------- */
let USRS = [];
const fechaHora = iso => `${hoyStr(new Date(iso))} ${horaCorta(iso)}`;
async function cargarUsuarios(soloContar = false) {
  if (!esAdmin()) return;
  if (!soloContar) $('#usrInfo').textContent = 'Cargando…';
  try {
    USRS = await api.usuarios();
    const pend = USRS.filter(u => u.rol === 'pendiente').length, b = $('#badgePend');
    b.hidden = !pend; b.textContent = pend;
    if (!soloContar) pintarUsuarios();
  } catch (err) { if (!soloContar) $('#usrInfo').textContent = 'Error: ' + msgAuth(err); }
}
function pintarUsuarios() {
  const q = sinTildes($('#buscarUsr').value);
  const orden = { pendiente: 0, admin: 1, porteria: 2, inactivo: 3 };
  const l = USRS.filter(u => !q || sinTildes(`${u.nombre || ''} ${u.email || ''}`).includes(q))
    .sort((a, b) => (orden[a.rol] ?? 9) - (orden[b.rol] ?? 9) || cmp(a.nombre || a.email, b.nombre || b.email));
  const n = r => USRS.filter(u => u.rol === r).length;
  $('#usrInfo').textContent = `${USRS.length} usuario(s) · ${n('admin')} administrador(es) · ${n('porteria')} de portería` +
    (n('pendiente') ? ` · ${n('pendiente')} esperando aprobación` : '') + (n('inactivo') ? ` · ${n('inactivo')} desactivado(s)` : '');
  const estado = u =>
    (u.rol === 'pendiente' ? '<span class="pill warn">Esperando aprobación</span>'
      : u.rol === 'inactivo' ? '<span class="pill bad">Sin acceso</span>' : '<span class="pill in">Con acceso</span>') +
    (u.correo_confirmado === false ? ' <span class="pill">Correo sin confirmar</span>' : '') +
    (PERFIL && u.id === PERFIL.id ? ' <span class="pill out">Usted</span>' : '');
  tabla('#tablaUsr', ['Nombre', 'Correo', 'Rol', 'Estado', 'Último ingreso', 'Creado'], l.map(u => [
    u.nombre || '', u.email || '',
    H(`<select data-rol="${esc(u.id)}" aria-label="Rol de ${esc(u.nombre || u.email)}" style="min-width:150px">${
      Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === u.rol ? ' selected' : ''}>${v}</option>`).join('')}</select>`),
    H(estado(u)),
    u.ultimo_ingreso ? fechaHora(u.ultimo_ingreso) : 'Nunca',
    u.creado_en ? hoyStr(new Date(u.creado_en)) : '',
  ]));
}
$('#buscarUsr').oninput = () => pintarUsuarios();
$('#btnUsrAct').onclick = () => cargarUsuarios();
$('#tablaUsr').addEventListener('change', async e => {
  const s = e.target.closest('select[data-rol]'); if (!s) return;
  const u = USRS.find(x => String(x.id) === s.dataset.rol); if (!u) return;
  const nuevo = s.value, propio = PERFIL && u.id === PERFIL.id;
  let msg = `¿Cambiar el rol de ${u.nombre || u.email} a "${ROLES[nuevo]}"?`;
  if (nuevo === 'admin') msg += '\n\nTendrá control total del sistema, incluida esta pestaña de usuarios.';
  if (propio && nuevo !== 'admin') msg += '\n\nAtención: usted dejará de ser administrador.';
  if (!confirm(msg)) { s.value = u.rol; return; }
  s.disabled = true;
  try {
    await api.cambiarRol(u.id, nuevo);
    toast('Rol actualizado');
    if (propio) return location.reload();
    await cargarUsuarios();
  } catch (err) { toast(msgAuth(err), 'bad'); s.value = u.rol; s.disabled = false; }
});

const dlgUsr = $('#dlgUsr'), frmUsr = $('#frmUsr');
const genClave = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint32Array(10))].map(x => a[x % a.length]).join('');
};
$('#btnNuevoUsr').onclick = () => { frmUsr.reset(); frmUsr.elements.clave.value = genClave(); dlgUsr.showModal(); };
$('#btnGenClave').onclick = () => { frmUsr.elements.clave.value = genClave(); };
$('#btnCancelarUsr').onclick = () => dlgUsr.close();
frmUsr.addEventListener('submit', ev => {
  ev.preventDefault();
  const d = { nombre: frmUsr.elements.nombre.value.trim(), email: frmUsr.elements.email.value.trim().toLowerCase(),
              clave: frmUsr.elements.clave.value.trim(), rol: frmUsr.elements.rol.value };
  if (d.clave.length < 8) return toast('La contraseña debe tener mínimo 8 caracteres', 'bad');
  conBoton($('#btnCrearUsr'), 'Creando…', async () => {
    const r = await api.crearUsuario(d);
    dlgUsr.close();
    await cargarUsuarios();
    alert(`Usuario creado\n\nNombre: ${d.nombre}\nCorreo: ${d.email}\nContraseña: ${d.clave}\nRol: ${ROLES[d.rol]}\n\n` +
      (r.confirmar ? 'Antes de ingresar, la persona debe abrir el enlace de confirmación que le llegó al correo.' : 'Ya puede ingresar.'));
  });
});

/* ============================== PESTAÑAS ============================== */
function irTab(t) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach(s => s.hidden = s.id !== 't-' + t);
  if (t !== 'escanear') detenerCamara();
  if (t === 'escanear') enfocar();
  if (t === 'hoy') cargarHoy();
  if (t === 'tablero') cargarTablero();
  if (t === 'estudiantes') cargarEstudiantes();
  if (t === 'usuarios') cargarUsuarios();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) irTab(b.dataset.tab); });

/* ============================== ESCÁNER ============================== */
let MODO = store.get('ce_modo', 'AUTO');
let ocupado = false, ultCodigo = '', ultTs = 0, camara = null, camaraOn = false;
const recientes = [];
const AYUDA_MODO = {
  AUTO: 'Alterna según el último registro del día: si el estudiante ya entró, se registra su salida.',
  ENTRADA: 'Todas las lecturas se registran como ENTRADA (útil al inicio de la jornada).',
  SALIDA: 'Todas las lecturas se registran como SALIDA (útil al final de la jornada).',
};

function prepararEscaner() {
  const pintarModo = () => {
    $$('#segModo button').forEach(b => b.classList.toggle('on', b.dataset.v === MODO));
    $('#ayudaModo').textContent = AYUDA_MODO[MODO];
  };
  $('#segModo').onclick = e => { const b = e.target.closest('button'); if (!b) return; MODO = b.dataset.v; store.set('ce_modo', MODO); pintarModo(); enfocar(); };
  pintarModo();

  const punto = $('#inPunto'); punto.value = store.get('ce_punto', 'Portería principal');
  punto.onchange = () => store.set('ce_punto', punto.value.trim());

  const lector = $('#chkLector'); lector.checked = store.get('ce_lector', false);
  const aplicarLector = () => { $('#inCodigo').setAttribute('inputmode', lector.checked ? 'none' : 'text'); store.set('ce_lector', lector.checked); };
  lector.onchange = () => { aplicarLector(); enfocar(); }; aplicarLector();

  const sonido = $('#chkSonido'); sonido.checked = store.get('ce_sonido', true);
  sonido.onchange = () => store.set('ce_sonido', sonido.checked);

  $('#inCodigo').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const v = e.target.value; e.target.value = ''; procesar(v, false); }
  });
  $('#btnRegistrar').onclick = () => { const i = $('#inCodigo'); const v = i.value; i.value = ''; procesar(v, false); };
  $('#btnCamara').onclick = () => camaraOn ? detenerCamara() : iniciarCamara();

  // mantener el cursor en el campo de código para el lector físico
  document.addEventListener('click', e => {
    if ($('#t-escanear').hidden || $('#app').hidden) return;
    if (e.target.closest('input,select,textarea,button,a,label,dialog')) return;
    enfocar();
  });
}

function enfocar() {
  const i = $('#inCodigo');
  if (i && !$('#t-escanear').hidden) setTimeout(() => i.focus({ preventScroll: true }), 60);
}

async function procesar(raw, desdeCamara) {
  const codigo = String(raw || '').trim();
  if (!codigo || ocupado) return;
  const ahora = Date.now();
  if (desdeCamara && codigo === ultCodigo && ahora - ultTs < 4000) return;   // la cámara lee muchas veces seguidas
  ultCodigo = codigo; ultTs = ahora;
  ocupado = true;
  const tipo = MODO === 'AUTO' ? null : MODO;
  const punto = $('#inPunto').value.trim() || 'Principal';
  try {
    const r = await api.registrar(codigo, tipo, punto);
    mostrarResultado(r);
    if (r.ok) agregarReciente(r);
  } catch (err) {
    if (esErrorRed(err)) {
      encolar({ codigo, tipo, punto, fecha_hora: new Date().toISOString() });
      const r = { ok: true, estado: 'PENDIENTE', codigo, tipo, fecha_hora: new Date().toISOString() };
      mostrarResultado(r); agregarReciente(r);
    } else {
      mostrarResultado({ ok: false, estado: 'ERROR', codigo, mensaje: err.message || String(err) });
    }
  } finally {
    ocupado = false;
    programarResumen();
    enfocar();
  }
}

function mostrarResultado(r) {
  const card = $('#resultado'); const e = r.estudiante;
  let cls, titulo, det;
  switch (r.estado) {
    case 'REGISTRADO': cls = r.tipo === 'ENTRADA' ? 'in' : 'out'; titulo = r.tipo; det = `Registrada a las ${hora(r.fecha_hora)}`; sonar(r.advertencia ? 'warn' : 'ok'); break;
    case 'DUPLICADO': cls = 'warn'; titulo = 'YA REGISTRADO'; det = `${r.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada a las ${hora(r.fecha_hora)} (hace menos de 1 minuto)`; sonar('warn'); break;
    case 'PENDIENTE': cls = 'pend'; titulo = 'GUARDADO SIN CONEXIÓN'; det = `Código ${r.codigo} · se enviará automáticamente al volver el internet`; sonar('ok'); break;
    case 'NO_ENCONTRADO': cls = 'bad'; titulo = 'CÓDIGO NO REGISTRADO'; det = `Código leído: ${r.codigo}`; sonar('bad'); break;
    case 'INACTIVO': cls = 'bad'; titulo = 'ESTUDIANTE INACTIVO'; det = 'Verifique con coordinación'; sonar('bad'); break;
    default: cls = 'bad'; titulo = 'ERROR'; det = r.mensaje || 'No se pudo registrar'; sonar('bad');
  }
  card.className = 'resultado ' + cls;
  card.innerHTML =
    (e && e.foto_url ? `<img class="r-foto" src="${esc(e.foto_url)}" alt="" onerror="this.remove()">` : '') +
    `<div class="r-tipo">${esc(titulo)}</div>` +
    (e ? `<div class="r-nombre">${esc(e.nombres)} ${esc(e.apellidos)}</div><div class="r-curso">Grado ${esc(curso(e))}${e.jornada ? ' · ' + esc(e.jornada) : ''} · Cód. ${esc(e.codigo)}</div>` : '') +
    `<div class="r-det">${esc(det)}</div>` +
    (r.advertencia ? `<div class="r-adv">⚠ ${esc(r.advertencia)}</div>` : '') +
    (r.estado === 'NO_ENCONTRADO' && esAdmin() ? `<button class="btn pri sm" type="button" id="btnRegCod" style="margin-top:8px">Registrar estudiante con este código</button>` : '');
  const br = $('#btnRegCod');
  if (br) br.onclick = () => { abrirEst(null); frm.elements.codigo.value = r.codigo; frm.elements.nombres.focus(); };
  void card.offsetWidth; card.classList.add('flash');
}

function agregarReciente(r) {
  recientes.unshift(r); recientes.length = Math.min(recientes.length, 15);
  $('#recientes').innerHTML = recientes.map(x => {
    const e = x.estudiante;
    const p = x.estado === 'PENDIENTE' ? '<span class="pill">PENDIENTE</span>' : pillTipo(x.tipo).__html;
    return `<li><span class="h">${esc(hora(x.fecha_hora))}</span>${p}<span class="n">${e ? esc(nombreCompleto(e)) : 'Código ' + esc(x.codigo)}</span><span class="muted">${e ? esc(curso(e)) : ''}</span></li>`;
  }).join('');
}

let AC = null;
function sonar(t) {
  if (!$('#chkSonido').checked) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const seq = t === 'ok' ? [[1046, .12]] : t === 'warn' ? [[660, .1], [660, .1]] : [[240, .18], [190, .28]];
    let at = AC.currentTime;
    for (const [f, d] of seq) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(.12, at); g.gain.exponentialRampToValueAtTime(.001, at + d);
      o.connect(g).connect(AC.destination); o.start(at); o.stop(at + d); at += d + .06;
    }
  } catch {}
  if (t === 'bad' && navigator.vibrate) navigator.vibrate([120, 60, 120]);
}

async function iniciarCamara() {
  if (typeof Html5Qrcode === 'undefined') return toast('No se pudo cargar el lector de cámara. Revise la conexión.', 'bad');
  try {
    const F = Html5QrcodeSupportedFormats;
    camara = camara || new Html5Qrcode('reader', {
      verbose: false,
      formatsToSupport: [F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    await camara.start({ facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.max(150, Math.floor(w * 0.9)), height: Math.max(80, Math.floor(Math.min(w, h) * 0.5)) }) },
      txt => procesar(txt, true), () => {});
    camaraOn = true;
  } catch (err) {
    camaraOn = false;
    toast('No se pudo abrir la cámara. Permita el acceso y verifique que la página abra con https://', 'bad');
    console.error(err);
  }
  $('#btnCamara').textContent = camaraOn ? '⏹ Detener cámara' : '📷 Usar cámara';
}
async function detenerCamara() {
  if (camara && camaraOn) { try { await camara.stop(); camara.clear(); } catch {} }
  camaraOn = false;
  const b = $('#btnCamara'); if (b) b.textContent = '📷 Usar cámara';
}

let resumenTimer;
function programarResumen() { clearTimeout(resumenTimer); resumenTimer = setTimeout(actualizarResumen, 2500); }
async function actualizarResumen() {
  try {
    const r = await api.resumenHoy();
    $('#kEnt').textContent = r.entradas; $('#kSal').textContent = r.salidas; $('#kPre').textContent = r.presentes;
  } catch (err) { console.warn('Resumen:', err.message || err); }
}

/* ====================== COLA SIN CONEXIÓN ====================== */
const COLA = 'ce_cola';
const leerCola = () => store.get(COLA, []);
function esErrorRed(err) {
  return !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(String(err && (err.message || err)));
}
function encolar(item) { const c = leerCola(); c.push(item); store.set(COLA, c); pintarCola(); }
function pintarCola() {
  const n = leerCola().length; const b = $('#badgeCola');
  b.hidden = !n; b.textContent = `${n} sin enviar`;
}
let enviando = false;
async function enviarCola() {
  const c = leerCola();
  if (enviando || !c.length || !navigator.onLine) return;
  enviando = true;
  const quedan = [];
  for (let i = 0; i < c.length; i++) {
    try { await api.registrar(c[i].codigo, c[i].tipo, c[i].punto, c[i].fecha_hora); }
    catch (err) {
      const msg = String(err && (err.message || err));
      if (esErrorRed(err) || /jwt|auth|token/i.test(msg)) { quedan.push(...c.slice(i)); break; }
      console.warn('Lectura descartada', c[i], msg);
    }
  }
  store.set(COLA, quedan.concat(leerCola().slice(c.length)));
  enviando = false;
  pintarCola();
  if (!quedan.length) { toast('Lecturas pendientes enviadas'); actualizarResumen(); }
}

/* ============================== HOY ============================== */
let HOY_SUB = 'presentes', HOY = null, HOY_EXP = null;
$('#segHoy').onclick = e => { const b = e.target.closest('button'); if (!b) return; HOY_SUB = b.dataset.v; pintarHoy(); };
$('#hoyGrado').onchange = () => pintarHoy();
$('#btnHoyAct').onclick = () => cargarHoy(true);
$('#btnHoyCSV').onclick = () => HOY_EXP && descargarCSV(HOY_EXP.nombre, HOY_EXP.headers, HOY_EXP.filas);

async function cargarHoy(forzar = false) {
  $('#hoyInfo').textContent = 'Cargando…';
  try {
    const d = hoyStr();
    const [movs, pres, est] = await Promise.all([
      api.movimientos(inicioDe(d).toISOString(), inicioDe(sumarDias(d, 1)).toISOString()),
      api.presentes(), getEst(forzar)]);
    HOY = { movs, pres, est };
    pintarHoy();
  } catch (err) { $('#hoyInfo').textContent = 'Error al cargar: ' + (err.message || err); }
}

function pintarHoy() {
  $$('#segHoy button').forEach(b => b.classList.toggle('on', b.dataset.v === HOY_SUB));
  if (!HOY) return;
  const g = $('#hoyGrado').value, fg = x => !g || x.grado === g, d = hoyStr();
  let headers, filas, vista, info, nombre;
  if (HOY_SUB === 'presentes') {
    const l = HOY.pres.filter(fg).sort(ordenEst);
    headers = ['Código', 'Estudiante', 'Grado', 'Hora de entrada'];
    filas = l.map(p => [p.codigo, nombreCompleto(p), curso(p), hora(p.entrada)]); vista = filas;
    info = `${l.length} estudiante(s) dentro de la institución en este momento`; nombre = `dentro_${d}.csv`;
  } else if (HOY_SUB === 'movimientos') {
    const l = HOY.movs.filter(fg);
    headers = ['Hora', 'Tipo', 'Código', 'Estudiante', 'Grado', 'Punto', 'Registró'];
    filas = l.map(m => [hora(m.fecha_hora), m.tipo, m.codigo, nombreCompleto(m), curso(m), m.punto || '', m.registrado_por_nombre || '']);
    vista = filas.map((f, i) => { const v = [...f]; v[1] = pillTipo(l[i].tipo); return v; });
    info = `${l.length} movimiento(s) hoy`; nombre = `movimientos_${d}.csv`;
  } else {
    const con = new Set(HOY.movs.map(m => m.estudiante_id));
    const l = HOY.est.filter(e => e.activo && !con.has(e.id)).filter(fg);
    headers = ['Código', 'Estudiante', 'Grado', 'Jornada', 'Acudiente', 'Teléfono acudiente'];
    filas = l.map(e => [e.codigo, nombreCompleto(e), curso(e), e.jornada || '', e.acudiente || '', e.telefono_acudiente || '']); vista = filas;
    info = `${l.length} estudiante(s) activos sin ningún registro hoy`; nombre = `sin_registro_${d}.csv`;
  }
  $('#hoyInfo').textContent = info + (g ? ` · grado ${g}` : '');
  tabla('#tablaHoy', headers, vista);
  HOY_EXP = { nombre, headers, filas };
}

/* =========================== ESTUDIANTES =========================== */
$('#buscarEst').oninput = () => pintarEst();
$('#estGrado').onchange = () => pintarEst();

async function cargarEstudiantes() {
  $('#estInfo').textContent = 'Cargando…';
  try { await getEst(true); pintarEst(); }
  catch (err) { $('#estInfo').textContent = 'Error al cargar: ' + (err.message || err); }
}
function filtrarEst() {
  const q = sinTildes($('#buscarEst').value), g = $('#estGrado').value;
  return (EST || []).filter(e => (!g || e.grado === g) &&
    (!q || sinTildes(`${e.nombres} ${e.apellidos} ${e.apellidos} ${e.nombres} ${e.codigo} ${e.documento || ''}`).includes(q)));
}
function pintarEst() {
  const l = filtrarEst(), MAX = 400;
  const activos = l.filter(e => e.activo).length;
  $('#estInfo').textContent = `${l.length} estudiante(s) · ${activos} activos` + (l.length > MAX ? ` · mostrando los primeros ${MAX}, use el buscador` : '');
  const headers = ['Código', 'Documento', 'Estudiante', 'Grado', 'Jornada', 'Estado'].concat(esAdmin() ? [''] : []);
  tabla('#tablaEst', headers, l.slice(0, MAX).map(e => {
    const f = [e.codigo, e.documento || '', nombreCompleto(e), curso(e), e.jornada || '',
      H(e.activo ? '<span class="pill in">Activo</span>' : '<span class="pill bad">Inactivo</span>')];
    if (esAdmin()) f.push(H(`<button class="btn sm" type="button" data-edit="${esc(e.id)}">Editar</button>`));
    return f;
  }));
}
$('#tablaEst').addEventListener('click', e => {
  const b = e.target.closest('[data-edit]'); if (!b) return;
  abrirEst((EST || []).find(x => String(x.id) === b.dataset.edit));
});

const dlg = $('#dlgEst'), frm = $('#frmEst');
function abrirEst(e) {
  frm.reset();
  $('#dlgTitulo').textContent = e ? 'Editar estudiante' : 'Nuevo estudiante';
  const v = e || { activo: true, jornada: 'MAÑANA' };
  for (const el of frm.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!v[el.name];
    else el.value = v[el.name] ?? '';
  }
  dlg.showModal();
  if (!e) setTimeout(() => frm.elements.codigo.focus(), 50);
}
$('#btnNuevoEst').onclick = () => abrirEst(null);
frm.elements.codigo.addEventListener('keydown', ev => {      // el lector envía Enter al final
  if (ev.key === 'Enter') { ev.preventDefault(); frm.elements.documento.focus(); }
});
$('#btnCancelarEst').onclick = () => dlg.close();
frm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const fd = new FormData(frm), e = {};
  for (const k of ['id', 'codigo', 'documento', 'nombres', 'apellidos', 'grado', 'grupo', 'jornada', 'acudiente', 'telefono_acudiente', 'foto_url'])
    e[k] = String(fd.get(k) || '').trim() || null;
  e.activo = frm.elements.activo.checked;
  if (!e.id) delete e.id;
  if (!e.codigo || !e.nombres || !e.apellidos || !e.grado) return toast('Complete los campos obligatorios (*)', 'bad');
  const b = $('#btnGuardarEst'); b.disabled = true;
  try { await api.guardarEstudiante(e); dlg.close(); toast('Estudiante guardado'); await cargarEstudiantes(); }
  catch (err) { toast(err.message || 'No se pudo guardar', 'bad'); }
  finally { b.disabled = false; }
});

const CAMPOS_CSV = ['codigo', 'documento', 'nombres', 'apellidos', 'grado', 'grupo', 'jornada', 'acudiente', 'telefono_acudiente', 'activo'];
const ALIAS = { codigo_de_barras: 'codigo', cod: 'codigo', nro_documento: 'documento', numero_documento: 'documento', doc: 'documento',
  nombre: 'nombres', apellido: 'apellidos', curso: 'grado', telefono: 'telefono_acudiente', celular: 'telefono_acudiente', estado: 'activo' };

$('#btnPlantilla').onclick = () => descargarCSV('plantilla_estudiantes.csv', CAMPOS_CSV, [
  ['1080210001', '1080210001', 'Valentina', 'Rojas Perdomo', '6', '01', 'MAÑANA', 'Luz Perdomo', '3100000000', 'SI'],
  ['1080210002', '1080210002', 'Santiago', 'Muñoz Cerón', '10', '02', 'TARDE', 'Carlos Muñoz', '3200000000', 'SI']]);
$('#btnImportar').onclick = () => $('#fileCSV').click();
$('#fileCSV').onchange = async ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  let texto = await file.text();
  if (texto.includes('\uFFFD')) texto = new TextDecoder('windows-1252').decode(await file.arrayBuffer()); // CSV guardado desde Excel
  const rows = parseCSV(texto);
  if (rows.length < 2) return toast('El archivo no tiene datos', 'bad');
  const cab = rows[0].map(h => { const k = sinTildes(h).replace(/\s+/g, '_'); return ALIAS[k] || k; });
  const faltan = ['codigo', 'nombres', 'apellidos', 'grado'].filter(c => !cab.includes(c));
  if (faltan.length) return toast('Faltan columnas: ' + faltan.join(', '), 'bad');
  const usadas = cab.map((c, i) => [c, i]).filter(([c]) => CAMPOS_CSV.includes(c));
  const filas = [], errores = [], vistos = new Set();
  rows.slice(1).forEach((r, n) => {
    const o = {};
    for (const [c, i] of usadas) {
      const v = (r[i] ?? '').trim();
      o[c] = c === 'activo' ? !/^(no|0|false|inactivo|retirado)$/i.test(v) : (v || null);
    }
    if (!o.codigo || !o.nombres || !o.apellidos || !o.grado) { errores.push(n + 2); return; }
    if (vistos.has(o.codigo)) { errores.push(n + 2); return; }
    vistos.add(o.codigo); filas.push(o);
  });
  if (!filas.length) return toast('No hay filas válidas para importar', 'bad');
  const msg = `Se importarán ${filas.length} estudiante(s). Los que ya existen (mismo código) se actualizan.` +
    (errores.length ? `\n\n${errores.length} fila(s) se omitirán por datos incompletos o código repetido (líneas: ${errores.slice(0, 15).join(', ')}${errores.length > 15 ? '…' : ''}).` : '') + '\n\n¿Continuar?';
  if (!confirm(msg)) return;
  try { await api.importar(filas); toast(`${filas.length} estudiante(s) importados`); await cargarEstudiantes(); }
  catch (err) { toast('Error al importar: ' + (err.message || err), 'bad'); }
};

$('#btnCarnes').onclick = () => {
  if (typeof JsBarcode === 'undefined') return toast('No se cargó el generador de códigos de barras', 'bad');
  const l = filtrarEst().filter(e => e.activo);
  if (!l.length) return toast('No hay estudiantes activos para imprimir con ese filtro', 'bad');
  if (l.length > 150 && !confirm(`Se generarán ${l.length} carnés. Puede filtrar por grado para imprimir por partes. ¿Continuar?`)) return;
  const pa = $('#printArea');
  pa.innerHTML = l.map((e, i) => `<div class="carne"><div class="ch"><img src="${LOGO_IE}" alt=""><div><div class="ci">${esc(CONFIG.INSTITUCION)}</div><div class="cm">${esc(CONFIG.MUNICIPIO)} · ${esc(CONFIG.LEMA)}</div></div></div>
    <div><div class="cn">${esc(e.nombres)} ${esc(e.apellidos)}</div>
    <div class="cg">Grado ${esc(curso(e))}${e.jornada ? ' · Jornada ' + esc(e.jornada) : ''}${e.documento ? '<br>Doc. ' + esc(e.documento) : ''}</div></div>
    <svg id="bc${i}"></svg></div>`).join('');
  l.forEach((e, i) => {
    const s = document.getElementById('bc' + i);
    try {
      JsBarcode(s, e.codigo, { format: 'CODE128', width: 2, height: 60, displayValue: true, fontSize: 16, margin: 4 });
      const w = parseFloat(s.getAttribute('width')), h = parseFloat(s.getAttribute('height'));
      s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.removeAttribute('width'); s.removeAttribute('height');
    } catch { s.outerHTML = '<div>Código inválido</div>'; }
  });
  setTimeout(() => window.print(), 150);
};

/* ============================== REPORTES ============================== */
let REP_EXP = null;
$('#rDesde').value = hoyStr(); $('#rHasta').value = hoyStr();
$('#btnRepCSV').onclick = () => REP_EXP && descargarCSV(REP_EXP.nombre, REP_EXP.headers, REP_EXP.filas);
$('#btnConsultar').onclick = async () => {
  const d1 = $('#rDesde').value, d2 = $('#rHasta').value, g = $('#rGrado').value || null;
  if (!d1 || !d2 || d2 < d1) return toast('Revise el rango de fechas', 'bad');
  $('#repInfo').textContent = 'Consultando…'; $('#btnRepCSV').disabled = true;
  try {
    const movs = (await api.movimientos(inicioDe(d1).toISOString(), inicioDe(sumarDias(d2, 1)).toISOString(), g))
      .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora));
    let headers, filas, vista, info;
    if ($('#rTipo').value === 'detalle') {
      headers = ['Fecha', 'Hora', 'Tipo', 'Código', 'Documento', 'Estudiante', 'Grado', 'Punto', 'Registró'];
      filas = movs.map(m => [hoyStr(new Date(m.fecha_hora)), hora(m.fecha_hora), m.tipo, m.codigo, m.documento || '', nombreCompleto(m), curso(m), m.punto || '', m.registrado_por_nombre || '']);
      vista = filas.map((f, i) => { const v = [...f]; v[2] = pillTipo(movs[i].tipo); return v; });
      info = `${movs.length} movimiento(s)`;
    } else {
      const lim = $('#rLimite').value || '23:59', grupos = new Map();
      for (const m of movs) {
        const k = hoyStr(new Date(m.fecha_hora)) + '|' + m.estudiante_id;
        let r = grupos.get(k);
        if (!r) grupos.set(k, r = { fecha: k.split('|')[0], e: m, llegada: null, salida: null, n: 0 });
        r.n++;
        if (m.tipo === 'ENTRADA' && !r.llegada) r.llegada = m.fecha_hora;
        if (m.tipo === 'SALIDA') r.salida = m.fecha_hora;
      }
      const l = [...grupos.values()].sort((a, b) => cmp(a.fecha, b.fecha) || ordenEst(a.e, b.e));
      let tardes = 0;
      headers = ['Fecha', 'Código', 'Estudiante', 'Grado', 'Llegada', 'Salida', 'Llegó tarde', 'Movimientos'];
      filas = l.map(r => {
        const tarde = r.llegada && horaCorta(r.llegada) > lim; if (tarde) tardes++;
        return [r.fecha, r.e.codigo, nombreCompleto(r.e), curso(r.e), r.llegada ? hora(r.llegada) : '—', r.salida ? hora(r.salida) : '—', tarde ? 'Sí' : 'No', r.n];
      });
      vista = filas.map(f => { const v = [...f]; v[6] = H(f[6] === 'Sí' ? '<span class="pill warn">Sí</span>' : 'No'); return v; });
      info = `${l.length} registro(s) estudiante-día · ${tardes} llegada(s) después de las ${lim}`;
    }
    $('#repInfo').textContent = info + (g ? ` · grado ${g}` : '');
    tabla('#tablaRep', headers, vista, 3000);
    REP_EXP = { nombre: `reporte_${$('#rTipo').value}_${d1}_a_${d2}${g ? '_grado' + g : ''}.csv`, headers, filas };
    $('#btnRepCSV').disabled = !filas.length;
  } catch (err) { $('#repInfo').textContent = 'Error: ' + (err.message || err); }
};

/* ============================== TABLERO ============================== */
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pctTxt = v => v == null || !isFinite(v) ? '—' : (v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
const numTxt = v => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('es-CO');
const HEAT = [ // [desde, fondo, texto]  escala de un solo tono: más oscuro = mejor asistencia
  [0, '#cde2fb', '#17202b'], [0.70, '#9ec5f4', '#17202b'], [0.80, '#6da7ec', '#17202b'],
  [0.85, '#3987e5', '#0b1726'], [0.90, '#256abf', '#fff'], [0.95, '#184f95', '#fff']];
const heatColor = v => { let c = HEAT[0]; for (const h of HEAT) if (v >= h[0]) c = h; return c; };
let TB = null, TB_ANIO = { clave: null, datos: null };

$('#tbMes').value = hoyStr().slice(0, 7);
$('#btnTbAct').onclick = () => cargarTablero(true);
$('#tbMes').onchange = () => cargarTablero();
$('#tbLimite').onchange = () => cargarTablero(true);
$('#tbGrado').onchange = () => pintarTablero();

// Tooltip compartido para todas las gráficas
(() => {
  const tip = $('#vizTip');
  const mover = e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('show'); return; }
    tip.innerHTML = t.dataset.tip;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.add('show');
  };
  $('#t-tablero').addEventListener('mousemove', mover);
  $('#t-tablero').addEventListener('click', mover);          // en celular/tablet: tocar muestra el detalle
  $('#t-tablero').addEventListener('mouseleave', () => tip.classList.remove('show'));
  addEventListener('scroll', () => tip.classList.remove('show'), { passive: true });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!$('#t-tablero').hidden) pintarTablero(); }, 200); });
})();

function diasDeClase(dias) {                 // días con asistencia "normal" (≥ 20 % del máximo)
  const tot = new Map();
  for (const d of dias) tot.set(d.fecha, (tot.get(d.fecha) || 0) + Number(d.presentes));
  const max = Math.max(0, ...tot.values());
  return new Set([...tot].filter(([, n]) => n >= Math.max(1, max * 0.2)).map(([f]) => f));
}

async function cargarTablero(forzar = false) {
  const mes = $('#tbMes').value || hoyStr().slice(0, 7);
  const [y, m] = mes.split('-').map(Number), lim = $('#tbLimite').value || '07:00';
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  $('#tbInfo').textContent = 'Cargando indicadores…';
  try {
    const claveAnio = `${y}|${lim}`;
    const pAnio = (!forzar && TB_ANIO.clave === claveAnio) ? Promise.resolve(TB_ANIO.datos)
      : api.tableroDatos(`${y}-01-01`, `${y}-12-31`, lim, false);
    const [dm, da] = await Promise.all([api.tableroDatos(`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`, lim, true), pAnio, getEst()]);
    TB_ANIO = { clave: claveAnio, datos: da };
    TB = { y, m, lim, dm, da };
    pintarTablero();
  } catch (err) { $('#tbInfo').textContent = 'Error al cargar el tablero: ' + (err.message || err); }
}

// % de asistencia de un mes a partir de los datos anuales
function pctMes(datos, mes, grado, activos, DC) {
  const mm = '-' + String(mes).padStart(2, '0') + '-';
  const dias = [...DC].filter(f => f.includes(mm));
  if (!dias.length) return null;
  const set = new Set(dias); let pres = 0;
  for (const d of datos.dias) if (set.has(d.fecha) && (!grado || d.grado === grado)) pres += Number(d.presentes);
  const act = grado ? (activos.get(grado) || 0) : [...activos.values()].reduce((a, b) => a + b, 0);
  return act ? Math.min(1, pres / (act * dias.length)) : null;
}

function pintarTablero() {
  if (!TB) return;
  const { y, m, lim, dm, da } = TB, g = $('#tbGrado').value, fg = x => !g || x.grado === g;
  const activos = new Map(dm.activos.map(a => [a.grado, Number(a.n)]));
  const grados = [...activos.keys()].sort(cmp);
  const nAct = g ? (activos.get(g) || 0) : [...activos.values()].reduce((a, b) => a + b, 0);
  const DC = diasDeClase(dm.dias), nD = DC.size;
  const diasF = dm.dias.filter(d => DC.has(d.fecha) && fg(d));
  const suma = k => diasF.reduce((a, d) => a + Number(d[k]), 0);
  const pres = suma('presentes'), tardes = suma('tardes'), sinSal = suma('sin_salida');
  const pct = nAct && nD ? Math.min(1, pres / (nAct * nD)) : null;
  const est = dm.estudiantes.filter(fg).map(e => {
    const p = Math.min(Number(e.presentes), nD);
    return { ...e, presentes: p, tardes: Number(e.tardes), ausencias: Math.max(0, nD - p), pct: nD ? p / nD : null };
  });
  const enRiesgo = est.filter(e => e.pct != null && e.pct < 0.8).length;
  const nombreMes = `${MESES_L[m - 1]} de ${y}`;

  // variación frente al mes anterior
  const DCa = diasDeClase(da.dias);
  const ant = m > 1 ? pctMes(da, m - 1, g, activos, DCa) : null;
  let varTxt = 'Sin datos del mes anterior';
  if (pct != null && ant != null) {
    const dif = (pct - ant) * 100;
    varTxt = `${dif >= 0 ? '▲ +' : '▼ '}${Math.abs(dif).toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} pts frente a ${MESES_L[m - 2]}`;
  }

  $('#tbInfo').textContent = nD
    ? `${nombreMes[0].toUpperCase() + nombreMes.slice(1)} · ${nD} día(s) de clase · ${numTxt(nAct)} estudiantes activos${g ? ' en grado ' + g : ''}`
    : `No hay registros en ${nombreMes}.`;

  const tile = (lbl, val, det) => `<div class="tile"><div class="lbl">${esc(lbl)}</div><div class="val">${esc(val)}</div><div class="det">${esc(det)}</div></div>`;
  $('#tbTiles').innerHTML =
    tile('Asistencia del mes', pctTxt(pct), varTxt) +
    tile('Promedio diario de asistentes', nD ? numTxt(pres / nD) : '—', `de ${numTxt(nAct)} estudiantes activos`) +
    tile('Llegadas tarde', pctTxt(pres ? tardes / pres : null), `${numTxt(tardes)} llegadas después de las ${lim}`) +
    tile('Estudiantes en riesgo', nD ? numTxt(enRiesgo) : '—', 'Asistencia menor al 80 % en el mes') +
    tile('Salidas sin registrar', pctTxt(pres ? sinSal / pres : null), 'Días con entrada pero sin lectura de salida') +
    tile('Días de clase', numTxt(nD), `con registros en ${MESES_L[m - 1]}`);

  // 1. Barras por grado
  $('#tbSubGrado').textContent = `Porcentaje de asistencia en ${nombreMes}`;
  const porGrado = grados.map(gr => {
    const p = dm.dias.filter(d => DC.has(d.fecha) && d.grado === gr).reduce((a, d) => a + Number(d.presentes), 0);
    const a = activos.get(gr) || 0;
    return { gr, a, p, v: a && nD ? Math.min(1, p / (a * nD)) : null };
  });
  const hb = $('#tbGrados'); hb.classList.toggle('con-sel', !!g);
  hb.innerHTML = porGrado.length ? porGrado.map(x => `<div class="hbar${x.gr === g ? ' sel' : ''}" data-tip="<b>Grado ${esc(x.gr)}</b><br>Asistencia: ${pctTxt(x.v)}<br>${numTxt(x.a)} estudiantes activos<br>${numTxt(x.p)} asistencias en ${nD} días">
      <span class="gl">Grado ${esc(x.gr)}</span><span class="tr"><span class="fill" style="display:block;width:${(x.v || 0) * 100}%"></span></span><span class="v">${pctTxt(x.v)}</span></div>`).join('')
    : '<div class="muted">Sin estudiantes activos</div>';

  // 2. Columnas por día
  const diasOrd = [...DC].sort();
  $('#tbSubDiaria').textContent = `Porcentaje de estudiantes${g ? ' de grado ' + g : ''} que asistieron cada día de clase`;
  const porDia = diasOrd.map(f => {
    const p = dm.dias.filter(d => d.fecha === f && fg(d)).reduce((a, d) => a + Number(d.presentes), 0);
    return { f, p, v: nAct ? Math.min(1, p / nAct) : 0 };
  });
  $('#tbDiaria').innerHTML = columnas(porDia.map(x => ({
    h: x.v, lbl: String(+x.f.slice(8)),
    tip: `<b>${new Date(inicioDe(x.f).getTime() + 12 * 3600e3).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CONFIG.ZONA_HORARIA })}</b><br>Asistencia: ${pctTxt(x.v)}<br>${numTxt(x.p)} de ${numTxt(nAct)} estudiantes`,
  })), { porcentaje: true, meta: 0.8 });

  // 3. Mapa de calor grado × mes
  $('#tbSubHeat').textContent = `Año ${y} · cada celda es el % de asistencia del grado en ese mes`;
  const filasHeat = grados.map(gr => ({ gr, vals: MESES.map((_, i) => pctMes(da, i + 1, gr, activos, DCa)) }));
  const total = MESES.map((_, i) => pctMes(da, i + 1, null, activos, DCa));
  const mesesCon = MESES.map((_, i) => i).filter(i => total[i] != null);
  const celda = (v, gr, i) => {
    if (v == null) return '<td class="hc muted">—</td>';
    const [, bg, fgc] = heatColor(v);
    return `<td class="hc" style="background:${bg};color:${fgc}" data-tip="<b>${gr ? 'Grado ' + esc(gr) : 'Toda la institución'}</b> · ${MESES_L[i]}<br>Asistencia: ${pctTxt(v)}">${pctTxt(v).replace(' %', '%')}</td>`;
  };
  $('#tbHeat').innerHTML = mesesCon.length
    ? `<thead><tr><th>Grado</th>${mesesCon.map(i => `<th>${MESES[i]}</th>`).join('')}</tr></thead><tbody>` +
      filasHeat.map(r => `<tr class="${r.gr === g ? 'sel' : ''}"><td>Grado ${esc(r.gr)}</td>${mesesCon.map(i => celda(r.vals[i], r.gr, i)).join('')}</tr>`).join('') +
      `<tr class="tot"><td>Institución</td>${mesesCon.map(i => celda(total[i], null, i)).join('')}</tr></tbody>`
    : `<tbody><tr><td class="muted" style="padding:18px">Sin registros en ${y}</td></tr></tbody>`;
  const hw = $('#tbHeat').parentElement; hw.scrollLeft = hw.scrollWidth;   // en celular, mostrar los meses más recientes
  $('#tbHeatLey').innerHTML = HEAT.map((h, i) => `<span><i style="background:${h[1]}"></i>${i === 0 ? 'Menos de 70 %' : (h[0] * 100) + (HEAT[i + 1] ? '–' + HEAT[i + 1][0] * 100 + ' %' : ' % o más')}</span>`).join('');

  // 4. Histograma de llegadas
  const fr = new Map();
  for (const x of dm.franjas) if (fg(x) && DC.size) fr.set(x.franja, (fr.get(x.franja) || 0) + Number(x.n));
  const franjas = [...fr.keys()].sort();
  const maxFr = Math.max(1, ...fr.values()), totLleg = [...fr.values()].reduce((a, b) => a + b, 0);
  $('#tbSubLleg').textContent = `Cantidad de llegadas por franja de 15 minutos en ${nombreMes}`;
  $('#tbLlegadas').innerHTML = franjas.length ? columnas(franjas.map(f => {
    const [hh, mm] = f.split(':').map(Number), fin = new Date(Date.UTC(2000, 0, 1, hh, mm + 14));
    const finTxt = String(fin.getUTCHours()).padStart(2, '0') + ':' + String(fin.getUTCMinutes()).padStart(2, '0');
    const tarde = finTxt > lim;           // la franja incluye llegadas después de la hora límite
    return { h: fr.get(f) / maxFr, lbl: f, cls: tarde ? 'tarde' : '',
      tip: `<b>${f} – ${finTxt}</b><br>${numTxt(fr.get(f))} llegadas (${pctTxt(fr.get(f) / totLleg)})${tarde ? '<br>Incluye llegadas tarde' : ''}` };
  }), { max: maxFr }) : '<div class="muted">Sin llegadas registradas</div>';

  // 5. Tablas de estudiantes
  $('#tbSubTardes').textContent = `Entradas después de las ${lim}`;
  const filaEst = (e, extra) => [e.codigo, nombreCompleto(e), curso(e), extra];
  const aus = est.filter(e => e.ausencias > 0).sort((a, b) => b.ausencias - a.ausencias || ordenEst(a, b)).slice(0, 10);
  tabla('#tbAusentes', ['Código', 'Estudiante', 'Grado', 'Inasistencias'], aus.map(e => filaEst(e, H(`<b>${e.ausencias}</b> <span class="muted">de ${nD} (${pctTxt(e.pct)} asist.)</span>`))));
  const tar = est.filter(e => e.tardes > 0).sort((a, b) => b.tardes - a.tardes || ordenEst(a, b)).slice(0, 10);
  tabla('#tbTardes', ['Código', 'Estudiante', 'Grado', 'Llegadas tarde'], tar.map(e => filaEst(e, H(`<b>${e.tardes}</b>`))));

  TB.exp = {
    nombre: `indicadores_${y}-${String(m).padStart(2, '0')}${g ? '_grado' + g : ''}.csv`,
    headers: ['Código', 'Apellidos', 'Nombres', 'Grado', 'Grupo', 'Días de clase', 'Días asistidos', 'Inasistencias', '% asistencia', 'Llegadas tarde', 'En riesgo (<80%)', 'Acudiente', 'Teléfono acudiente'],
    filas: est.sort(ordenEst).map(e => [e.codigo, e.apellidos, e.nombres, e.grado, e.grupo || '', nD, e.presentes, e.ausencias,
      e.pct == null ? '' : (e.pct * 100).toFixed(1).replace('.', ','), e.tardes, e.pct != null && e.pct < 0.8 ? 'Sí' : 'No', e.acudiente || '', e.telefono_acudiente || '']),
  };
}
$('#btnTbCSV').onclick = () => TB && TB.exp && descargarCSV(TB.exp.nombre, TB.exp.headers, TB.exp.filas);

// Gráfica de columnas en HTML (barras desde cero, eje recesivo, tooltip por columna)
function columnas(items, { porcentaje = false, meta = null, max = 1 } = {}) {
  const lineas = porcentaje ? [1, 0.75, 0.5, 0.25] : [1, 0.5];
  const yl = v => porcentaje ? (v * 100) + ' %' : numTxt(v * max);
  const maxEtiquetas = innerWidth < 520 ? 6 : innerWidth < 900 ? 10 : 16;   // no amontonar etiquetas en pantallas pequeñas
  const cada = Math.ceil(items.length / maxEtiquetas);
  return `<div class="chart"><div class="area">
      ${lineas.map(v => `<div class="gline" style="top:${(1 - v) * 100}%"></div><span class="ylab" style="top:${(1 - v) * 100}%">${yl(v)}</span>`).join('')}
      <span class="ylab" style="top:100%">0</span>
      ${meta != null ? `<div class="gline meta" style="top:${(1 - meta) * 100}%"></div>` : ''}
      <div class="cols">${items.map(it => `<div class="cw" data-tip="${esc(it.tip)}"><div class="c ${it.cls || ''}" style="height:${Math.max(0, Math.min(1, it.h)) * 100}%"></div></div>`).join('')}</div>
    </div>
    <div class="xl">${items.map((it, i) => `<span>${i % cada === 0 ? esc(it.lbl) : ''}</span>`).join('')}</div></div>`;
}

/* ============================== DEMO ============================== */
$('#lnkHistorial').onclick = e => {
  e.preventDefault();
  if (!api.generarHistorial) return;
  api.generarHistorial(); EST = null; TB_ANIO = { clave: null, datos: null };
  toast('Historial de ejemplo cargado'); irTab('tablero');
};
$('#lnkReiniciar').onclick = e => {
  e.preventDefault();
  if (!confirm('¿Borrar los datos de prueba y volver a empezar?')) return;
  api.reiniciar && api.reiniciar(); store.set(COLA, []); location.reload();
};

iniciar();
