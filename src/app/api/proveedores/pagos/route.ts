import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listPagosProveedor, registrarPagoProveedor } from "@/lib/proveedores/server/cuentas-pagar-pg";

const MEDIOS = new Set(["efectivo", "transferencia", "tarjeta", "otro"]);

/** GET /api/proveedores/pagos?numero_control=...  — pagos de una compra. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sp = request.nextUrl.searchParams;
    const numeroControl = (sp.get("numero_control") ?? "").trim();
    const proveedorId = (sp.get("proveedor_id") ?? "").trim();
    if (!numeroControl && !proveedorId) {
      return NextResponse.json(errorResponse("Indicá numero_control o proveedor_id."), { status: 400 });
    }
    const items = await listPagosProveedor(schema, ctx.auth.empresa_id, {
      numeroControl: numeroControl || undefined,
      proveedorId: proveedorId || undefined,
    });
    return NextResponse.json(successResponse({ items }));
  } catch (err) {
    console.error("[/api/proveedores/pagos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los pagos."), { status: 500 });
  }
}

/** POST /api/proveedores/pagos — registra un pago contra una compra a crédito. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const numeroControl = String(body.numero_control ?? "").trim();
    const monto = Number(body.monto);
    const medioRaw = String(body.medio_pago ?? "efectivo").toLowerCase();
    const medioPago = (MEDIOS.has(medioRaw) ? medioRaw : "efectivo") as "efectivo" | "transferencia" | "tarjeta" | "otro";
    const observacion = body.observacion == null || String(body.observacion).trim() === "" ? null : String(body.observacion).slice(0, 500);

    if (!numeroControl) return NextResponse.json(errorResponse("Falta la compra."), { status: 400 });
    if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json(errorResponse("Monto inválido."), { status: 400 });

    const res = await registrarPagoProveedor(schema, ctx.auth.empresa_id, {
      numeroControl,
      monto,
      medioPago,
      observacion,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      usuarioNombre: ctx.auth.nombre ?? null,
      usuarioEmail: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse(res));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
    const status = /caja abierta|saldo|saldada|supera|no existe/i.test(msg) ? 409 : 500;
    console.error("[/api/proveedores/pagos POST]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
