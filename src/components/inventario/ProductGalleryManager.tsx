"use client";

/**
 * Gestor de galería de imágenes de producto (administración).
 * - Lista imágenes (DTO sin imagen_path; usa preview_url firmada).
 * - LA PRINCIPAL SIEMPRE PRIMERA y FIJA: no se arrastra. Solo se reordenan las
 *   secundarias (@dnd-kit/sortable) → PATCH /imagenes/orden con el orden completo
 *   [principal, ...secundarias]. Así la UI optimista y el orden persistido nunca
 *   se contradicen al recargar.
 * - Marcar principal → PATCH /imagenes/[imagenId] { es_principal:true } (recarga:
 *   la nueva principal pasa a la primera posición).
 * - Eliminar → DELETE /imagenes/[imagenId].
 * - Agregar → POST /imagenes (FormData file). El tope real es max_images del
 *   backend (MAX_PRODUCT_IMAGES), no un número hardcodeado.
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
import { DEFAULT_MAX_PRODUCT_IMAGES } from "@/lib/inventario/galeria-config";
import { ordenarConPrincipalPrimero } from "@/lib/inventario/galeria-helpers";

type Imagen = { id: string; orden: number; es_principal: boolean; preview_url: string | null };

/** Tarjeta base (principal fija o secundaria arrastrable comparten estilo). */
function Card({
  img,
  drag,
  onPrincipal,
  onDelete,
  busy,
}: {
  img: Imagen;
  drag?: { setNodeRef: (el: HTMLElement | null) => void; style: React.CSSProperties; attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined; isDragging: boolean };
  onPrincipal: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div
      ref={drag?.setNodeRef}
      style={drag ? drag.style : undefined}
      className="relative rounded-xl border border-gray-200 bg-white p-2"
    >
      <div
        {...(drag?.attributes ?? {})}
        {...(drag?.listeners ?? {})}
        className={
          "aspect-square w-full overflow-hidden rounded-lg bg-[#0a1f50] " +
          (drag ? "cursor-grab active:cursor-grabbing" : "")
        }
        title={drag ? "Arrastrar para reordenar" : "Imagen principal (posición fija)"}
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

/** Tarjeta arrastrable (solo secundarias). */
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
    <Card
      img={img}
      drag={{
        setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 },
        // dnd-kit tipa attributes/listeners con formas específicas; se pasan como
        // props genéricas al spread del div (el spread JSX las acepta igual).
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown> | undefined,
        isDragging,
      }}
      onPrincipal={onPrincipal}
      onDelete={onDelete}
      busy={busy}
    />
  );
}

export default function ProductGalleryManager({ productoId }: { productoId: string }) {
  const [imgs, setImgs] = useState<Imagen[]>([]);
  const [maxImages, setMaxImages] = useState<number>(DEFAULT_MAX_PRODUCT_IMAGES);
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
      // Defensa: normalizar principal-primero aunque el server ya lo garantice.
      setImgs(ordenarConPrincipalPrimero(Array.isArray(j.imagenes) ? (j.imagenes as Imagen[]) : []));
      if (typeof j.max_images === "number" && j.max_images > 0) setMaxImages(j.max_images);
    } catch {
      setError("No se pudo cargar la galería.");
    } finally {
      setLoading(false);
    }
  }, [productoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const principal = imgs.find((i) => i.es_principal) ?? null;
  const secundarias = imgs.filter((i) => !principal || i.id !== principal.id);

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = secundarias.findIndex((i) => i.id === active.id);
    const newIndex = secundarias.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextSec = arrayMove(secundarias, oldIndex, newIndex);
    const nextImgs = principal ? [principal, ...nextSec] : nextSec;
    setImgs(nextImgs); // optimista, principal sigue primera
    setBusy(true);
    setError(null);
    try {
      // Orden completo (permutación exacta) con la principal siempre primera.
      const orden = nextImgs.map((i) => i.id);
      const r = await fetch(`/api/productos/${productoId}/imagenes/orden`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orden }),
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
      await load(); // la nueva principal pasa a la primera posición
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

  const canAdd = imgs.length < maxImages && !busy;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          Galería de imágenes <span className="text-gray-400">({imgs.length}/{maxImages})</span>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {principal ? (
              <Card img={principal} onPrincipal={setPrincipal} onDelete={del} busy={busy} />
            ) : null}
            <SortableContext items={secundarias.map((i) => i.id)} strategy={rectSortingStrategy}>
              {secundarias.map((img) => (
                <SortableCard key={img.id} img={img} onPrincipal={setPrincipal} onDelete={del} busy={busy} />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      )}
      <p className="mt-2 text-xs text-gray-400">
        La principal queda fija en primer lugar. Arrastrá las secundarias para reordenar. JPG, PNG o WebP · máx. 5 MB por imagen.
      </p>
    </div>
  );
}
