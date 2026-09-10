import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  signProductoImagen,
} from "@/lib/inventario/imagen-storage";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import {
  reemplazarPrincipal,
  borrarPrincipalLegacy,
  GaleriaValidacionError,
  type GaleriaCtx,
} from "@/lib/inventario/galeria-service";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Imagen de producto — usa Storage de Supabase + PostgREST (no pool PG).
 * Compatible con Hostinger sin SUPABASE_DB_URL.
 */

async function fetchProducto(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string
): Promise<{ id: string; imagen_path: string | null } | null> {
  const { data, error } = await sb
    .from("productos")
    .select("id, imagen_path")
    .eq("empresa_id", empresaId)
    .eq("id", productoId)
    .maybeSingle();
  if (error) {
    console.error("[productos imagen] fetchProducto", error.message);
    return null;
  }
  return (data as { id: string; imagen_path: string | null } | null) ?? null;
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const prod = await fetchProducto(ctx.supabase, ctx.auth.empresa_id, productoId);
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const signed = prod.imagen_path
      ? await signProductoImagen(ctx.supabase, prod.imagen_path, 3600)
      : null;
    return NextResponse.json(
      successResponse({ imagen_path: prod.imagen_path, imagen_url: signed })
    );
  } catch (err) {
    console.error("[/api/productos/[id]/imagen GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener la imagen."), { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    // 1) Ownership via PostgREST
    const prod = await fetchProducto(supabase, empresaId, productoId);
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    // 2) Archivo (validación de status codes fina; el service revalida)
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse("Formato no permitido. Usá JPG, PNG o WebP."),
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        errorResponse(`Imagen demasiado grande (máx. ${mb} MB).`),
        { status: 413 }
      );
    }

    // 3) SEMÁNTICA LEGACY = "reemplazar imagen principal" usando la MISMA lógica
    // de galería (una sola fuente de verdad). Usa path único {imagen_id}.{ext}
    // (nunca sobrescribe principal.{ext}); conserva las secundarias existentes;
    // sincroniza productos.imagen_path/imagen_url; borra el objeto de la anterior
    // principal tras el COMMIT.
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const gctx: GaleriaCtx = { empresaId, schema, supabase };
    try {
      const row = await reemplazarPrincipal(gctx, productoId, file);
      const signed = row.imagen_path
        ? await signProductoImagen(supabase, row.imagen_path, 3600)
        : row.imagen_url;
      return NextResponse.json(
        successResponse({ imagen_path: row.imagen_path, imagen_url: signed })
      );
    } catch (e) {
      if (e instanceof GaleriaValidacionError) {
        return NextResponse.json(errorResponse(e.message), { status: 400 });
      }
      throw e;
    }
  } catch (err) {
    console.error("[/api/productos/[id]/imagen POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir la imagen."), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const prod = await fetchProducto(supabase, empresaId, productoId);
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    // SEMÁNTICA LEGACY: borra la principal; si hay secundarias, promueve la
    // primera por orden; sincroniza el espejo legacy. Coherente con la galería.
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const gctx: GaleriaCtx = { empresaId, schema, supabase };
    const { nuevaPrincipal } = await borrarPrincipalLegacy(gctx, productoId);

    // Responder el ESTADO REAL tras la promoción: si quedó una nueva principal,
    // devolverla (path + url firmada); solo null/null si el producto quedó sin
    // imágenes. Así el caller no fuerza un estado "sin imagen" incorrecto.
    if (nuevaPrincipal) {
      const signed = nuevaPrincipal.imagen_path
        ? await signProductoImagen(supabase, nuevaPrincipal.imagen_path, 3600)
        : nuevaPrincipal.imagen_url;
      return NextResponse.json(
        successResponse({ imagen_path: nuevaPrincipal.imagen_path, imagen_url: signed })
      );
    }
    return NextResponse.json(successResponse({ imagen_path: null, imagen_url: null }));
  } catch (err) {
    console.error("[/api/productos/[id]/imagen DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar la imagen."), { status: 500 });
  }
}
