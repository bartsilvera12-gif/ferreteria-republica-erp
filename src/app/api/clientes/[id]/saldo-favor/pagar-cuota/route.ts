import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { pagarCuotaConSaldo, CreditoOperacionError, CreditoInsuficienteError } from "@/lib/creditos/server/anticipos-pg";
import { crearOReusarRecibo } from "@/lib/recibos/server/recibos-pg";

/**
 * POST /api/clientes/[id]/saldo-favor/pagar-cuota — paga una cuota (cuenta por
 * cobrar) usando el saldo a favor del cliente. Descuenta el saldo y NO genera un
 * nuevo ingreso de Caja. Emite recibo (cobro_cxc). Body: { cuenta_por_cobrar_id, monto }
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
    const cuentaPorCobrarId = typeof body.cuenta_por_cobrar_id === "string" ? body.cuenta_por_cobrar_id : "";
    const monto = Number(body.monto);
    if (!cuentaPorCobrarId) return NextResponse.json(errorResponse("Falta la cuenta por cobrar."), { status: 400 });
    if (!(monto > 0)) return NextResponse.json(errorResponse("El monto debe ser mayor a cero."), { status: 400 });

    try {
      const out = await pagarCuotaConSaldo(schema, auth.empresa_id, {
        clienteId: id, cuentaPorCobrarId, monto, usuario,
      });
      // Comprobante del cobro (best-effort).
      let recibo: { id: string; numero_recibo: string } | null = null;
      let recibo_warning: string | null = null;
      try {
        const r = await crearOReusarRecibo(supabase, auth.empresa_id, { origen: "cobro_cxc", cobro_cliente_id: out.cobroId }, usuario);
        recibo = { id: String(r.recibo.id), numero_recibo: String(r.recibo.numero_recibo) };
      } catch (re) {
        recibo_warning = re instanceof Error ? re.message : "No se pudo emitir el recibo.";
        console.error("[saldo-favor/pagar-cuota recibo]", recibo_warning);
      }
      return NextResponse.json(successResponse({ ...out, recibo, recibo_warning }));
    } catch (e) {
      if (e instanceof CreditoInsuficienteError) return NextResponse.json(errorResponse(e.message), { status: 409 });
      if (e instanceof CreditoOperacionError) return NextResponse.json(errorResponse(e.message), { status: e.status });
      const msg = e instanceof Error ? e.message : "No se pudo pagar la cuota con saldo.";
      console.error("[saldo-favor/pagar-cuota POST]", msg);
      return NextResponse.json(errorResponse(msg), { status: 500 });
    }
  } catch (err) {
    console.error("[saldo-favor/pagar-cuota POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo pagar la cuota con saldo."), { status: 500 });
  }
}
