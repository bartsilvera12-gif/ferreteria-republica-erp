/**
 * GET  /api/productos/[id]/imagenes  — lista la galería (DTO sin imagen_path).
 * POST /api/productos/[id]/imagenes  — agrega una imagen (FormData `file`).
 * Admin, tenant-scoped, ownership del producto validado.
 */
import { NextResponse, type NextRequest } from "next/server";
import { resolveGaleriaCtx, toGaleriaDto } from "@/lib/inventario/galeria-api";
import { listGaleriaPg } from "@/lib/inventario/server/galeria-pg";
import {
  agregarImagen,
  GaleriaLimiteError,
  GaleriaValidacionError,
} from "@/lib/inventario/galeria-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveGaleriaCtx(request, id);
  if (r.error) return r.error;
  const rows = await listGaleriaPg(r.ctx.schema, r.ctx.empresaId, id);
  const imagenes = await Promise.all(rows.map((row) => toGaleriaDto(r.ctx, row)));
  return NextResponse.json({ imagenes });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveGaleriaCtx(request, id);
  if (r.error) return r.error;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo (campo 'file')." }, { status: 400 });
  }
  try {
    const row = await agregarImagen(r.ctx, id, file);
    return NextResponse.json({ imagen: await toGaleriaDto(r.ctx, row) }, { status: 201 });
  } catch (e) {
    if (e instanceof GaleriaValidacionError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof GaleriaLimiteError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("[api/productos/imagenes][POST]", e);
    return NextResponse.json({ error: "No se pudo agregar la imagen." }, { status: 500 });
  }
}
