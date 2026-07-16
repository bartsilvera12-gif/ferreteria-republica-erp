"use client";

/**
 * Ruta de desarrollo: /dev/loader-preview
 *
 * NO disponible en producción (devuelve 404 con notFound()).
 * Permite comparar el loader anterior y el nuevo, reproducir/pausar/reiniciar
 * la animación y alternar entre escritorio y móvil.
 *
 * Importante: esta página fuerza cada variante con el mismo componente
 * `ZentraLoader` pero necesita saltarse la bandera de entorno para poder
 * mostrar AMBOS diseños. Para eso importa los dos sub-componentes internos.
 * Si preferís no exportarlos, dejá el import de `ZentraLoader` y quitá el
 * selector "Anterior/Nuevo" (mostrará solo lo que dicte la bandera).
 */

import { useState } from "react";
import { notFound } from "next/navigation";
import { FerreteriaLoader, LegacyLoader } from "@/components/ZentraLoader";

type Variant = "new" | "old";
type Device = "desktop" | "mobile";

export default function LoaderPreviewPage() {
  // Bloqueo en producción.
  if (process.env.NODE_ENV === "production") notFound();

  const [variant, setVariant] = useState<Variant>("new");
  const [device, setDevice] = useState<Device>("desktop");
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [runId, setRunId] = useState(0);

  // La bandera decide qué renderiza ZentraLoader; para previsualizar el
  // "Anterior" forzamos temporalmente la variante vía data-attribute + CSS
  // (ver bloque <style> abajo). En un entorno real basta con la bandera.
  const restart = () => setRunId((n) => n + 1);

  const frame =
    device === "desktop"
      ? { width: 960, height: 600 }
      : { width: 380, height: 760 };

  const sceneClass = `${playing ? "" : "lp-paused"} ${reduced ? "lp-reduced" : ""}`;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-6 py-4">
        <div>
          <p className="text-sm font-bold text-slate-50">/dev/loader-preview</p>
          <p className="text-xs text-slate-500">
            Zentra · Ferretería República — vista previa de desarrollo
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={variant}
            onChange={(v) => setVariant(v as Variant)}
            options={[
              ["new", "Nuevo loader"],
              ["old", "Anterior"],
            ]}
          />
          <Segmented
            value={device}
            onChange={(v) => setDevice(v as Device)}
            options={[
              ["desktop", "Escritorio"],
              ["mobile", "Móvil"],
            ]}
          />
          <Btn onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pausar" : "Reproducir"}
          </Btn>
          <Btn onClick={restart}>Reiniciar</Btn>
          <Btn active={reduced} onClick={() => setReduced((r) => !r)}>
            Movimiento reducido
          </Btn>
        </div>
      </header>

      <main className="flex items-center justify-center p-10">
        <div
          className="overflow-hidden rounded-2xl border border-slate-800 shadow-2xl"
          style={{ width: frame.width, maxWidth: "100%" }}
        >
          <div
            key={`${variant}-${device}-${runId}`}
            className={`lp-stage lp-${variant} ${sceneClass}`}
            style={{ height: frame.height }}
          >
            {variant === "new" ? (
              <FerreteriaLoader fullscreen={false} overlay={false} label="Cargando" />
            ) : (
              <LegacyLoader fullscreen={false} overlay={false} label="Cargando" />
            )}
          </div>
        </div>
      </main>

      <style jsx global>{`
        .lp-stage {
          position: relative;
        }
        .lp-stage > div {
          position: absolute;
          inset: 0;
          min-height: 0 !important;
        }
        /* Pausa / movimiento reducido solo dentro del preview */
        .lp-paused * {
          animation-play-state: paused !important;
        }
        .lp-reduced * {
          animation: none !important;
        }
      `}</style>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex rounded-lg border border-slate-800 bg-slate-800/40 p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
            value === val
              ? "bg-[#4FAEB2] text-[#04211f]"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Btn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
        active
          ? "border-[#4FAEB2] bg-[#4FAEB2] text-[#04211f]"
          : "border-slate-800 bg-slate-800/40 text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
