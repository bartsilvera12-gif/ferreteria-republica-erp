"use client";

import Image from "next/image";

/**
 * Pantalla de carga Zentra — Ferretería República: caja de herramientas animada
 * (SVG + CSS, bucle de 1400 ms, sin librerías).
 *
 * API pública: `label`, `fullscreen`, `overlay`. Mantiene `role="status"`,
 * `aria-busy="true"`, texto para lectores de pantalla y `prefers-reduced-motion`.
 *
 * No modifica AuthGuard, BootContext ni Sidebar. No usa setTimeout: aparece
 * mientras el ERP no esté listo y desaparece cuando el consumidor lo desmonta.
 */

type LoaderProps = {
  label?: string;
  /** Si es true, ocupa min-h-screen. Si es false, se acomoda al contenedor. */
  fullscreen?: boolean;
  /** Si es true, queda como overlay fixed cubriendo toda la pantalla (z-200). */
  overlay?: boolean;
};

export default function ZentraLoader(props: LoaderProps) {
  return <FerreteriaLoader {...props} />;
}

/* -------------------------------------------------------------------------- */
/*  Wrapper compartido (posición / fullscreen / overlay / accesibilidad)      */
/* -------------------------------------------------------------------------- */

function LoaderFrame({
  label = "Cargando",
  fullscreen = true,
  overlay = false,
  children,
  background,
}: LoaderProps & { children: React.ReactNode; background: string }) {
  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden ${
        overlay
          ? "fixed inset-0 z-[200] h-screen w-screen"
          : "w-full"
      } ${fullscreen && !overlay ? "min-h-screen" : ""} ${
        !fullscreen && !overlay ? "min-h-[40vh] py-16" : ""
      }`}
      style={{ background }}
      aria-busy="true"
      role="status"
    >
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  NUEVO — Ferretería (caja de herramientas)                                 */
/* -------------------------------------------------------------------------- */

export function FerreteriaLoader(props: LoaderProps) {
  return (
    <LoaderFrame
      {...props}
      background="radial-gradient(ellipse 90% 60% at 50% 28%, rgba(255,255,255,.10), transparent 55%), linear-gradient(168deg,#5CB8BC 0%,#4FAEB2 45%,#3E8C90 100%)"
    >
      <div className="ferro-stack relative z-10 flex flex-col items-center">
        <Image
          src="/brand/zentra-logo-official.png"
          alt="ZENTRA"
          width={480}
          height={264}
          priority
          className="ferro-logo h-auto w-full object-contain object-center"
        />

        <svg
          className="ferro-svg"
          viewBox="0 0 280 250"
          style={{ display: "block", overflow: "visible" }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ferroChromeV" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.5" stopColor="#eaf5f5" />
              <stop offset="1" stopColor="#c2dada" />
            </linearGradient>
            <linearGradient id="ferroChromeH" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#b6d2d2" />
              <stop offset="0.22" stopColor="#ffffff" />
              <stop offset="0.5" stopColor="#e6f2f2" />
              <stop offset="0.74" stopColor="#c7dede" />
              <stop offset="1" stopColor="#9fc2c2" />
            </linearGradient>
            <linearGradient id="ferroTealGrip" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#2c6d70" />
              <stop offset="0.28" stopColor="#59b5b9" />
              <stop offset="0.6" stopColor="#4FAEB2" />
              <stop offset="1" stopColor="#265f62" />
            </linearGradient>
            <linearGradient id="ferroBoxBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.42" stopColor="#eef7f7" />
              <stop offset="1" stopColor="#cfe4e4" />
            </linearGradient>
            <linearGradient id="ferroBoxLid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#dceaea" />
            </linearGradient>
            <linearGradient id="ferroBoxDark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#134a4d" />
              <stop offset="1" stopColor="#0b3a3d" />
            </linearGradient>
            <radialGradient id="ferroSpec" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <filter id="ferroDs" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#0b3a3d" floodOpacity="0.34" />
            </filter>
          </defs>

          {/* sombra de apoyo */}
          <ellipse cx="140" cy="236" rx="99" ry="10" fill="#0b3a3d" opacity="0.16" />
          <ellipse cx="140" cy="235" rx="78" ry="7" fill="#0b3a3d" opacity="0.16" />

          {/* abertura interna (detrás de las herramientas) */}
          <rect x="54" y="140" width="172" height="28" rx="11" fill="url(#ferroBoxDark)" />
          <rect x="60" y="143" width="160" height="9" rx="4.5" fill="#000000" opacity="0.22" />

          {/* asa metálica detrás de las herramientas */}
          <path d="M110 150 L110 128 Q110 112 126 112 L154 112 Q170 112 170 128 L170 150" fill="none" stroke="url(#ferroChromeH)" strokeWidth="8" strokeLinecap="round" />
          <path d="M112 150 L112 129 Q112 116 125 116 L155 116" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />

          {/* Llave combinada (izquierda) */}
          <g transform="translate(88 150) rotate(-27)">
            <g className="tb-wrench" filter="url(#ferroDs)">
              <circle cx="0" cy="58" r="14" fill="url(#ferroChromeH)" />
              <circle cx="0" cy="58" r="13" fill="none" stroke="#9fc2c2" strokeWidth="1" opacity="0.7" />
              <circle cx="0" cy="58" r="6.5" fill="url(#ferroBoxDark)" />
              <path d="M-6 -6 C-7 8 -7 40 -5.5 52 L5.5 52 C7 40 7 8 6 -6 Z" fill="url(#ferroChromeH)" />
              <path d="M-14.5 -40 L-14.5 -18 Q-14.5 -11 -8 -11 L8 -11 Q14.5 -11 14.5 -18 L14.5 -40 L5.5 -40 L5.5 -25 L-5.5 -25 L-5.5 -40 Z" fill="url(#ferroChromeH)" />
              <rect x="-3.5" y="-6" width="2.4" height="54" rx="1.2" fill="#ffffff" opacity="0.6" />
            </g>
          </g>

          {/* Destornillador de punta plana (derecha) */}
          <g transform="translate(196 150) rotate(23)">
            <g className="tb-driver" filter="url(#ferroDs)">
              <path d="M-12 12 C-12 4 12 4 12 12 L11 52 C11 62 -11 62 -11 52 Z" fill="url(#ferroTealGrip)" />
              <rect x="-9.5" y="10" width="4" height="46" rx="2" fill="#ffffff" opacity="0.22" />
              <rect x="5.5" y="12" width="3" height="42" rx="1.5" fill="#0b3a3d" opacity="0.18" />
              <rect x="-1.5" y="12" width="3" height="44" rx="1.5" fill="#0b3a3d" opacity="0.1" />
              <rect x="-6" y="-2" width="12" height="16" rx="2.5" fill="url(#ferroChromeH)" />
              <rect x="-3.4" y="-44" width="6.8" height="44" rx="3.4" fill="url(#ferroChromeH)" />
              <rect x="-1.8" y="-42" width="2" height="40" rx="1" fill="#ffffff" opacity="0.6" />
              <path d="M-6 -44 L6 -44 L4 -60 L-4 -60 Z" fill="url(#ferroChromeH)" />
              <path d="M0 -44 L6 -44 L4 -60 L0 -60 Z" fill="#9fc2c2" opacity="0.5" />
              <rect x="-4.6" y="-61" width="9.2" height="2.6" rx="1.3" fill="#8fb6b6" />
            </g>
          </g>

          {/* Martillo de uña (centro) */}
          <g className="tb-hammer" filter="url(#ferroDs)">
            <path d="M134.5 120 L145.5 120 L144.3 172 C144.3 177 135.7 177 135.7 172 Z" fill="url(#ferroTealGrip)" />
            <rect x="135.6" y="128" width="8.8" height="2.4" rx="1.2" fill="#0b3a3d" opacity="0.28" />
            <rect x="135.6" y="136" width="8.8" height="2.4" rx="1.2" fill="#0b3a3d" opacity="0.28" />
            <rect x="135.6" y="144" width="8.8" height="2.4" rx="1.2" fill="#0b3a3d" opacity="0.28" />
            <rect x="136" y="66" width="8" height="56" rx="4" fill="url(#ferroChromeH)" />
            <rect x="137.6" y="68" width="2.2" height="52" rx="1.1" fill="#ffffff" opacity="0.6" />
            <path d="M139 49 C119 45 102 51 95 66 C99 69 103 70 107 70 C112 61 124 59 137 63 Z" fill="url(#ferroChromeH)" />
            <path d="M101 63 C104 66 107 67 110 67" fill="none" stroke="#9fc2c2" strokeWidth="1.4" opacity="0.5" strokeLinecap="round" />
            <path d="M135 48 L155 46 L155 70 L135 68 Z" fill="url(#ferroChromeH)" />
            <rect x="152" y="44" width="24" height="28" rx="7" fill="url(#ferroChromeH)" />
            <rect x="171.5" y="47" width="4" height="22" rx="2" fill="#9fc2c2" opacity="0.55" />
            <rect x="155" y="48" width="13" height="4.5" rx="2.2" fill="#ffffff" opacity="0.6" />
            <circle cx="149" cy="57" r="2.4" fill="url(#ferroSpec)" />
          </g>

          {/* frente de la caja (tapa la base de las herramientas) */}
          <rect x="44" y="156" width="192" height="20" rx="9" fill="url(#ferroBoxLid)" />
          <rect x="46" y="158" width="188" height="3" rx="1.5" fill="#ffffff" opacity="0.75" />
          <rect x="50" y="172" width="180" height="58" rx="15" fill="url(#ferroBoxBody)" />
          <rect x="50" y="172" width="180" height="12" rx="12" fill="#ffffff" opacity="0.45" />
          <rect x="66" y="227" width="28" height="9" rx="3.5" fill="#0b3a3d" opacity="0.28" />
          <rect x="186" y="227" width="28" height="9" rx="3.5" fill="#0b3a3d" opacity="0.28" />
          <g>
            <rect x="58" y="182" width="20" height="26" rx="5" fill="url(#ferroTealGrip)" />
            <rect x="61" y="185" width="14" height="4" rx="2" fill="#ffffff" opacity="0.4" />
            <rect x="63" y="204" width="10" height="4" rx="2" fill="#0b3a3d" opacity="0.25" />
          </g>
          <g>
            <rect x="202" y="182" width="20" height="26" rx="5" fill="url(#ferroTealGrip)" />
            <rect x="205" y="185" width="14" height="4" rx="2" fill="#ffffff" opacity="0.4" />
            <rect x="207" y="204" width="10" height="4" rx="2" fill="#0b3a3d" opacity="0.25" />
          </g>
          <rect x="96" y="198" width="88" height="2" rx="1" fill="#0b3a3d" opacity="0.07" />
        </svg>

        {/* barra de carga */}
        <div className="ferro-bar" aria-hidden="true">
          <div className="tb-seg" />
        </div>
      </div>

      <style jsx>{`
        .ferro-stack {
          gap: 40px;
        }
        .ferro-logo {
          width: 236px;
          filter: drop-shadow(0 10px 26px rgba(0, 0, 0, 0.22));
          user-select: none;
        }
        .ferro-svg {
          width: 288px;
          height: 257px;
        }
        .ferro-bar {
          width: 244px;
          height: 4px;
          border-radius: 99px;
          background: rgba(255, 255, 255, 0.2);
          overflow: hidden;
        }
        .ferro-bar :global(.tb-seg) {
          width: 38%;
          height: 100%;
          border-radius: 99px;
          background: linear-gradient(90deg, rgba(255, 255, 255, 0), #ffffff 55%, rgba(255, 255, 255, 0));
          animation: ferroBar 1400ms cubic-bezier(0.65, 0, 0.35, 1) infinite both;
        }

        .ferro-svg :global(.tb-hammer) {
          animation: ferroHammer 1400ms cubic-bezier(0.45, 0, 0.2, 1) infinite both;
          transform-box: fill-box;
          transform-origin: 50% 100%;
        }
        .ferro-svg :global(.tb-wrench) {
          animation: ferroWrench 1400ms cubic-bezier(0.45, 0, 0.2, 1) infinite both;
          transform-box: fill-box;
          transform-origin: 50% 92%;
        }
        .ferro-svg :global(.tb-driver) {
          animation: ferroDriver 1400ms cubic-bezier(0.45, 0, 0.2, 1) infinite both;
          transform-box: fill-box;
          transform-origin: 50% 100%;
        }

        @keyframes ferroHammer {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          32% { transform: translateY(-9px) rotate(-3deg); }
          64% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes ferroWrench {
          0%, 100% { transform: rotate(0deg); }
          36% { transform: rotate(-13deg); }
          68% { transform: rotate(0deg); }
        }
        @keyframes ferroDriver {
          0%, 100% { transform: translateY(0); }
          40% { transform: translateY(-7px); }
          74% { transform: translateY(0); }
        }
        @keyframes ferroBar {
          0% { transform: translateX(-105%); }
          100% { transform: translateX(320%); }
        }

        @media (max-width: 640px) {
          .ferro-stack { gap: 30px; }
          .ferro-logo { width: 176px; }
          .ferro-svg { width: 232px; height: 207px; }
          .ferro-bar { width: 188px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ferro-svg :global(.tb-hammer),
          .ferro-svg :global(.tb-wrench),
          .ferro-svg :global(.tb-driver),
          .ferro-bar :global(.tb-seg) {
            animation: none !important;
            transform: none !important;
          }
          .ferro-bar :global(.tb-seg) { width: 55%; }
        }
      `}</style>
    </LoaderFrame>
  );
}
