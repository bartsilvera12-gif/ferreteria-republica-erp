-- Cambios de estructura aplicados por el Agente IA (ticket #705, ferreteria-republica-erp). Ya están en la base.

-- Bitácora de cambios de Controla stock por producto
create table if not exists ferreteriarepublica.producto_controla_stock_historial (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, producto_id uuid not null, producto_nombre text not null, fecha timestamptz not null default now(), valor_anterior boolean, valor_nuevo boolean not null, usuario_id uuid, usuario_nombre text, created_at timestamptz not null default now());
grant SELECT on "ferreteriarepublica".producto_controla_stock_historial to service_role;
alter table "ferreteriarepublica".producto_controla_stock_historial enable row level security;
create policy producto_controla_stock_historial_select_1 on "ferreteriarepublica".producto_controla_stock_historial for select to public using (ferreteriarepublica.puede_acceder_empresa(empresa_id));
