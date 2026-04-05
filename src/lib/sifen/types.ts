/**
 * Tipos para el módulo SIFEN (configuración y documentos electrónicos).
 */

export type AmbienteSifen = "test" | "produccion";

/**
 * Configuración SIFEN expuesta por la API (sin contraseña ni ciphertext).
 * `has_certificado_password`: hay secreto cifrado persistido para el .p12.
 */
export interface EmpresaSifenConfigDTO {
  id: string;
  empresa_id: string;
  ambiente: AmbienteSifen;
  ruc: string;
  razon_social: string;
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
  csc: string | null;
  certificado_path: string | null;
  certificado_vencimiento: string | null;
  activo: boolean;
  has_certificado_password: boolean;
  created_at: string;
  updated_at: string;
}

/** Body POST /api/configuracion/sifen */
export interface EmpresaSifenConfigCreateBody {
  ruc: string;
  razon_social: string;
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
  ambiente: AmbienteSifen;
  csc?: string | null;
  certificado_path?: string | null;
  certificado_password?: string | null;
  certificado_vencimiento?: string | null;
  activo?: boolean;
}

/** Body PATCH /api/configuracion/sifen (campos parciales). */
export interface EmpresaSifenConfigPatchBody {
  ruc?: string;
  razon_social?: string;
  timbrado_numero?: string;
  establecimiento?: string;
  punto_expedicion?: string;
  ambiente?: AmbienteSifen;
  csc?: string | null;
  certificado_path?: string | null;
  certificado_password?: string | null;
  certificado_vencimiento?: string | null;
  activo?: boolean;
}

export type EmpresaSifenConfigCreateResult =
  | { ok: true; data: EmpresaSifenConfigCreateBody }
  | { ok: false; error: string };

/** Actualización de contraseña del certificado en PATCH (sin persistir en claro). */
export type SifenCertificadoPasswordPatchAction =
  | { kind: "omit" }
  | { kind: "clear" }
  | { kind: "set"; value: string };

export type EmpresaSifenConfigPatchResult =
  | { ok: true; patch: Record<string, unknown>; password: SifenCertificadoPasswordPatchAction }
  | { ok: false; error: string };

/** Estados del documento electrónico (public.factura_electronica). */
export type EstadoSifen =
  | "borrador"
  | "generado"
  | "firmado"
  | "enviado"
  | "aprobado"
  | "rechazado"
  | "error_envio";

/** Fila persistida en `sifen_ultima_respuesta_consulta_lote` (jsonb). */
export interface SifenConsultaLoteDetallePersistido {
  cdc: string;
  dEstRes: string;
  dProtAut: string | null;
  grupoRes: { dCodRes: string; dMsgRes: string }[];
}

export interface SifenConsultaLoteUltimaPersistida {
  consultadoEn: string;
  dProtConsLote: string;
  dFecProc: string | null;
  dCodResLot: string | null;
  dMsgResLot: string | null;
  httpStatus: number;
  soapFault: boolean;
  faultString: string | null;
  /** true si la respuesta no es fault pero no vino ningún `gResProcLote` (suele indicar lote aún en cola). */
  loteSinDetalleCdc: boolean;
  detallePorCdc: SifenConsultaLoteDetallePersistido[];
}

/** Fila de public.factura_electronica (respuesta API). */
export interface FacturaElectronicaDTO {
  id: string;
  empresa_id: string;
  factura_id: string;
  estado_sifen: EstadoSifen;
  cdc: string | null;
  xml_path: string | null;
  xml_firmado_path: string | null;
  kuDE_url: string | null;
  qr_data: string | null;
  error: string | null;
  /** dProtConsLote (SET) tras envío exitoso a recibe-lote (0300). */
  sifen_d_prot_cons_lote: string | null;
  /** Última respuesta recibe-lote (parseada + cuerpo SOAP). */
  sifen_ultima_respuesta_recibe_lote: Record<string, unknown> | null;
  /** Última respuesta consulta-lote TEST (dCodResLot, detalle por CDC). */
  sifen_ultima_respuesta_consulta_lote: SifenConsultaLoteUltimaPersistida | null;
  created_at: string;
  updated_at: string;
}

/** Detalle JSON del evento de generación de borrador vía API. */
export interface SifenBorradorGeneracionDetalle {
  origen: "api_borrador";
  factura_id: string;
}

/** Detalle JSON del evento al construir el payload base vía API. */
export interface SifenApiPayloadGeneracionDetalle {
  origen: "api_payload";
  factura_id: string;
}

/** Detalle JSON del evento al generar XML vía API. */
export interface SifenApiXmlGeneracionDetalle {
  origen: "api_xml";
  factura_id: string;
  xml_path: string;
}

/** Payload base JSON para armar el DE SIFEN (sin XML). */
export interface SifenPayloadEmisor {
  ruc: string;
  razon_social: string;
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
  /** Código de seguridad del timbrado (SET); obligatorio para generar el DE oficial. */
  csc: string | null;
}

export interface SifenPayloadDocumento {
  factura_id: string;
  numero_factura: string;
  fecha: string;
  tipo: string;
  moneda: string;
  monto: number;
  saldo: number;
}

export interface SifenPayloadReceptor {
  cliente_id: string;
  nombre: string;
  documento: string | null;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export interface SifenPayloadItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva: number;
  total: number;
}

export interface SifenPayloadMeta {
  factura_electronica_id: string;
  estado_sifen: EstadoSifen;
}

