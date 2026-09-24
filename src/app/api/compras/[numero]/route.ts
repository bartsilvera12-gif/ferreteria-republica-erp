import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  editarCompraConMovimiento,
  eliminarCompraConReversa,
  CompraEliminacionBloqueadaError,
  type EditarCompraLinea,
  type EditarCompraHeader,
} from "@/lib/compras/server/compras-pg";

const ivaOk = (v: unknown) =>
  ["exenta", "0", "5", "10"].includes(String(v)) ? (String(v) === "0" ? "exenta" : String(v)) : "10";

/**
 * PATCH /api/compras/[numero] — corrige una compra ya registrada.
 * El ajuste de stock se hace con un movimiento nuevo 'edicion_compra'.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const authRol = await getAuthWithRol(request);
    if (!esRolAdminEmpresaOGlobal(authRol?.rol)) {
      return NextResponse.json(errorResponse("Solo un administrador puede editar compras."), { status: 403 });
    }
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const { numero } = await params;
    const numeroControl = decodeURIComponent(numero);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawLineas = Array.isArray(body.lineas) ? (body.lineas as Record<string, unknown>[]) : [];
    if (rawLineas.length === 0)
      return NextResponse.json(errorResponse("No hay líneas para actualizar."), { status: 400 });

    const lineas: EditarCompraLinea[] = [];
    for (let i = 0; i < rawLineas.length; i++) {
      const it = rawLineas[i];
      const label = `Producto ${i + 1}`;
      const esNueva = it.id == null || String(it.id).trim() === "";
      if (esNueva && (it.producto_id == null || String(it.producto_id).trim() === ""))
        return NextResponse.json(errorResponse(`${label}: falta el producto.`), { status: 400 });
      if (!(Number(it.cantidad) > 0))
        return NextResponse.json(errorResponse(`${label}: la cantidad debe ser mayor a 0.`), { status: 400 });
      if (!(Number(it.costo_unitario) > 0))
        return NextResponse.json(errorResponse(`${label}: el costo unitario debe ser mayor a 0.`), { status: 400 });
      if (it.precio_venta != null && Number(it.precio_venta) < 0)
        return NextResponse.json(errorResponse(`${label}: el precio de venta no puede ser negativo.`), { status: 400 });
      lineas.push({
        id: esNueva ? null : String(it.id),
        producto_id: esNueva ? String(it.producto_id) : undefined,
        producto_nombre: esNueva ? String(it.producto_nombre ?? "") : undefined,
        cantidad: Number(it.cantidad) || 0,
        costo_unitario_original: Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
        costo_unitario: Number(it.costo_unitario) || 0,
        iva_tipo: ivaOk(it.iva_tipo),
        subtotal: Number(it.subtotal) || 0,
        monto_iva: Number(it.monto_iva) || 0,
        total: Number(it.total) || 0,
        precio_venta: Number(it.precio_venta) || 0,
        margen_venta: it.margen_venta != null ? Number(it.margen_venta) : null,
      });
    }

    const eliminar = Array.isArray(body.eliminar)
      ? (body.eliminar as unknown[]).map((x) => String(x)).filter((x) => x.trim() !== "")
      : [];

    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";
    const header: EditarCompraHeader = {
      numero_factura: req("numero_factura") ? String(body.numero_factura).trim() : null,
      nro_timbrado: req("nro_timbrado") ? String(body.nro_timbrado).trim().toUpperCase() : null,
      fecha_factura: req("fecha_factura") ? String(body.fecha_factura).trim().slice(0, 10) : null,
      observacion: req("observacion") ? String(body.observacion).trim().slice(0, 2000) : null,
      proveedor_id: req("proveedor_id") ? String(body.proveedor_id) : null,
      proveedor_nombre: req("proveedor_nombre") ? String(body.proveedor_nombre).trim() : null,
      comprobante_storage_path: req("comprobante_storage_path") ? String(body.comprobante_storage_path) : null,
      comprobante_nombre: req("comprobante_nombre") ? String(body.comprobante_nombre) : null,
      comprobante_mime_type: req("comprobante_mime_type") ? String(body.comprobante_mime_type) : null,
    };

    // Si se cambia el proveedor, validar que exista y pertenezca a la empresa.
    if (header.proveedor_id) {
      const pv = await ctx.supabase
        .from("proveedores").select("id")
        .eq("empresa_id", empresaId).eq("id", header.proveedor_id).maybeSingle();
      if (pv.error) throw new Error(pv.error.message);
      if (!pv.data) return NextResponse.json(errorResponse("El proveedor seleccionado no existe."), { status: 400 });
    }

    try {
      const out = await editarCompraConMovimiento(
        schema, empresaId, numeroControl, header, lineas, eliminar,
        { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.user?.email ?? null }
      );
      return NextResponse.json(successResponse(out));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo editar la compra.";
      const status = /no encontrada|orden de compra/i.test(msg) ? 400 : 500;
      console.error("[/api/compras/[numero] PATCH]", msg);
      return NextResponse.json(errorResponse(msg), { status });
    }
  } catch (err) {
    console.error("[/api/compras/[numero] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo editar la compra."), { status: 500 });
  }
}

/**
 * DELETE /api/compras/[numero] — elimina una compra registrada revirtiendo su
 * impacto (stock + costo_promedio) y registra auditoría. Solo admin.
 * Bloquea compras derivadas de una orden de compra.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const authRol = await getAuthWithRol(request);
    if (!esRolAdminEmpresaOGlobal(authRol?.rol)) {
      return NextResponse.json(errorResponse("Solo un administrador puede eliminar compras."), { status: 403 });
    }
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const { numero } = await params;
    const numeroControl = decodeURIComponent(numero);

    try {
      const out = await eliminarCompraConReversa(schema, empresaId, numeroControl, {
        id: ctx.auth.usuarioCatalogId ?? null,
        nombre: ctx.auth.user?.email ?? null,
      });
      return NextResponse.json(successResponse(out));
    } catch (e) {
      if (e instanceof CompraEliminacionBloqueadaError) {
        const status = e.motivo === "no_encontrada" ? 404 : 409;
        return NextResponse.json(errorResponse(e.message), { status });
      }
      const msg = e instanceof Error ? e.message : "No se pudo eliminar la compra.";
      console.error("[/api/compras/[numero] DELETE]", msg);
      return NextResponse.json(errorResponse(msg), { status: 500 });
    }
  } catch (err) {
    console.error("[/api/compras/[numero] DELETE] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar la compra."), { status: 500 });
  }
}
