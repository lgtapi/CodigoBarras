-- =====================================================================
--  CONTROL DE INGRESO Y SALIDA DE ESTUDIANTES  ·  Base de datos Supabase
--  Ejecutar COMPLETO en: Supabase > SQL Editor > New query > Run
--  Se puede volver a ejecutar sin perder datos (es idempotente).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PERFILES DE USUARIO (porteros, coordinadores)
--    Roles: admin       → todo, incluida la pestaña Usuarios
--           porteria    → registra entradas/salidas y consulta
--           pendiente   → cuenta nueva esperando aprobación (sin acceso)
--           inactivo    → cuenta desactivada por el administrador (sin acceso)
--    LA PRIMERA CUENTA QUE SE CREE QUEDA COMO ADMINISTRADOR.
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  nombre     text,
  rol        text not null default 'pendiente'
             check (rol in ('admin','porteria','pendiente','inactivo')),
  creado_en  timestamptz not null default now()
);
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('admin','porteria','pendiente','inactivo'));

-- Crea el perfil automáticamente cuando se crea un usuario en Authentication
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- evita que dos cuentas creadas al mismo tiempo queden ambas como admin
  perform pg_advisory_xact_lock(hashtext('perfiles_primer_admin'));
  insert into public.perfiles (id, email, nombre, rol)
  values (new.id, lower(new.email),
          coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), new.email),
          case when exists (select 1 from public.perfiles where rol = 'admin')
               then 'pendiente' else 'admin' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- Perfiles para usuarios que ya existían antes de ejecutar este script
insert into public.perfiles (id, email, nombre)
select u.id, lower(u.email), u.email from auth.users u
on conflict (id) do nothing;

-- Si todavía no hay administrador, la cuenta más antigua pasa a serlo
update public.perfiles set rol = 'admin'
 where id = (select id from public.perfiles order by creado_en, email limit 1)
   and not exists (select 1 from public.perfiles where rol = 'admin');

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid()
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = 'admin', false)
$$;

create or replace function public.tiene_acceso() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('admin','porteria'), false)
$$;

-- Protege los perfiles: solo el admin cambia roles y nunca queda la
-- institución sin administrador. (Desde el SQL Editor no hay restricción.)
create or replace function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id; new.email := old.email; new.creado_en := old.creado_en;
  if new.rol is distinct from old.rol then
    if auth.uid() is not null and not public.es_admin() then
      raise exception 'Solo el administrador puede cambiar roles';
    end if;
    if old.rol = 'admin' and new.rol <> 'admin'
       and (select count(*) from public.perfiles where rol = 'admin') <= 1 then
      raise exception 'Debe quedar al menos un administrador';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_perfil on public.perfiles;
create trigger trg_proteger_perfil before update on public.perfiles
  for each row execute function public.proteger_perfil();

-- ---------------------------------------------------------------------
-- 2. ESTUDIANTES
--    "codigo" es lo que va impreso en el código de barras del carné.
--    Recomendado: usar el número de documento (TI / RC) como código.
-- ---------------------------------------------------------------------
create table if not exists public.estudiantes (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,
  documento           text,
  nombres             text not null,
  apellidos           text not null,
  grado               text not null,
  grupo               text,
  jornada             text default 'MAÑANA',
  acudiente           text,
  telefono_acudiente  text,
  foto_url            text,
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);
create index if not exists idx_est_documento on public.estudiantes (documento);
create index if not exists idx_est_grado     on public.estudiantes (grado, grupo);

create or replace function public.tocar_actualizado() returns trigger
language plpgsql as $$ begin new.actualizado_en := now(); return new; end $$;

drop trigger if exists trg_est_actualizado on public.estudiantes;
create trigger trg_est_actualizado before update on public.estudiantes
  for each row execute function public.tocar_actualizado();

