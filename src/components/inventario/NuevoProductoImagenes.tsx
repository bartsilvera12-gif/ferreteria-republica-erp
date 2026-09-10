"use client";

/**
 * Selector de imágenes para el formulario NUEVO producto.
 * Mantiene los File en memoria (no sube nada hasta tener producto_id). El form
 * los sube tras crear el producto. Primera imagen = principal por defecto.
 */
import { useEffect, useState } from "react";
import { DEFAULT_MAX_PRODUCT_IMAGES } from "@/lib/inventario/galeria-config";

// Tope VISUAL para la selección previa a crear el producto (aún no hay
// producto_id ni max del backend). Usa el DEFAULT compartido, no un número
// suelto. Tras crear el producto, la galería de edición usa el max real del env.
const MAX = DEFAULT_MAX_PRODUCT_IMAGES;
const OK_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export default function NuevoProductoImagenes({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const add = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX) {
        setError(`Máximo ${MAX} imágenes.`);
        break;
      }
      if (!OK_MIME.includes(f.type)) {
        setError("Formato no permitido. Usá JPG, PNG o WebP.");
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError("Alguna imagen supera los 5 MB.");
        continue;
      }
      next.push(f);
    }
    onChange(next);
  };

  const remove = (i: number) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {previews.map((url, i) => (
          <div key={i} className="relative rounded-xl border border-gray-200 bg-white p-1.5">
            {i === 0 ? (
              <span className="absolute left-2.5 top-2.5 rounded-full bg-[#E97932] px-2 py-0.5 text-[10px] font-bold text-white">
                PRINCIPAL
              </span>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="aspect-square w-full rounded-lg object-cover" />
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(i)}
              className="mt-1 w-full rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              Quitar
            </button>
          </div>
        ))}
        {files.length < MAX ? (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50">
            <span className="text-2xl">+</span>
            Agregar
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              disabled={disabled}
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Hasta {MAX} imágenes · JPG, PNG o WebP · máx. 5 MB. La primera es la principal.
      </p>
    </div>
  );
}
