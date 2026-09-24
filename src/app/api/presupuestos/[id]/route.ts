import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto, type IvaTipoPresupuesto } from "@/lib/presupuestos/types";
import {
  actualizarPresupuesto,
  PresupuestoEdicionBloqueadaError,
  type CrearPresupuestoInput,
  type PresupuestoItemInput,
} from "@/lib/presupuestos/server/presupuestos-pg";

const PRESU_COLS =
  "id, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_direccion, " +
  "numero_control, estado, moneda, subtotal, monto_iva, descuento_total, total, validez_dias, " +
  "fecha, fecha_vencimiento, condicion, forma_pago, plazo_entrega, observaciones, " +
  "convertido_pedido_id, convertido_venta_id, created_at, updated_at";

/**
 * `*` y no una lista explícita: las migraciones de este repo se aplican a mano,
 * y nombrar `presentacion_*` antes de que la migración corra haría fallar el
 * detalle entero. Con `*` las columnas aparecen cuando existen.
 */
const ITEM_COLS = "*";

/** GET /api/presupuestos/[id] — detalle + ítems. */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const pq = await ctx.supabase
      .from("presupuestos")
      .select(PRESU_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (pq.error) throw new Error(pq.error.message);
    if (!pq.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const itq = await ctx.supabase
      .from("presupuesto_items")
      .select(ITEM_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("presupuesto_id", id)
      .order("created_at", { ascending: true });
    if (itq.error) throw new Error(itq.error.message);

    return NextResponse.json(successResponse({ presupuesto: pq.data, items: itq.data ?? [] }));
  } catch (err) {
    console.error("[/api/presupuestos/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el presupuesto."), { status: 500 });
  }
}

/**
 * PATCH /api/presupuestos/[id] — cambiar estado (creado|enviado|aprobado|rechazado).
 * NO permite setear 'convertido' por acá (eso lo hace /convertir). NO toca stock.
 */
export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const nuevoEstado = body.estado as EstadoPresupuesto | undefined;
    if (!nuevoEstado || !ESTADOS_PRESUPUESTO.includes(nuevoEstado)) {
      return NextResponse.json(errorResponse("Estado inválido."), { status: 400 });
    }
    if (nuevoEstado === "convertido") {
      return NextResponse.json(
        errorResponse("Para convertir usá la acción 'Convertir en pedido'."),
        { status: 400 }
      );
    }

    // No permitir cambiar el estado de un presupuesto ya convertido.
    const cur = await ctx.supabase
      .from("presupuestos")
      .select("estado")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    if ((cur.data as { estado: string }).estado === "convertido") {
      return NextResponse.json(errorResponse("El presupuesto ya fue convertido; no se puede cambiar su estado."), { status: 409 });
    }

    const upd = await ctx.supabase
      .from("presupuestos")
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select(PRESU_COLS)
      .maybeSingle();
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    return NextResponse.json(successResponse({ presupuesto: upd.data }));
  } catch (err) {
    console.error("[/api/presupuestos/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el presupuesto."), { status: 500 });
  }
}

/**
 * PUT /api/presupuestos/[id] — edición completa (cliente, ítems, condiciones,
 * observaciones), recalculando totales y conservando el mismo numero_control.
 * Solo roles admin/administrador/super_admin. Bloquea si ya está convertido.
 * Registra quién editó (updated_by / updated_by_nombre). No toca ventas ni facturación.
 */
export async function PUT(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esRolAdminEmpresaOGlobal(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo un administrador puede editar presupuestos."), { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    const items: PresupuestoItemInput[] = rawItems.map((it) => ({
      producto_id: it.producto_id != null ? String(it.producto_id) : null,
      producto_nombre: String(it.producto_nombre ?? ""),
      sku: it.sku != null ? String(it.sku) : null,
      cantidad: Number(it.cantidad) || 0,
      unidad_medida: it.unidad_medida != null ? String(it.unidad_medida) : null,
      precio_unitario: Number(it.precio_unitario) || 0,
      iva_tipo: (it.iva_tipo === "5%" || it.iva_tipo === "EXENTA" ? it.iva_tipo : "10%") as IvaTipoPresupuesto,
      descuento: Number(it.descuento) || 0,
      presentacion_id: it.presentacion_id != null ? String(it.presentacion_id) : null,
      presentacion_nombre: it.presentacion_nombre != null ? String(it.presentacion_nombre) : null,
      presentacion_cantidad_base: it.presentacion_cantidad_base != null ? Number(it.presentacion_cantidad_base) : null,
    }));

    const validezRaw = body.validez_dias;
    const input: CrearPresupuestoInput = {
      cliente_id: body.cliente_id != null ? String(body.cliente_id) : null,
      cliente_nombre: String(body.cliente_nombre ?? ""),
      cliente_ruc: body.cliente_ruc != null ? String(body.cliente_ruc) : null,
      cliente_telefono: body.cliente_telefono != null ? String(body.cliente_telefono) : null,
      cliente_direccion: body.cliente_direccion != null ? String(body.cliente_direccion) : null,
      moneda: String(body.moneda ?? "PYG"),
      validez_dias:
        validezRaw != null && String(validezRaw).trim() !== "" ? parseInt(String(validezRaw), 10) || null : null,
      condicion: body.condicion === "credito" ? "credito" : "contado",
      forma_pago: body.forma_pago != null ? String(body.forma_pago) : null,
      plazo_entrega: body.plazo_entrega != null ? String(body.plazo_entrega) : null,
      observaciones: body.observaciones != null ? String(body.observaciones) : null,
      items,
    };

    const base = await getUserAndEmpresa(request);
    const usuario = { id: base?.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? base?.nombre ?? null };

    const r = await actualizarPresupuesto(ctx.supabase, ctx.auth.empresa_id, id, input, usuario);
    return NextResponse.json(successResponse({ id: r.id, numero_control: r.numero_control }));
  } catch (err) {
    if (err instanceof PresupuestoEdicionBloqueadaError) {
      return NextResponse.json(
        { success: false, error: err.message, motivo: err.motivo },
        { status: err.motivo === "no_encontrado" ? 404 : 409 }
      );
    }
    const msg = err instanceof Error ? err.message : "No se pudo editar el presupuesto.";
    console.error("[/api/presupuestos/[id] PUT]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
