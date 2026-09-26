import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getSaldoCliente, listarMovimientosCliente } from "@/lib/creditos/server/creditos-pg";
import {
  registrarAnticipo,
  SinCajaAbiertaError,
  CreditoOperacionError,
  CreditoInsuficienteError,
} from "@/lib/creditos/server/anticipos-pg";
import { crearReciboManual } from "@/lib/recibos/server/recibos-pg";

/**
 * GET /api/clientes/[id]/saldo-favor
 * Saldo a favor del cliente + últimos movimientos. Lo usa Caja para avisarle al
 * cajero que el cliente tiene crédito disponible.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const auth = await getUserAndEmpresa(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const [saldo, movimientos] = await Promise.all([
      getSaldoCliente(schema, auth.empresa_id, id),
      listarMovimientosCliente(schema, auth.empresa_id, id, 20),
    ]);
    return NextResponse.json(successResponse({ saldo, movimientos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el saldo.";
    console.error("[/api/clientes/[id]/saldo-favor]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/clientes/[id]/saldo-favor — registra un anticipo/saldo a favor:
 * ingreso de Caja + crédito 'anticipo' (atómico) y emite un recibo de dinero.
 */
export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const usuario = { id: auth.user?.id ?? null, nombre: auth.nombre ?? auth.user?.email ?? null };

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const monto = Number(body.monto);
    if (!(monto > 0)) return NextResponse.json(errorResponse("El monto del anticipo debe ser mayor a cero."), { status: 400 });
    const medioPago = typeof body.medio_pago === "string" ? body.medio_pago : "efectivo";
    const concepto = typeof body.concepto === "string" ? body.concepto : null;
    const observacion = typeof body.observacion === "string" ? body.observacion : null;

    try {
      const out = await registrarAnticipo(schema, auth.empresa_id, {
        clienteId: id, monto, medioPago, concepto, observacion, usuario,
      });
      // Comprobante (best-effort: el anticipo ya quedó registrado).
      let recibo: { id: string; numero_recibo: string } | null = null;
      let recibo_warning: string | null = null;
      try {
        const r = await crearReciboManual(supabase, auth.empresa_id, {
          cliente_id: id,
          monto: out.monto,
          metodo_pago: medioPago,
          concepto: concepto || "Recibo de anticipo / saldo a favor",
          observaciones: observacion,
        }, usuario);
        recibo = { id: String(r.recibo.id), numero_recibo: String(r.recibo.numero_recibo) };
      } catch (re) {
        recibo_warning = re instanceof Error ? re.message : "No se pudo emitir el recibo.";
        console.error("[saldo-favor POST recibo]", recibo_warning);
      }
      return NextResponse.json(successResponse({ ...out, recibo, recibo_warning }));
    } catch (e) {
      if (e instanceof SinCajaAbiertaError) return NextResponse.json(errorResponse(e.message), { status: 409 });
      if (e instanceof CreditoInsuficienteError) return NextResponse.json(errorResponse(e.message), { status: 409 });
      if (e instanceof CreditoOperacionError) return NextResponse.json(errorResponse(e.message), { status: e.status });
      const msg = e instanceof Error ? e.message : "No se pudo registrar el anticipo.";
      console.error("[/api/clientes/[id]/saldo-favor POST]", msg);
      return NextResponse.json(errorResponse(msg), { status: 500 });
    }
  } catch (err) {
    console.error("[/api/clientes/[id]/saldo-favor POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el anticipo."), { status: 500 });
  }
}
