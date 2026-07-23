/** Auth + lectura de los 3 archivos del import inicial (form-data). */
import * as XLSX from "xlsx";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import type { Fuente } from "./consolidacion-productos";
import type { ArchivoEntrada } from "./import-inicial-productos";

/** Campo del form-data por reporte. Los tres son opcionales por separado. */
const CAMPOS: { campo: string; fuente: Fuente }[] = [
  { campo: "file_productos", fuente: "productos" },
  { campo: "file_stock_general", fuente: "stock_general" },
  { campo: "file_stock_valorizado", fuente: "stock_valorizado" },
];

const MAX_BYTES = 30 * 1024 * 1024; // reportes grandes: hasta 30 MB

export interface CtxImportInicial {
  empresaId: string;
  schema: string;
  usuarioCatalogId: string | null;
  usuarioNombre: string | null;
  archivos: ArchivoEntrada[];
  form: FormData;
}

/** Lee un .xls/.xlsx como matriz de filas (AOA), sin asumir encabezado. */
export function bufferToAoa(buf: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.SheetNames[0];
  if (!sheet) return [];
  const ws = wb.Sheets[sheet];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
}

export async function leerArchivosYAuth(request: Request): Promise<
  { ok: true; ctx: CtxImportInicial } | { ok: false; status: number; error: string }
> {
  const auth = await getAuthWithRol(request);
  if (!auth) return { ok: false, status: 401, error: "No autenticado." };
  if (!isAdmin(auth)) return { ok: false, status: 403, error: "Solo administradores pueden importar." };

  const tenant = await getTenantSupabaseFromAuth(request);
  if (!tenant) return { ok: false, status: 401, error: "No autenticado." };
  const empresaId = tenant.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, error: "Form-data inválido." };
  }

  const archivos: ArchivoEntrada[] = [];
  for (const { campo, fuente } of CAMPOS) {
    const f = form.get(campo);
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_BYTES) {
      return { ok: false, status: 400, error: `${f.name}: archivo demasiado grande (máx. 30 MB).` };
    }
    try {
      const aoa = bufferToAoa(await f.arrayBuffer());
      archivos.push({ fuente, filename: f.name, aoa });
    } catch (e) {
      return { ok: false, status: 400, error: `${f.name}: ${e instanceof Error ? e.message : "no se pudo leer"}` };
    }
  }

  if (archivos.length === 0) {
    return { ok: false, status: 400, error: "Subí al menos uno de los tres reportes." };
  }

  return {
    ok: true,
    ctx: {
      empresaId,
      schema,
      usuarioCatalogId: tenant.auth.usuarioCatalogId ?? null,
      usuarioNombre: tenant.auth.user?.email ?? null,
      archivos,
      form,
    },
  };
}
