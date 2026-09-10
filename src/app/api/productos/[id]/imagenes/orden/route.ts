/**
 * PATCH /api/productos/[id]/imagenes/orden — reordena la galería.
 * Body: { orden: string[] } (ids en el nuevo orden; permutación exacta de la
 * galería del producto: sin duplicados ni IDs ajenos). Transaccional.
 */
import { NextResponse, type NextRequest } from "next/server";
import { resolveGaleriaCtx } from "@/lib/inventario/galeria-api";
import { reorderGaleriaPg } from "@/lib/inventario/server/galeria-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveGaleriaCtx(request, id);
  if (r.error) return r.error;

  let body: { orden?: unknown } = {};
  try { body = await request.json(); } catch { /* body vacío */ }
  const orden = body?.orden;
  if (!Array.isArray(orden) || orden.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "Se espera { orden: string[] }." }, { status: 400 });
  }
  try {
    const ok = await reorderGaleriaPg(r.ctx.schema, r.ctx.empresaId, id, orden as string[]);
    if (!ok) {
      return NextResponse.json(
        { error: "Orden inválido: IDs duplicados, ajenos o incompletos." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/productos/imagenes/orden][PATCH]", e);
    return NextResponse.json({ error: "No se pudo reordenar." }, { status: 500 });
  }
}
