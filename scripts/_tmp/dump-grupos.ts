import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
const S = `"ferreteriarepublica"`;
const STOP = new Set(["DE","DEL","LA","EL","LOS","LAS","PARA","POR","CON","SIN","Y","A","EN","X"]);
const primera = (s: string) => {
  const t = String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase()
    .replace(/[^A-Z0-9]/g," ").split(/\s+/).filter(w=>w.length>=2&&!STOP.has(w));
  return t[0] ?? "(vacio)";
};
async function main(){
  const {rows}=await pool.query<{nombre:string}>(
    `SELECT nombre FROM ${S}.productos WHERE categoria_principal_id IS NULL ORDER BY nombre`);
  const g=new Map<string,string[]>();
  for(const r of rows){const k=primera(r.nombre);(g.get(k)??g.set(k,[]).get(k)!).push(r.nombre);}
  const orden=[...g.entries()].sort((a,b)=>b[1].length-a[1].length);
  console.log(`TOTAL ${rows.length} en ${orden.length} grupos\n`);
  for(const [k,v] of orden){
    console.log(`${String(v.length).padStart(3)} ${k} :: ${v.slice(0,2).map(n=>n.slice(0,44)).join("  ||  ")}`);
  }
  await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