/** Respuesta de GET /api/facturas/[id]/sifen/payload */
export interface SifenFacturaPayloadBase {
  emisor: SifenPayloadEmisor;
  documento: SifenPayloadDocumento;
  receptor: SifenPayloadReceptor;
  items: SifenPayloadItem[];
  sifen: SifenPayloadMeta;
}

// ─── Documento interno previo a XML (mapPayloadBaseToSifenDocumento; no es el GET API) ─

/** Cabecera de identificación del DE (campos ERP + vínculo electrónico). */
export interface SifenDocumentoIdentificacion {
  factura_id: string;
  numero_factura: string;
  fecha_emision: string;
  moneda: string;
  tipo_documento_erp: string;
  saldo_factura_erp: number;
  factura_electronica_id: string;
  estado_sifen: EstadoSifen;
}

/** Emisor en forma cercana al DE (misma base que payload; nombres listos para XML). */
export interface SifenDocumentoEmisor {
  ruc: string;
  razon_social: string;
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
}

/** Receptor para el DE (sin códigos SET hasta definirlos). */
export interface SifenDocumentoReceptor {
  cliente_id: string;
  razon_social_o_nombre: string;
  ruc: string | null;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

/** Totales agregados para el DE (derivados de líneas + cabecera ERP). */
export interface SifenDocumentoTotales {
  total_general: number;
  total_iva: number;
  subtotal_items: number;
  monto_total_erp: number;
  saldo_erp: number;
}

/**
 * Línea de ítem preparada para el DE.
 * Campos SET (códigos, afectación) reservados en null hasta mapearlos al manual.
 */
export interface SifenDocumentoItemLinea {
  nro_linea: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva: number;
  total_linea: number;
  codigo_producto: null;
  codigo_unidad_medida: null;
  afectacion_iva: null;
}

/**
 * Placeholder explícito para CDC, firma, QR y XML (fases posteriores).
 */
export interface SifenDocumentoExtensionFutura {
  cdc: string | null;
  firma: string | null;
  qr: string | null;
  xml: string | null;
}

/** Estructura interna lista para serializar a XML SIFEN más adelante. */
export interface SifenDocumentoPreparado {
  identificacion: SifenDocumentoIdentificacion;
  emisor: SifenDocumentoEmisor;
  receptor: SifenDocumentoReceptor;
  totales: SifenDocumentoTotales;
  items: SifenDocumentoItemLinea[];
  extension_futura: SifenDocumentoExtensionFutura;
}

/** Respuesta de POST /api/facturas/[id]/sifen/xml */
export interface SifenXmlGeneracionResponseData {
  factura_electronica: FacturaElectronicaDTO;
  /** Ruta del objeto dentro del bucket `storage_bucket`. */
  xml_path: string;
  storage_bucket: string;
  /** Solo si se solicita explícitamente (p. ej. ?debug=1). */
  xml?: string;
}

/** Detalle del evento de firma XML. */
export interface SifenApiFirmarDetalle {
  origen: "api_firmar";
  factura_id: string;
  xml_firmado_path: string;
}

/** Respuesta de POST /api/facturas/[id]/sifen/firmar */
export interface SifenFirmarResponseData {
  factura_electronica: FacturaElectronicaDTO;
  xml_path: string | null;
  xml_firmado_path: string;
  storage_bucket: string;
  /** Solo con ?debug=1 */
  xml_firmado?: string;
}

/** Detalle del evento POST enviar-test (recibe-lote). */
export interface SifenApiEnviarTestDetalle {
  origen: "api_enviar_test";
  factura_id: string;
  xml_firmado_path: string;
  dCodRes: string | null;
  dMsgRes: string | null;
  dProtConsLote: string | null;
  httpStatus: number;
  loteRecibido: boolean;
  loteNoEncolado: boolean;
}

/** Respuesta de POST /api/facturas/[id]/sifen/enviar-test */
export interface SifenEnviarTestResponseData {
  factura_electronica: FacturaElectronicaDTO;
  storage_bucket: string;
  /** Eco de la respuesta SET (también persistida en factura_electronica / evento). */
  recibe_lote: {
    dCodRes: string | null;
    dMsgRes: string | null;
    dProtConsLote: string | null;
    dFecProc: string | null;
    dTpoProces: number | null;
    httpStatus: number;
    loteRecibido: boolean;
    loteNoEncolado: boolean;
  };
  /** Solo con ?debug=1 */
  cuerpo_soap?: string;
}

/** Detalle del evento POST consulta-lote-test. */
export interface SifenApiConsultaLoteTestDetalle {
  origen: "api_consulta_lote_test";
  factura_id: string;
  dProtConsLote: string;
  dCodResLot: string | null;
  dMsgResLot: string | null;
  httpStatus: number;
  soapFault: boolean;
  estado_sifen_anterior: string;
  estado_sifen_nuevo: string;
}

/** Respuesta de POST /api/facturas/[id]/sifen/consulta-lote-test */
export interface SifenConsultaLoteTestResponseData {
  factura_electronica: FacturaElectronicaDTO;
  consulta_lote: {
    dFecProc: string | null;
    dCodResLot: string | null;
    dMsgResLot: string | null;
    httpStatus: number;
    soapFault: boolean;
    faultString: string | null;
    detallePorCdc: SifenConsultaLoteDetallePersistido[];
    loteSinDetalleCdc: boolean;
    /** true si sigue en cola / sin resultado por DE (típico mientras `enviado`). */
    loteEnProcesamiento: boolean;
    /** Si se actualizó `estado_sifen` desde `enviado` a aprobado/rechazado. */
    estadoActualizado: boolean;
    resumenInferido: string | null;
  };
  /** Solo con ?debug=1 */
  cuerpo_soap?: string;
}
