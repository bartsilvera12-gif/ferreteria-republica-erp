import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteConciliacion } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta",
  qr: "QR", billetera: "Billetera", otro: "Otro",
};
const metodoLabel = (m: string | null) => (m ? METODO[m] ?? m : "");

/** GET /api/reportes/conciliacion/export?mes=YYYY-MM → XLSX (Resumen + Por método + Por entidad + Ventas). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const r = await getReporteConciliacion(schema, ctx.auth.empresa_id, { mes, start, end, mesInicio: `${mes}-01` });

    const resumen = [
      { concepto: "Reporte", valor: "Conciliación bancaria" },
      { concepto: "Mes", valor: mes },
      { concepto: "Total cobrado (según detalle)", valor: r.totalCobrado },
      { concepto: "Operaciones de cobro", valor: r.cantidadOperaciones },
      { concepto: "Ventas del mes", valor: r.cantidadVentas },
      { concepto: "Ventas con detalle", valor: r.ventasConDetalle },
      { concepto: "Ventas sin detalle", valor: r.ventasSinDetalle },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 32 },
        { header: "Valor", value: (x) => x.valor, width: 24 },
      ]),
      sheetFromRows("Por método", r.porMetodo, [
        { header: "Método", value: (x) => metodoLabel(x.clave), width: 18 },
        { header: "Operaciones", value: (x) => x.cantidad, width: 12 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Por entidad", r.porEntidad, [
        { header: "Entidad", value: (x) => x.clave, width: 28 },
        { header: "Operaciones", value: (x) => x.cantidad, width: 12 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Ventas", r.ventas, [
        { header: "Fecha", value: (v) => (v.fecha ? new Date(v.fecha) : ""), width: 20 },
        { header: "N° Venta", value: (v) => v.numero_control, width: 16 },
        { header: "Cliente", value: (v) => v.cliente ?? "", width: 26 },
        { header: "Método", value: (v) => metodoLabel(v.metodo_pago), width: 16 },
        { header: "Entidad", value: (v) => v.entidad ?? "", width: 24 },
        { header: "Referencia", value: (v) => v.referencia ?? "", width: 20 },
        { header: "Monto", value: (v) => (v.monto ?? ""), width: 16 },
        { header: "Estado", value: (v) => (v.con_detalle ? "Con detalle" : "Sin detalle"), width: 14 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`conciliacion-${mes}`) });
  } catch (err) {
    console.error("[/api/reportes/conciliacion/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