-- ---------------------------------------------------------------------
-- 3. MOVIMIENTOS (cada entrada o salida)
-- ---------------------------------------------------------------------
create table if not exists public.movimientos (
  id              bigint generated always as identity primary key,
  estudiante_id   uuid not null references public.estudiantes(id),
  tipo            text not null check (tipo in ('ENTRADA','SALIDA')),
  fecha_hora      timestamptz not null default now(),
  punto           text default 'Principal',
  observacion     text,
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_mov_est_fecha on public.movimientos (estudiante_id, fecha_hora desc);
create index if not exists idx_mov_fecha     on public.movimientos (fecha_hora desc);

-- ---------------------------------------------------------------------
-- 4. SEGURIDAD (Row Level Security)
--    Los datos son de menores de edad (Ley 1581 de 2012): nadie sin
--    usuario y rol asignado puede leer ni escribir.
-- ---------------------------------------------------------------------
alter table public.perfiles    enable row level security;
alter table public.estudiantes enable row level security;
alter table public.movimientos enable row level security;

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = auth.uid() or public.tiene_acceso());
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update to authenticated
  using (id = auth.uid() or public.es_admin())
  with check (id = auth.uid() or public.es_admin());

drop policy if exists est_select on public.estudiantes;
create policy est_select on public.estudiantes for select to authenticated
  using (public.tiene_acceso());
drop policy if exists est_insert on public.estudiantes;
create policy est_insert on public.estudiantes for insert to authenticated
  with check (public.es_admin());
drop policy if exists est_update on public.estudiantes;
create policy est_update on public.estudiantes for update to authenticated
  using (public.es_admin()) with check (public.es_admin());
drop policy if exists est_delete on public.estudiantes;
create policy est_delete on public.estudiantes for delete to authenticated
  using (public.es_admin());

drop policy if exists mov_select on public.movimientos;
create policy mov_select on public.movimientos for select to authenticated
  using (public.tiene_acceso());
drop policy if exists mov_insert on public.movimientos;
create policy mov_insert on public.movimientos for insert to authenticated
  with check (public.tiene_acceso() and registrado_por = auth.uid());
drop policy if exists mov_update on public.movimientos;
create policy mov_update on public.movimientos for update to authenticated
  using (public.es_admin()) with check (public.es_admin());
drop policy if exists mov_delete on public.movimientos;
create policy mov_delete on public.movimientos for delete to authenticated
  using (public.es_admin());

revoke all on public.perfiles, public.estudiantes, public.movimientos from anon;
grant select                         on public.perfiles    to authenticated;
revoke update                        on public.perfiles    from authenticated;
grant update (nombre, rol)           on public.perfiles    to authenticated;  -- cada uno edita su nombre; el rol lo protege el trigger
grant select, insert, update, delete on public.estudiantes to authenticated;
grant select, insert, update, delete on public.movimientos to authenticated;

