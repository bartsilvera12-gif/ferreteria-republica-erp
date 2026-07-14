import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getExtractoCliente } from "@/lib/reportes/server/creditos-pg";
import { buildExtractoPdf } from "@/lib/reportes/server/extracto-pdf";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * GET /api/reportes/creditos/[clienteId]/pdf
 * Devuelve el extracto de crédito del cliente como PDF descargable.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clienteId: string }> }
) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("No autorizado", { status: 401 });
  try {
    const { clienteId } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getExtractoCliente(schema, ctx.auth.empresa_id, clienteId);
    if (!data) return new Response("Cliente no encontrado", { status: 404 });

    const pdf = await buildExtractoPdf(data, {
      nombre: EMPRESA_DOC.nombre,
      telefono: EMPRESA_DOC.telefono,
      direccion: EMPRESA_DOC.direccion.join(" · "),
    });

    const slug = data.cliente.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "cliente";

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="extracto-${slug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/reportes/creditos/[clienteId]/pdf]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el PDF", { status: 500 });
  }
}
