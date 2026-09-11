/**
 * DELETE /api/productos/[id]/imagenes/[imagenId] — borra una imagen (promueve
 *   principal si corresponde).
 * PATCH  /api/productos/[id]/imagenes/[imagenId]  — { es_principal: true } marca
 *   esa imagen como principal (transaccional).
 */
import { NextResponse, type NextRequest } from "next/server";
import { resolveGaleriaCtx } from "@/lib/inventario/galeria-api";
import { borrarImagen } from "@/lib/inventario/galeria-service";
import { setPrincipalPg } from "@/lib/inventario/server/galeria-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imagenId: string }> }
) {
  const { id, imagenId } = await params;
  const r = await resolveGaleriaCtx(request, id);
  if (r.error) return r.error;
  try {
    const ok = await borrarImagen(r.ctx, id, imagenId);
    if (!ok) return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/productos/imagenes][DELETE]", e);
    return NextResponse.json({ error: "No se pudo borrar la imagen." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imagenId: string }> }
) {
  const { id, imagenId } = await params;
  const r = await resolveGaleriaCtx(request, id);
  if (r.error) return r.error;

  let body: { es_principal?: unknown } = {};
  try { body = await request.json(); } catch { /* body vacío */ }
  if (body?.es_principal !== true) {
    return NextResponse.json({ error: "Solo se soporta { es_principal: true }." }, { status: 400 });
  }
  try {
    const ok = await setPrincipalPg(r.ctx.schema, r.ctx.empresaId, id, imagenId);
    if (!ok) return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/productos/imagenes][PATCH]", e);
    return NextResponse.json({ error: "No se pudo marcar como principal." }, { status: 500 });
  }
}