-- ---------------------------------------------------------------------
-- 5. FUNCIÓN PRINCIPAL: registrar una lectura de código de barras
--    - Busca por código (o por documento).
--    - Modo automático: si lo último de hoy fue ENTRADA registra SALIDA,
--      si no, ENTRADA.
--    - Anti-duplicado: ignora lecturas del mismo estudiante en < 60 s.
--    - p_fecha_hora permite enviar lecturas guardadas sin conexión.
-- ---------------------------------------------------------------------
create or replace function public.registrar_movimiento(
  p_codigo      text,
  p_tipo        text        default null,   -- null/'AUTO', 'ENTRADA', 'SALIDA'
  p_punto       text        default 'Principal',
  p_fecha_hora  timestamptz default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_codigo  text := trim(coalesce(p_codigo, ''));
  v_fecha   timestamptz := coalesce(p_fecha_hora, now());
  v_inicio  timestamptz;
  v_est     public.estudiantes%rowtype;
  v_ult     public.movimientos%rowtype;
  v_mov     public.movimientos%rowtype;
  v_tipo    text;
  v_info    jsonb;
  v_adv     text;
begin
  if not public.tiene_acceso() then
    raise exception 'Usuario sin permiso para registrar movimientos';
  end if;
  if v_codigo = '' then
    return jsonb_build_object('ok', false, 'estado', 'NO_ENCONTRADO', 'codigo', v_codigo);
  end if;
  if v_fecha > now() then v_fecha := now(); end if;
  if v_fecha < now() - interval '7 days' then
    raise exception 'La fecha del registro es demasiado antigua';
  end if;

  -- inicio del día en hora de Colombia
  v_inicio := ((v_fecha at time zone 'America/Bogota')::date)::timestamp at time zone 'America/Bogota';

  select * into v_est from public.estudiantes
   where codigo = v_codigo or documento = v_codigo
   order by (codigo = v_codigo) desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'estado', 'NO_ENCONTRADO', 'codigo', v_codigo);
  end if;

  v_info := jsonb_build_object(
    'id', v_est.id, 'codigo', v_est.codigo, 'documento', v_est.documento,
    'nombres', v_est.nombres, 'apellidos', v_est.apellidos,
    'grado', v_est.grado, 'grupo', v_est.grupo, 'jornada', v_est.jornada,
    'foto_url', v_est.foto_url);

  if not v_est.activo then
    return jsonb_build_object('ok', false, 'estado', 'INACTIVO', 'codigo', v_codigo, 'estudiante', v_info);
  end if;

  -- evita registros simultáneos del mismo estudiante desde dos porterías
  perform pg_advisory_xact_lock(hashtext(v_est.id::text));

  select * into v_ult from public.movimientos
   where estudiante_id = v_est.id
     and fecha_hora >= v_inicio and fecha_hora <= v_fecha
   order by fecha_hora desc
   limit 1;

  if v_ult.id is not null and v_fecha - v_ult.fecha_hora < interval '60 seconds' then
    return jsonb_build_object('ok', false, 'estado', 'DUPLICADO', 'codigo', v_codigo,
      'estudiante', v_info, 'tipo', v_ult.tipo, 'fecha_hora', v_ult.fecha_hora);
  end if;

  if p_tipo is null or trim(p_tipo) = '' or upper(p_tipo) = 'AUTO' then
    v_tipo := case when v_ult.tipo = 'ENTRADA' then 'SALIDA' else 'ENTRADA' end;
  else
    v_tipo := upper(trim(p_tipo));
  end if;
  if v_tipo not in ('ENTRADA','SALIDA') then
    raise exception 'Tipo de movimiento inválido: %', p_tipo;
  end if;

  v_adv := case
    when v_tipo = 'SALIDA'  and coalesce(v_ult.tipo, '') <> 'ENTRADA' then 'Salida sin entrada registrada hoy'
    when v_tipo = 'ENTRADA' and v_ult.tipo = 'ENTRADA'                then 'Ya tenía una entrada registrada hoy'
  end;

  insert into public.movimientos (estudiante_id, tipo, fecha_hora, punto, registrado_por)
  values (v_est.id, v_tipo, v_fecha, coalesce(nullif(trim(p_punto), ''), 'Principal'), auth.uid())
  returning * into v_mov;

  return jsonb_build_object('ok', true, 'estado', 'REGISTRADO', 'codigo', v_codigo,
    'estudiante', v_info, 'tipo', v_tipo, 'fecha_hora', v_mov.fecha_hora,
    'id', v_mov.id, 'advertencia', v_adv);
end $$;

revoke all on function public.registrar_movimiento(text, text, text, timestamptz) from public, anon;
grant execute on function public.registrar_movimiento(text, text, text, timestamptz) to authenticated;
grant execute on function public.mi_rol(), public.es_admin(), public.tiene_acceso() to authenticated;

-- ---------------------------------------------------------------------
-- 6. VISTAS PARA LA APP Y REPORTES (respetan los permisos del usuario)
-- ---------------------------------------------------------------------
create or replace view public.v_movimientos with (security_invoker = true) as
select m.id, m.fecha_hora, m.tipo, m.punto, m.observacion,
       e.id as estudiante_id, e.codigo, e.documento, e.nombres, e.apellidos,
       e.grado, e.grupo, e.jornada,
       p.nombre as registrado_por_nombre
  from public.movimientos m
  join public.estudiantes e on e.id = m.estudiante_id
  left join public.perfiles p on p.id = m.registrado_por;

create or replace view public.v_presentes with (security_invoker = true) as
with ultimo as (
  select distinct on (m.estudiante_id) m.estudiante_id, m.tipo, m.fecha_hora
    from public.movimientos m
   where m.fecha_hora >= ((now() at time zone 'America/Bogota')::date)::timestamp at time zone 'America/Bogota'
   order by m.estudiante_id, m.fecha_hora desc
)
select e.id, e.codigo, e.nombres, e.apellidos, e.grado, e.grupo, u.fecha_hora as entrada
  from ultimo u
  join public.estudiantes e on e.id = u.estudiante_id
 where u.tipo = 'ENTRADA';

revoke all on public.v_movimientos, public.v_presentes from anon;
grant select on public.v_movimientos, public.v_presentes to authenticated;

