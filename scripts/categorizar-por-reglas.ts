/**
 * Asigna categoría por reglas de palabra clave a los productos que quedaron
 * sin categoría. Complementa a `asignar-categorias-faltantes.ts` (estadístico):
 * acá el criterio es explícito y auditable, pensado para los casos que el
 * clasificador dejó pasar por ambigüedad.
 *
 *   npx tsx scripts/categorizar-por-reglas.ts             # DRY-RUN
 *   npx tsx scripts/categorizar-por-reglas.ts --apply
 *   npx tsx scripts/categorizar-por-reglas.ts --rollback <archivo.json>
 *
 * Las reglas se evalúan EN ORDEN: la primera que matchea gana. Por eso van
 * primero las específicas ("LLAVE DE PASO" -> grifería) y después las
 * genéricas ("LLAVE" -> herramienta).
 */
import * as fs from "fs";
import { Pool } from "pg";

const SCHEMA = `"ferreteriarepublica"`;

/** Categorías que no existen todavía y hacen falta. Se crean si se usan. */
const NUEVAS = ["CINTILLOS", "CINTAS ADHESIVAS", "BAZAR Y COCINA", "AIRE ACONDICIONADO",
  "REPUESTOS DE COCINA", "SERVICIOS"];

type Regla = [RegExp, string];
const REGLAS: Regla[] = [
  // ── Iluminación ────────────────────────────────────────────────────────
  [/\b(REFLECTOR|PROYECTOR|ALUMBRADO|VELADOR|PLAFON|TORTUGA|SUPERLED|OURLUX)\b/, "ILUMINACIÓN"],
  [/\b(LAMPARA|LUMINARIA|ARTEFACTO|COLGANTE ALUMINIO|PANTALLA ALUMINIO)\b/, "ILUMINACIÓN"],
  [/\b(LINTERNA|FOCO|CARTEL LED|LUZ DE EMERGENCIA|LUZ DECORATIVA|PICO LUZ)\b/, "ILUMINACIÓN"],
  [/\b(PANEL|BARRA|TIRA|PORTATIL)\b.*\bLED\b|\bLED\b.*\b(PANEL|EMBUTIR|ADOSAR)\b/, "ILUMINACIÓN"],
  [/\bPORTA ?FOCO\b|\bDRIVER\b.*LED|\bLED\b.*DRIVER/, "ILUMINACIÓN"],

  // ── Electricidad ───────────────────────────────────────────────────────
  [/\bCINTILLO/, "CINTILLOS"],
  [/\b(CAPACITOR|INTERRUPTOR|TIMBRE|BUSCAPOLO|DISYUNTOR|CONTACTOR)\b/, "Electricidad"],
  [/\b(PRENSA CABLE|CAJA DE (CONEXION|PASO)|NICHO|TABLERO|CANALETA)\b/, "Electricidad"],
  // "CONEXION FLEXIBLE ... CORRUGADO" es plomería: va antes que la regla de conduit.
  [/\bCONEXION (CROMADA|FLEXIBLE)\b/, "PLOMERIA ACCESORIOS"],
  [/\bCONDUIT\b|\bCANO CORRUGADO\b|\bFICHA\b|\bTOMACORRIENTE\b|\bENCHUFE\b/, "Electricidad"],
  [/\b(BOYA ELECTRICA|FUENTE (DE )?ALIMENTACION|TERMINAL|PROLONGADOR)\b/, "Electricidad"],
  [/\bLLAVE (TERMICA|TM|DE LUZ|CONMUTADOR)\b/, "Electricidad"],
  [/\bCABLE\b/, "CABLES"],

  // ── Electrónica ────────────────────────────────────────────────────────
  [/\b(AURICULAR|CARGADOR|MEMORIA|CAMARA|PARLANTE|CABEZA PARA CARGADOR)\b/, "ELECTRONICA"],
  [/\b(MULTITESTER|MULTIMETRO|TESTER|CALCULADORA|BALANZA|ROMANA)\b/, "ELECTRONICA"],
  [/\bCONTROL (UNIVERSAL|COPIADOR|REMOTO)\b/, "ELECTRONICA"],

  // ── Aire acondicionado / refrigeración ─────────────────────────────────
  [/\bAIRE ACONDICIONADO\b|\bFORRO AISLANTE PARA CANO\b|\bFILTRO SECADOR\b/, "AIRE ACONDICIONADO"],

  // ── Aparatos eléctricos / bazar ────────────────────────────────────────
  [/\b(HERVIDORA|ESTUFA|CALEFACTOR|PLACA COCINA|COCINA PORTATIL|ENCENDEDOR DE PARRILLA)\b/, "APARATOS ELECTRICOS"],
  [/\b(EXTRACTOR DE AIRE|ASPIRADORA|DISPENSADOR DE AGUA|MAQUINA P\/ AROMATIZADOR)\b/, "APARATOS ELECTRICOS"],
  [/\b(TERMO|JARRA|GARRAFITA|MOLINO|PROTECTOR DE HORNALLAS|EMBUDO|BALDE|PARAGUA)\b/, "BAZAR Y COCINA"],
  [/\b(CUCHILLO|CUBIERTO)\b/, "CUBIERTOS"],

  // ── Seguridad ──────────────────────────────────────────────────────────
  [/\b(GUANTE|GUANTES|CASCO|LENTE|MASCARA|ARNES|CABO DE VIDA|BOTIQUIN)\b/, "SEGURIDAD INDUSTRIAL"],
  [/\bPROTECTOR DE (RODILLAS|OIDO)\b|\bBOTIN\b|\bCHALECO\b/, "SEGURIDAD INDUSTRIAL"],

  // ── Grifería / sanitarios / plomería ───────────────────────────────────
  [/\b(CANILLA|GRIFO|MEZCLADOR MONOCOMANDO|VASTAGO)\b/, "GRIFERÍA"],
  [/\bLLAVE DE (PASO|PICO|JARDIN)\b|\bLLAVE ESFERICA\b/, "GRIFERÍA"],
  [/\bDUCHA ELECTRICA\b/, "DUCHAS ELECTRICAS"],
  [/\b(DUCHA|REGADERA|BRAZO DE DUCHA)\b/, "GRIFERÍA"],
  [/\b(LAVATORIO|INODORO|BIDET|MOCHILA SANITARIA|MECANISMO)\b/, "SANITARIOS"],
  [/\bPILETA\b/, "PILETAS"],
  [/\b(SIFON|SOPAPA|VALVULA|FLOTADOR|REJILLA|DESTAPA CAN|JABONERA)\b/, "PLOMERIA ACCESORIOS"],
  [/\bCONEXION (CROMADA|FLEXIBLE)\b|\bANILLO DE GOMA\b/, "PLOMERIA ACCESORIOS"],
  [/\b(ALMA|BUJE)\b.*\b(PPR|FUSION)\b|\bFUSION\b/, "FUSION TUBOS Y"],
  [/\b(CODO|TEE|BUJE|UNION|CUPLA|NIPLE|ADAPTADOR)\b/, "ACCESORIOS PVC"],
  [/\bTUBO\b|\bCANO\b/, "CAÑOS PVC"],
  [/\bMANGUERA\b/, "MANGUERAS"],
  [/\bPISTOLA DE RIEGO\b|\bASPERSOR\b|\bRIEGO\b/, "RIE - ACCESORIOS DE"],

  // ── Fijaciones ─────────────────────────────────────────────────────────
  [/\b(TORNILLO|BULON|TIRAFONDO)\b/, "TORNILLOS Y BULONES"],
  [/\bPITON\b/, "PITONES ABIERTO-"],
  [/\bARANDELA\b/, "ARANDELAS LISAS Y"],
  [/\bPERNO\b/, "PERNOS"],
  [/\bTARUGO\b/, "TARUGO"],
  [/\bREMACHE/, "REMACHES"],
  [/\bCLAVO\b/, "CLAVOS"],
  [/\bABRAZADERA\b/, "ABRAZADERAS"],
  [/\bGRAMPA\b/, "GALVANIZADOS"],

  // ── Herrajes / cerrajería ──────────────────────────────────────────────
  [/\b(CERRADURA|MANIJA|CILINDRO|PASADOR|GOLPETE|LLAVIN)\b/, "CERRADURAS/MANIJAS/"],
  [/\bCANDADO\b/, "CANDADOS"],
  [/\b(BISAGRA|TIRADOR|GANCHO|REGATON|HEBILLA|GUARDACABO|MOSQUETON|PORTA CINTA)\b/, "HERRAJES"],
  [/\b(RIEL|CORREDIZA)\b.*PORTON|\bRIEL\b/, "RIEL PARA PORTON"],
  [/\bRUEDA\b/, "RUEDAS"],
  // ATLAS/DAKO/CAPRICE/SEMER son marcas de COCINA: base, tapa y conjunto son
  // piezas de quemador, no soportes. Va antes que la regla de soportes.
  [/\b(BASE|TAPA|CONJUNTO|ESPALHADOR|QUEMADOR)\b.*\b(ATLAS|DAKO|CAPRICE|SEMER|ITATIAIA|MUELLER)\b/, "REPUESTOS DE COCINA"],
  [/\bSOPORTE\b|\bANGULO\b/, "SOP - SOPORTES"],
  [/\bCADENA\b/, "CADENA POR KILO"],

  // ── Herramientas eléctricas y manuales ─────────────────────────────────
  // El carbón es repuesto: va antes que la regla de máquinas, si no "CARBON
  // P/ SOPLADORA" se clasifica como la máquina misma.
  [/\bCARBON\b/, "CARBON P/ MAQUINAS"],
  [/\b(SIERRA CALADORA|AMOLADORA|TALADRO|ATORNILLADOR|LIJADORA|SOPLADORA|HIDROLAVADORA)\b/, "MAQUINAS ELECTRICAS"],
  [/\b(COMPRESOR|HORMIGONERA|MAQUINA PARA PINTAR|SOLDADORA INVERTER)\b/, "MAQUINAS ELECTRICAS"],
  [/\b(ELECTRODO|ESTANO|SOLDADOR CAUTIN|SOPLETE)\b/, "Soldadura"],
  [/\bRESISTENCIA\b/, "RESISTENCIAS"],
  [/\bTERMOCALEFON\b/, "TERMOCALEFON"],
  [/\bMECHA\b|\bBROCA\b/, "MECHAS PARA METAL-"],
  [/\bDISCO (DE )?(CORTE|DIAMANTAD)/, "DISCOS DE CORTE"],
  [/\bDISCO SIERRA\b|\bSIERRA COPA\b/, "DISCO SIERRA"],
  [/\b(LIJA|BOINA DE LANA|TELA ESMERIL|DISCO ESPONJA|PIEDRA (DE )?AFILAR|PUNTA MONTADA)\b/, "ABRASIVOS"],
  [/\bDESTORNILLADOR\b|\b(BITS|PUNTERA|PUNTA BITS)\b/, "DESTORNILLADOR"],
  [/\bLLAVE (COMBINADA|AJUSTABLE|TUBO|INGLESA|CRIQUET|ALLEN|FRANCESA|A CADENA|STILSON|CANO)\b|\bLLCOCRGA\b/, "LLAVE"],
  [/\b(MARTILLO|TIJERA|CUTTER|NIVEL|ESPATULA|LLANA|TENAZA|MORZA|BARRETIN|ALICATE)\b/, "HERRAMIENTAS"],
  [/\b(CATRACA|REMACHADORA|LIMA|ESCOFINA|CALIBRE|AGRIMENSOR|CINTA METRICA|FLEXOMETRO)\b/, "HERRAMIENTAS"],
  [/\b(GATO|APAREJO|MANDRIL|EXTRACTOR|CORTA TUBO|CORTADOR|NAVAJA|MANOMETRO|INFLADOR)\b/, "HERRAMIENTAS"],
  [/\b(PINZA|CUCHARA ALBANIL|PALA|PICO|AZADITA|FOICE|MAZA|CINCEL|PUNZON|SERRUCHO)\b/, "HERRAMIENTAS"],
  [/\b(ARRANCADOR|MEZCLADOR DE PINTURA|APRIETA DISCO|EXTENSION FLEX)\b/, "HERRAMIENTAS"],
  [/\bMANGO\b|\bVAINA\b|\bREPUESTO\b|\bJUEGO DE HERRAMIENTAS\b/, "HERRAMIENTAS"],

  // ── Pinturas y accesorios ──────────────────────────────────────────────
  [/\bLATEX\b/, "LATEX"],
  [/\bSINTETICO\b/, "SINTETICO"],
  [/\bAEROSOL\b/, "AEROSOLES"],
  [/\b(OXIDO|ANILINA|COLORANTE|GRAFITO|BARNIZ|ESMALTE|PASTINA)\b/, "PINTURAS"],
  [/\b(PINCEL|RODILLO|BANDEJA (DE )?PINTURA)\b/, "APINT - ACCESORIOS"],
  [/\bLIQUITECH\b|\bIMPERMEABILIZANTE\b|\bGOMA LIQUIDA\b/, "IMPERMEABILIZANTES"],
  [/\bCINTA (DE PAPEL|CREPP|DOBLE|ADHESIVA|EMBALA)/, "CINTAS ADHESIVAS"],
  [/\bCINTA AISLADORA\b/, "CINTA AISLADORA"],
  [/\bPAPEL CINTA\b/, "CINTAS ADHESIVAS"],

  // ── Químicos / limpieza / jardín ───────────────────────────────────────
  [/\b(SILICONA|SELLADOR|ADHESIVO|PEGAMENTO|DESENGRIPANTE|GRASA|BETUN|FIBRA DE VIDRIO)\b/, "QUI - PRODUCTOS"],
  [/\b(MATA YUYO|GLIFOSATO|INSECTICIDA|CEBO|RAQUETA MATA|MATAMOSCAS)\b/, "INSECTICIDAS"],
  [/\b(DESINFECTANTE|DESODORANTE|DETERGENTE|LIMPIA|ESCOBA|ESCOBILLON|PANO|CEPILLO|RECOGEDOR)\b/, "Limpieza"],
  [/\b(COLLAR PARA PERRO|COMEDERO|BEBEDERO)\b/, "VETERINARIA"],
  [/\b(PALITA|RECOGEDOR DE FRUTAS|SACA HOJA|PISCINA|PERCHERA)\b/, "JARDINERIA"],

  // ── Textiles / piolas / carpas ─────────────────────────────────────────
  [/\b(ARPILLERA|CARPA|MEDIA SOMBRA|LONA|TOLDO)\b/, "CARPAS MALLAS Y"],
  [/\b(PIOLIN|HILO|CUERDA|SOGA|GOMA ELASTICA|CABO ACERO)\b/, "PIOLAS HILOS Y"],
  [/\bALAMBRE\b/, "ALAMBRES"],
  [/\bTELA METALICA\b|\bMALLA\b/, "TELA METALICA"],

  // ── Pisos / construcción ───────────────────────────────────────────────
  [/\bPISO\b|\bNIVELADOR\b|\bCUNA NIVELADORA\b|\bBALDOSA\b|\bCERAMIC/, "PISOS"],
  [/\bCAL HIDRATADA\b|\bCEMENTO\b|\bARENA\b/, "Construccion"],
  [/\bESCALERA\b/, "ESCALERAS"],
  [/\bAISLAPOL\b|\bTELA BIDIM\b/, "MATERIALES DE"],

  // ── Librería ───────────────────────────────────────────────────────────
  [/\b(BOLIGRAFO|LAPIZ|CORRECTOR|PAPEL DE REGALO|ETIQUETA|MARCADOR|RESALTADOR|TIZA)\b/, "ARTICULOS DE LIBRERIA"],

  // ── Auto / moto / bici ─────────────────────────────────────────────────
  [/\b(PARCHE|FILTRO COMBUSTIBLE|BOMBILLA|CAMARA DE AIRE)\b/, "AUTO REPUESTOS"],
  [/\bPILA\b|\bBATERIA\b/, "PILAS"],

  // ── 2ª tanda: casos que no cayeron en las reglas de arriba ─────────────
  // "CINTA LED" es iluminación: va antes que cualquier regla genérica de CINTA.
  [/\b(FOTOCELULA|FLUORESCENTE|FAROL|CINTA LED|COLGANTE INDUSTRIAL)\b/, "ILUMINACIÓN"],
  [/\bCINTA (ELECTRICA|AUTOSOLDABLE|TERMOCONTRAIBLE)\b/, "CINTA AISLADORA"],
  [/\bCINTA\b|\bFILM STRECH\b|\bBOBINA PAPEL\b/, "CINTAS ADHESIVAS"],
  [/\b(CIPERTEX|GLACOXAN|HORMITEX|CUPIFINA|INSECTIFIN|AHUYENTA|CUPINICIDA)\b/, "INSECTICIDAS"],
  [/\b(FRANELA|ESPONJA|BASURERO|ATOMIZADOR|TRAPO)\b|\bKIT LIMPIEZA\b/, "Limpieza"],
  [/\b(THINNER|AGUARRAS|DILUYENTE|ACRILICO|AMALUX|FONDO ANTIOXIDO|CAUCHO GOMA)\b/, "PINTURAS"],
  [/\b(BROCHA|FRATACHO|BANDEJA|LINEA MARCACION)\b|\bPISTOLA (P\/ |PARA )?PINTAR\b/, "APINT - ACCESORIOS"],
  [/\b(DISCO FLAP|DISCO STRIP|DISCO VELCRO|BOINA|GORRO)\b|\bPULIDORA\b|\bCERA PROTECTORA\b/, "ABRASIVOS"],
  [/\b(ANTENA|CAPACIMETRO|TRANSMISOR|DETECTOR DE VOLTAJE|AUTOTRANSFORMADOR)\b/, "ELECTRONICA"],
  [/\b(JABALINA|ELECTRIFICADOR|CLIPES NIQUELADOS)\b/, "Electricidad"],
  [/\b(CARETA (DIGITAL )?PARA SOLDAR|GAS PARA SOLDAR|GAS P\/ SOLDAR)\b/, "Soldadura"],
  [/\b(CABALLETE|CORTAPLUMA|CLAVADORA|GRAPADORA|ENGRAPADORA|GRAMPEADORA|CEPILLADORA)\b/, "HERRAMIENTAS"],
  [/\b(CONTADOR MANUAL|CALIBRADOR|CORTA VIDRIO|CORTASETO|ENGRASADOR|HOJA SIERRA|FORMON)\b/, "HERRAMIENTAS"],
  [/\bJUEGO (DE )?(LLAVES|DESTORNILLADORES)\b|\bCINTURON P\/ HERRAMIENTAS\b|\bKIT MALETIN\b/, "HERRAMIENTAS"],
  [/\bLLAVE (CRUZ|ESMERIL)\b/, "LLAVE"],
  [/\bLLAVE EXCLUSA\b|\bCOLLAR TOMADA\b|\bGLOBO NEUMATICO\b|\bDRENAJE\b/, "PLOMERIA ACCESORIOS"],
  [/\bANILLO (DE )?(SEGURIDAD|VEDACION)\b|\bALMA (DOBLE|REDUCCION)\b/, "ACCESORIOS PVC"],
  [/\b(ACOPLE|CONECTOR|CONEXION)\b/, "ACCESORIOS"],
  [/\b(AGARRADERA PARA BANO|BARRA PORTA TOALLA|PORTA PAPEL)\b/, "JUEGOS DE BAÑO"],
  [/\b(AZULEJO|ASFALTO|MESADA|GRANITO|FIBROCEMENTO)\b/, "Construccion"],
  [/\b(CARRETILLA|AZADA|CULTIVADOR|IRRIGADOR)\b|\bKIT JARDINERIA\b/, "JARDINERIA"],
  [/\b(CAPA DE LLUVIA|GORRA PROTECCION|CARETA)\b/, "SEGURIDAD INDUSTRIAL"],
  [/\b(TRAILER|CARBURADOR|CORREA MOTOR)\b/, "AUTO REPUESTOS"],
  [/\bMOTOSIERRA\b/, "MOTOSIERRA"],
  [/\b(CACEROLA|OLLA|GUAMPA|LICUADORA|CUBIERTOS|BOMBILLA|TERMOLAR)\b/, "BAZAR Y COCINA"],
  [/\b(ANZUELO|HONDITA|CARNADA)\b/, "CACERIA Y PESCA"],
  [/\b(AGUA DESMINERALIZADA|ACEITE MULTIUSO|GRAFITO)\b/, "QUI - PRODUCTOS"],
  [/\bCREMALLERA\b.*PORTON|\bCREMALLERA\b/, "RIEL PARA PORTON"],
  [/\b(AGUJA|GOMITA|HOJA DE PAPEL|KIT BOLIGRAFO)\b/, "ARTICULOS DE LIBRERIA"],
  [/^(SERVICIO|DELIVERY|MANO DE OBRA|FLETE)\b|\bSERVICIO DE\b/, "SERVICIOS"],
];

