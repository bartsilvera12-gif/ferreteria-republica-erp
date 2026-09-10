"use client";

/**
 * Gestor de galería de imágenes de producto (administración).
 * - Lista imágenes (DTO sin imagen_path; usa preview_url firmada).
 * - Arrastrar para reordenar (@dnd-kit/sortable) → PATCH /imagenes/orden.
 * - Marcar principal → PATCH /imagenes/[imagenId] { es_principal:true }.
 * - Eliminar → DELETE /imagenes/[imagenId].
 * - Agregar → POST /imagenes (FormData file).
 * La posición NO depende solo del frontend: el backend valida IDs/pertenencia.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Imagen = { id: string; orden: number; es_principal: boolean; preview_url: string | null };

const MAX_UI = 8; // tope de UX; el backend (MAX_PRODUCT_IMAGES) es la autoridad real.

function SortableCard({
  img,
  onPrincipal,
  onDelete,
  busy,
}: {
  img: Imagen;
  onPrincipal: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="relative rounded-xl border border-gray-200 bg-white p-2"
    >
      <div
        {...attributes}
        {...listeners}
        className="aspect-square w-full cursor-grab overflow-hidden rounded-lg bg-[#0a1f50] active:cursor-grabbing"
        title="Arrastrar para reordenar"
      >
        {img.preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.preview_url} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-white/60">sin preview</div>
        )}
      </div>
      {img.es_principal ? (
        <span className="absolute left-3 top-3 rounded-full bg-[#E97932] px-2 py-0.5 text-[10px] font-bold text-white">
          PRINCIPAL
        </span>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-1">
        <button
          type="button"
          disabled={busy || img.es_principal}
          onClick={() => onPrincipal(img.id)}
          className="rounded px-2 py-1 text-xs font-semibold text-[#021F5F] enabled:hover:bg-gray-100 disabled:opacity-40"
        >
          {img.es_principal ? "Principal" : "Hacer principal"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(img.id)}
          className="rounded px-2 py-1 text-xs font-semibold text-red-600 enabled:hover:bg-red-50 disabled:opacity-40"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

export default function ProductGalleryManager({ productoId }: { productoId: string }) {
  const [imgs, setImgs] = useState<Imagen[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/productos/${productoId}/imagenes`, { credentials: "include" });
      const j = await r.json();
      setImgs(Array.isArray(j.imagenes) ? j.imagenes : []);
    } catch {
      setError("No se pudo cargar la galería.");
    } finally {
      setLoading(false);
    }
  }, [productoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = imgs.findIndex((i) => i.id === active.id);
    const newIndex = imgs.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(imgs, oldIndex, newIndex);
    setImgs(next); // optimista
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/productos/${productoId}/imagenes/orden`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orden: next.map((i) => i.id) }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setError("No se pudo guardar el orden.");
      void load(); // revertir a estado del servidor
    } finally {
      setBusy(false);
    }
  };

  const setPrincipal = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/productos/${productoId}/imagenes/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ es_principal: true }),
      });
      if (!r.ok) throw new Error();
      await load();
    } catch {
      setError("No se pudo marcar como principal.");
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm("¿Eliminar esta imagen?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/productos/${productoId}/imagenes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error();
      await load();
    } catch {
      setError("No se pudo eliminar la imagen.");
    } finally {
      setBusy(false);
    }
  };

  const add = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/productos/${productoId}/imagenes`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "No se pudo agregar la imagen.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar la imagen.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const canAdd = imgs.length < MAX_UI && !busy;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          Galería de imágenes <span className="text-gray-400">({imgs.length}/{MAX_UI})</span>
        </span>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => fileRef.current?.click()}
          className="rounded-md bg-[#021F5F] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          + Agregar imagen
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void add(f);
          }}
        />
      </div>
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-gray-500">Cargando galería…</p>
      ) : imgs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Sin imágenes. Agregá la primera (será la principal).
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={imgs.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {imgs.map((img) => (
                <SortableCard key={img.id} img={img} onPrincipal={setPrincipal} onDelete={del} busy={busy} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <p className="mt-2 text-xs text-gray-400">
        Arrastrá para reordenar. JPG, PNG o WebP · máx. 5 MB por imagen.
      </p>
    </div>
  );
}
