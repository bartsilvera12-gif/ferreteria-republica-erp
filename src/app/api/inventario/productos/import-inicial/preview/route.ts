import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivosYAuth } from "@/lib/imports/import-inicial-helpers";
import { construirPreview } from "@/lib/imports/import-inicial-productos";

export async function POST(request: NextRequest) {
  const res = await leerArchivosYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const preview = await construirPreview(res.ctx.schema, res.ctx.empresaId, res.ctx.archivos);
    return NextResponse.json(successResponse(preview));
  } catch (e) {
    console.error("[productos/import-inicial/preview]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      errorResponse("No se pudo generar la vista previa consolidada."),
      { status: 500 }
    );
  }
}