const norm = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

export function categoriaPara(nombre: string): string | null {
  const n = norm(nombre);
  for (const [re, cat] of REGLAS) if (re.test(n)) return cat;
  return null;
}

const argOf = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) { console.error("Falta SUPABASE_DB_URL"); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const rb = argOf("rollback");
    if (rb) {
      const data = JSON.parse(fs.readFileSync(rb, "utf8")) as { id: string }[];
      const r = await pool.query(
        `UPDATE ${SCHEMA}.productos SET categoria_principal_id=NULL WHERE id=ANY($1::uuid[])`,
        [data.map((d) => d.id)]
      );
      console.log(`Revertidos ${r.rowCount} productos.`);
      return;
    }
    const apply = has("apply");
    console.log(`Modo: ${apply ? "APLICAR" : "DRY-RUN"}`);

    const { rows: prods } = await pool.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM ${SCHEMA}.productos WHERE categoria_principal_id IS NULL ORDER BY nombre`
    );
    console.log(`sin categoría: ${prods.length}`);

    const asign: { id: string; nombre: string; cat: string }[] = [];
    for (const p of prods) {
      const cat = categoriaPara(p.nombre);
      if (cat) asign.push({ id: p.id, nombre: p.nombre, cat });
    }
    const porCat = new Map<string, number>();
    for (const a of asign) porCat.set(a.cat, (porCat.get(a.cat) ?? 0) + 1);

    console.log(`\nA asignar: ${asign.length} de ${prods.length} (${(asign.length / prods.length * 100).toFixed(1)}%)`);
    console.log(`Quedan sin categoría: ${prods.length - asign.length}`);
    console.log(`\n--- por categoría ---`);
    console.log([...porCat.entries()].sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}(${n})`).join("  "));
    console.log(`\n--- 20 muestras ---`);
    for (let i = 0; i < asign.length; i += Math.max(1, Math.floor(asign.length / 20))) {
      const a = asign[i];
      console.log(`  ${a.nombre.slice(0, 46).padEnd(46)} -> ${a.cat}`);
    }

    if (!apply) { console.log("\nDRY-RUN: no se escribió nada. Agregá --apply."); return; }

    // Crear las categorías nuevas que efectivamente se usan
    const usadas = new Set(asign.map((a) => a.cat));
    const { rows: cats } = await pool.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM ${SCHEMA}.categorias_productos`
    );
    const catId = new Map(cats.map((c) => [c.nombre, c.id]));
    const empresa = (await pool.query(`SELECT empresa_id FROM ${SCHEMA}.productos LIMIT 1`)).rows[0].empresa_id;
    for (const nueva of NUEVAS) {
      if (!usadas.has(nueva) || catId.has(nueva)) continue;
      const r = await pool.query<{ id: string }>(
        `INSERT INTO ${SCHEMA}.categorias_productos (empresa_id, nombre, activo) VALUES ($1,$2,true) RETURNING id`,
        [empresa, nueva]
      );
      catId.set(nueva, r.rows[0].id);
      console.log(`categoría creada: ${nueva}`);
    }

    const porCatIds = new Map<string, string[]>();
    for (const a of asign) {
      const cid = catId.get(a.cat);
      if (!cid) { console.warn(`sin id de categoría: ${a.cat}`); continue; }
      (porCatIds.get(cid) ?? porCatIds.set(cid, []).get(cid)!).push(a.id);
    }
    let total = 0;
    for (const [cid, ids] of porCatIds) {
      const r = await pool.query(
        `UPDATE ${SCHEMA}.productos SET categoria_principal_id=$1::uuid
         WHERE id=ANY($2::uuid[]) AND categoria_principal_id IS NULL`, [cid, ids]
      );
      total += r.rowCount ?? 0;
    }
    const out = `categorias-por-reglas-${asign.length}.json`;
    fs.writeFileSync(out, JSON.stringify(asign, null, 1));
    console.log(`\nActualizados: ${total}`);
    console.log(`Revertir con: npx tsx scripts/categorizar-por-reglas.ts --rollback ${out}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
