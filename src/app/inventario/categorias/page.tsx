"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

interface Categoria {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
  imagen_url: string | null;
}

export default function CategoriasProductosPage() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form alta
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  // Modal de imagen
  const [imgEditing, setImgEditing] = useState<Categoria | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [imgSaving, setImgSaving] = useState(false);

  function openImg(cat: Categoria) {
    setImgEditing(cat);
    setImgUrl(cat.imagen_url ?? "");
  }
  async function saveImg() {
    if (!imgEditing) return;
    setImgSaving(true);
    try {
      const r = await fetch(`/api/inventario/categorias/${imgEditing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ imagen_url: imgUrl.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo actualizar la imagen.");
      } else {
        setImgEditing(null);
        setImgUrl("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setImgSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/categorias?todas=1", { credentials: "include" });
      const j = await r.json();
      if (r.ok && j?.success) setItems(j.data.categorias as Categoria[]);
      else setError(j?.error ?? "No se pudo cargar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          parent_id: parentId || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear.");
      } else {
        setNombre(""); setCodigo(""); setParentId("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(cat: Categoria) {
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ activo: !cat.activo }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Categorías de productos</h1>
          <p className="text-gray-600">Clasificá tus productos para reportes y búsqueda.</p>
          <div className="mt-3 max-w-2xl rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Estas categorías aparecen en el selector <strong>Categoría principal</strong> de Nuevo producto.
            Los <Link href="/proveedores/categorias" className="underline font-medium">rubros de proveedor</Link>{" "}
            también se importan automáticamente acá, así no tenés que cargarlos dos veces.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportExcelButton url="/api/inventario/categorias/export" />
          <ImportExcelButton
            entidad="Categorías"
            previewUrl="/api/inventario/categorias/import/preview"
            commitUrl="/api/inventario/categorias/import/commit"
            templateUrl="/api/inventario/categorias/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={load}
          />
          <Link href="/inventario" className="text-sm text-sky-700 hover:text-sky-900 underline">
            ← Volver a Inventario
          </Link>
        </div>
      </div>

      {/* Alta */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
          Nueva categoría
        </p>
        <form onSubmit={handleCrear} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: BEBIDAS"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Código (opcional)</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: BEB"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Categoría padre (opcional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear categoría"}
            </button>
          </div>
        </form>
        {error && (
          <p className="mt-2 text-xs text-red-700">{error}</p>
        )}
      </div>

      {/* Lista */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Todavía no cargaste categorías.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Imagen</th>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Padre</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const parent = items.find((i) => i.id === c.parent_id);
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      {c.imagen_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.imagen_url}
                          alt={c.nombre}
                          className="h-10 w-10 rounded-md object-cover bg-slate-100 border border-slate-200"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">
                          sin
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium">{c.nombre}</td>
                    <td className="px-4 py-2 text-gray-500">{c.codigo ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{parent?.nombre ?? "—"}</td>
                    <td className="px-4 py-2">
                      {c.activo ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Activo</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right space-x-3">
                      <button
                        onClick={() => openImg(c)}
                        className="text-xs text-sky-700 hover:text-sky-900 underline"
                      >
                        {c.imagen_url ? "Cambiar imagen" : "Agregar imagen"}
                      </button>
                      <button
                        onClick={() => toggleActivo(c)}
                        className="text-xs text-sky-700 hover:text-sky-900 underline"
                      >
                        {c.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal imagen */}
      {imgEditing && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !imgSaving && setImgEditing(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Imagen de categoría</h3>
            <p className="text-xs text-gray-500 mb-4">
              Categoría: <strong>{imgEditing.nombre}</strong>
            </p>
            <label className="block text-xs text-gray-600 mb-1">URL de la imagen</label>
            <input
              type="url"
              value={imgUrl}
              onChange={(e) => setImgUrl(e.target.value)}
              placeholder="https://..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3"
              autoFocus
            />
            {imgUrl && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Preview:</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgUrl}
                  alt="preview"
                  className="h-32 w-full object-cover rounded-lg bg-slate-50 border border-slate-200"
                />
              </div>
            )}
            <p className="text-[11px] text-gray-400 mb-4">
              Pegá una URL pública (ej. Unsplash, Imgur, o cualquier CDN). Si dejás vacío y
              guardás, se quita la imagen.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setImgEditing(null)}
                disabled={imgSaving}
                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
              >
                Cancelar
              </button>
              <button
                onClick={saveImg}
                disabled={imgSaving}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
              >
                {imgSaving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