-- ---------------------------------------------------------------------
-- 7. DATOS PARA EL TABLERO (asistencia por grado, por día y por mes)
--    Devuelve agregados ya calculados para no traer miles de filas.
--    Un estudiante cuenta como "asistió" si tiene cualquier lectura ese día.
-- ---------------------------------------------------------------------
create or replace function public.tablero_datos(
  p_desde            date,
  p_hasta            date,
  p_limite           time    default '07:00',
  p_con_estudiantes  boolean default true
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v jsonb;
begin
  if not public.tiene_acceso() then
    raise exception 'Usuario sin permiso para ver el tablero';
  end if;

  with dia as (                              -- un registro por estudiante y día
    select e.id as estudiante_id, e.grado,
           (m.fecha_hora at time zone 'America/Bogota')::date as fecha,
           date_trunc('minute', min(m.fecha_hora) filter (where m.tipo = 'ENTRADA') at time zone 'America/Bogota') as llegada,
           bool_or(m.tipo = 'SALIDA') as con_salida
      from public.movimientos m
      join public.estudiantes e on e.id = m.estudiante_id
     where m.fecha_hora >= (p_desde::timestamp at time zone 'America/Bogota')
       and m.fecha_hora <  ((p_hasta + 1)::timestamp at time zone 'America/Bogota')
     group by 1, 2, 3
  )
  select jsonb_build_object(
    'dias', coalesce((select jsonb_agg(x order by x.fecha, x.grado) from (
        select fecha, grado,
               count(*) as presentes,
               count(*) filter (where llegada::time > p_limite) as tardes,
               count(*) filter (where not con_salida)          as sin_salida
          from dia group by fecha, grado) x), '[]'::jsonb),
    'franjas', coalesce((select jsonb_agg(x order by x.franja, x.grado) from (
        select grado,
               to_char(date_trunc('hour', llegada) + floor(extract(minute from llegada) / 15) * interval '15 minutes', 'HH24:MI') as franja,
               count(*) as n
          from dia where llegada is not null group by 1, 2) x), '[]'::jsonb),
    'activos', coalesce((select jsonb_agg(x) from (
        select grado, count(*) as n from public.estudiantes where activo group by grado) x), '[]'::jsonb),
    'estudiantes', case when p_con_estudiantes then coalesce((select jsonb_agg(x) from (
        select e.id, e.codigo, e.nombres, e.apellidos, e.grado, e.grupo, e.acudiente, e.telefono_acudiente,
               count(d.fecha) as presentes,
               count(d.fecha) filter (where d.llegada::time > p_limite) as tardes
          from public.estudiantes e
          left join dia d on d.estudiante_id = e.id
         where e.activo
         group by e.id) x), '[]'::jsonb) else '[]'::jsonb end
  ) into v;
  return v;
end $$;

revoke all on function public.tablero_datos(date, date, time, boolean) from public, anon;
grant execute on function public.tablero_datos(date, date, time, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 8. LISTA DE USUARIOS PARA EL ADMINISTRADOR (pestaña Usuarios)
-- ---------------------------------------------------------------------
create or replace function public.usuarios_lista()
returns table (id uuid, email text, nombre text, rol text, creado_en timestamptz,
               ultimo_ingreso timestamptz, correo_confirmado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver los usuarios';
  end if;
  return query
    select p.id, p.email, p.nombre, p.rol, p.creado_en,
           u.last_sign_in_at, u.email_confirmed_at is not null
      from public.perfiles p
      join auth.users u on u.id = p.id
     order by p.creado_en;
end $$;

revoke all on function public.usuarios_lista() from public, anon;
grant execute on function public.usuarios_lista() to authenticated;

-- =====================================================================
-- DESPUÉS DE EJECUTAR:
--   1. Cree SU cuenta primero (en la app: "Solicitar una cuenta", o en
--      Authentication > Users > Add user). La primera cuenta queda como
--      ADMINISTRADOR automáticamente.
--   2. Desde la app, pestaña Usuarios, el administrador crea las cuentas
--      de portería y aprueba o desactiva a los demás.
--
-- Si alguna vez la institución se queda sin acceso de administrador,
-- ejecute aquí (cambiando el correo):
--   update public.perfiles set rol = 'admin' where email = 'correo@ejemplo.com';
-- =====================================================================
