/** Auth + lectura de los 3 archivos del import inicial (form-data). */
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { parseUploadFile } from "@/lib/excel/import";
import type { Fuente } from "./consolidacion-productos";
import type { ArchivoEntrada } from "./import-inicial-productos";

/** Campo del form-data por reporte. Los tres son opcionales por separado. */
const CAMPOS: { campo: string; fuente: Fuente }[] = [
  { campo: "file_productos", fuente: "productos" },
  { campo: "file_stock_general", fuente: "stock_general" },
  { campo: "file_stock_valorizado", fuente: "stock_valorizado" },
];

export interface CtxImportInicial {
  empresaId: string;
  schema: string;
  usuarioCatalogId: string | null;
  usuarioNombre: string | null;
  archivos: ArchivoEntrada[];
  form: FormData;
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
    const parsed = await parseUploadFile(f);
    if ("error" in parsed) {
      return { ok: false, status: 400, error: `${f.name}: ${parsed.error}` };
    }
    archivos.push({ fuente, filename: f.name, headers: parsed.headers, rows: parsed.rows });
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
