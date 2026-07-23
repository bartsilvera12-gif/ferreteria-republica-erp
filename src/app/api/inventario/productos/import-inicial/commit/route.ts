import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivosYAuth } from "@/lib/imports/import-inicial-helpers";
import { construirPreview, commitConsolidado } from "@/lib/imports/import-inicial-productos";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const res = await leerArchivosYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  const { ctx } = res;
  try {
    // Se re-consolida en el commit en vez de recibir el JSON del preview: la
    // consolidación es determinística sobre los mismos archivos, así evitamos
    // subir un payload gigante y no hay riesgo de que llegue manipulado.
    const preview = await construirPreview(ctx.schema, ctx.empresaId, ctx.archivos);

    const out = await commitConsolidado(ctx.schema, ctx.empresaId, preview.items, {
      createdBy: ctx.usuarioCatalogId,
      usuarioNombre: ctx.usuarioNombre,
      filenames: ctx.archivos.map((a) => a.filename),
      actualizarExistentes: String(ctx.form.get("actualizar_existentes") ?? "") === "1",
      crearCategorias: String(ctx.form.get("crear_categorias") ?? "1") === "1",
    });

    return NextResponse.json(successResponse({ ...out, resumen: preview.resumen }));
  } catch (e) {
    console.error("[productos/import-inicial/commit]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      errorResponse("No se pudo completar la importación."),
      { status: 500 }
    );
  }
}
