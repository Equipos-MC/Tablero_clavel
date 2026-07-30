import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import equiposMcLogo from "./assets/equipos-mc-logo.png";

type Piece = {
  id: string;
  number: string;
  name: string;
  drawing: string;
  plan: string;
  material: string;
  quantity: number;
  made: number;
  pending: number;
  sourceRow: number;
  image?: string;
};

type Assembly = { name: string; pieces: Piece[]; target: number; made: number; pending: number };

type ImportResult = { id: string; fileName: string; group: Group; assemblies: Assembly[]; images: string[]; error?: string };
type Group = "GRÚA" | "CARROCERÍA";

const NORMALIZE = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const asNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const findColumn = (headers: unknown[], options: string[]) =>
  headers.findIndex((header) => options.includes(NORMALIZE(header)));

function numericCell(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || !/^-?[\d,.]+$/.test(text)) return undefined;
  const parsed = asNumber(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findSummaryValue(rows: unknown[][], labels: string[], limit: number) {
  // Busca los valores del resumen alrededor de la etiqueta. Se admite que el
  // dato esté en la misma celda ("HECHAS: 180"), hasta seis columnas a la
  // derecha o hasta tres filas debajo, para tolerar celdas combinadas.
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, limit + 1); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cellText = String(row[columnIndex] ?? "").trim();
      const normalizedCell = NORMALIZE(cellText);
      const matchingLabel = labels.find(
        (label) =>
          normalizedCell === label ||
          normalizedCell.startsWith(label) ||
          normalizedCell.endsWith(label),
      );
      if (!matchingLabel) continue;

      const inlineNumber = cellText.match(/-?\d[\d,.]*/)?.[0];
      if (inlineNumber !== undefined) {
        const value = numericCell(inlineNumber);
        if (value !== undefined) return value;
      }

      const candidates: unknown[] = [];
      for (let offset = 1; offset <= 6; offset += 1) {
        candidates.push(row[columnIndex + offset]);
      }
      for (let rowOffset = 1; rowOffset <= 3; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset <= 3; columnOffset += 1) {
          candidates.push(rows[rowIndex + rowOffset]?.[columnIndex + columnOffset]);
        }
      }
      for (const candidate of candidates) {
        const value = numericCell(candidate);
        if (value !== undefined) return value;
      }
    }
  }
  return undefined;
}

const documentName = (fileName: string) =>
  fileName.replace(/\.(xlsx|xls)$/i, "").trim() || "ENSAMBLE SIN NOMBRE";

async function extractExcelImagesByRow(buffer: ArrayBuffer) {
  const imagesByRow = new Map<number, string>();
  const fallbackImages: string[] = [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    const toDataUrl = async (path: string) => {
      const file = zip.file(path);
      if (!file) return undefined;
      const bytes = await file.async("base64");
      const extension = path.split(".").pop()?.toLowerCase() ?? "png";
      const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
      return `data:${mime};base64,${bytes}`;
    };

    const mediaPaths = Object.keys(zip.files).filter((path) => /^xl\/media\//i.test(path));
    for (const path of mediaPaths) {
      const dataUrl = await toDataUrl(path);
      if (dataUrl) fallbackImages.push(dataUrl);
    }

    const drawingPaths = Object.keys(zip.files).filter((path) => /^xl\/drawings\/drawing\d+\.xml$/i.test(path));
    for (const drawingPath of drawingPaths) {
      const xml = await zip.file(drawingPath)?.async("text");
      const relsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
      const relsXml = await zip.file(relsPath)?.async("text");
      if (!xml || !relsXml) continue;
      const targets = new Map<string, string>();
      for (const match of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?/g)) {
        targets.set(match[1], `xl/media/${match[2].replace(/^.*\//, "")}`);
      }
      for (const anchor of xml.matchAll(/<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)[^>]*>([\s\S]*?)<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/g)) {
        const rowMatch = anchor[1].match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/);
        const embedMatch = anchor[1].match(/<(?:a:)?blip[^>]*r:embed="([^"]+)"/);
        if (!rowMatch || !embedMatch) continue;
        const imagePath = targets.get(embedMatch[1]);
        const dataUrl = imagePath ? await toDataUrl(imagePath) : undefined;
        if (dataUrl) imagesByRow.set(Number(rowMatch[1]), dataUrl);
      }
    }
  } catch { /* El detalle permanece utilizable sin dibujos. */ }
  return { imagesByRow, fallbackImages };
}
async function parseWorkbook(fileName: string, group: Group, buffer: ArrayBuffer): Promise<ImportResult> {
  const id = `${Date.now()}-${fileName}-${Math.random().toString(36).slice(2)}`;
  try {
    const workbook = XLSX.read(buffer, { type: "array" });
    const targetName = workbook.SheetNames.find((name) => NORMALIZE(name) === "PIEZASDEENSAMBLE");
    if (!targetName) {
      return { id, fileName, group, assemblies: [], images: [], error: 'No contiene la hoja "PIEZAS DE ENSAMBLE".' };
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[targetName], {
      header: 1,
      defval: "",
      raw: false,
    });
    const headerIndex = rows.findIndex((row) => row.some((cell) => NORMALIZE(cell) === "NOMBRE") && row.some((cell) => NORMALIZE(cell).includes("CANTIDAD")));
    if (headerIndex < 0) return { id, fileName, group, assemblies: [], images: [], error: "No se identificaron los encabezados de piezas." };
    const workbookMade = findSummaryValue(rows, ["HECHAS", "HECHA", "REALIZADO", "REALIZADAS"], headerIndex);
    const workbookPending = findSummaryValue(rows, ["PORHACER", "PENDIENTE", "PENDIENTES"], headerIndex);
    const missingFields = [
      workbookMade === undefined ? "HECHAS" : undefined,
      workbookPending === undefined ? "POR HACER" : undefined,
    ].filter(Boolean);
    if (workbookMade === undefined || workbookPending === undefined) {
      return {
        id,
        fileName,
        group,
        assemblies: [],
        images: [],
        error: `Falta el campo ${missingFields.join(" y ")} en el encabezado del Excel.`,
      };
    }

    const headers = rows[headerIndex];
    const nameIndex = findColumn(headers, ["NOMBRE"]);
    const numberIndex = findColumn(headers, ["NO", "NO.", "NUMERO"]);
    const drawingIndex = findColumn(headers, ["DIBUJO"]);
    const planIndex = findColumn(headers, ["NODEPLANO", "NOPLANO", "PLANONUMERO"]);
    const materialIndex = findColumn(headers, ["MATERIAL"]);
    const quantityIndex = findColumn(headers, ["CANTIDAD"]);
    const madeIndex = findColumn(headers, ["HECHAS", "HECHA", "REALIZADO", "REALIZADAS"]);
    const pendingIndex = findColumn(headers, ["PORHACER", "PENDIENTE", "PENDIENTES"]);

    const { imagesByRow, fallbackImages } = await extractExcelImagesByRow(buffer);
    const pedestalPieces: Piece[] = [];
    let currentAssembly = "PEDESTAL";
    for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
      const sourceRow = headerIndex + 1 + offset;
      const joined = row.map(NORMALIZE).join(" ");
      if (joined.includes("SUBESTRUCTURA")) { currentAssembly = "SUBESTRUCTURA"; continue; }
      if (joined.includes("PEDESTAL")) { currentAssembly = "PEDESTAL"; continue; }
      if (currentAssembly !== "PEDESTAL") continue;
      const name = String(row[nameIndex] ?? "").trim();
      if (!name || name === "NOMBRE") continue;
      const quantity = asNumber(row[quantityIndex]);
      if (quantity <= 0) continue;
      const explicitMade = madeIndex >= 0 ? asNumber(row[madeIndex]) : 0;
      const explicitPending = pendingIndex >= 0 ? asNumber(row[pendingIndex]) : Math.max(quantity - explicitMade, 0);
      const made = Math.min(Math.max(explicitMade, 0), quantity);
      const pending = Math.min(Math.max(explicitPending, 0), quantity - made);
      const piece: Piece = {
        id: `${currentAssembly}-${name}-${pedestalPieces.length}`,
        number: String(row[numberIndex] ?? "—").trim() || "—",
        name,
        drawing: String(row[drawingIndex] ?? "").trim(),
        plan: String(row[planIndex] ?? "—").trim() || "—",
        material: String(row[materialIndex] ?? "—").trim() || "—",
        quantity,
        made,
        pending,
        sourceRow,
        image: imagesByRow.get(sourceRow),
      };
      pedestalPieces.push(piece);
    }
    const images = pedestalPieces.map((piece, index) => piece.image ?? fallbackImages[index]).filter((image): image is string => Boolean(image));
    const madeTotal = Math.max(workbookMade, 0);
    const pendingTotal = Math.max(workbookPending, 0);
    const target = madeTotal + pendingTotal;
    const assembly = pedestalPieces.length ? {
      name: documentName(fileName),
      pieces: pedestalPieces.map((piece, index) => ({ ...piece, image: piece.image ?? fallbackImages[index] })),
      target,
      made: madeTotal,
      pending: pendingTotal,
    } : undefined;
    return { id, fileName, group, images, assemblies: assembly ? [assembly] : [] };
  } catch {
    return { id, fileName, group, assemblies: [], images: [], error: "El archivo no se pudo leer. Verifica que sea un Excel válido." };
  }
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function AssemblyProgress({ assembly, onClick }: { assembly: Assembly; onClick?: () => void }) {
  const total = assembly.target;
  const made = assembly.made;
  const pending = assembly.pending;
  const done = percent(made, total);
  return <article className="assembly-row">
    <div className="assembly-name"><span className="assembly-marker" />{onClick ? <button className="assembly-name-btn" onClick={onClick}>{assembly.name}</button> : assembly.name}</div>
    <div className="assembly-bar" aria-label={`${assembly.name}: ${done}% realizado`}><i style={{ width: `${done}%` }} /></div>
    <strong className="assembly-percent">{done}%</strong>
    <span className="assembly-target"><b>{assembly.target}</b></span>
    <span className="assembly-made"><b>{made}</b></span>
    <span className="assembly-pending-count"><b>{pending}</b></span>
  </article>;
}

function AssemblyDetail({ document, assembly, onBack }: { document: ImportResult; assembly: Assembly; onBack: () => void }) {
  const done = percent(assembly.made, assembly.target);
  return <main className="shell detail-screen">
    <header className="masthead"><div className="brand"><img src={equiposMcLogo} alt="Equipos Hidromecánicos MC" /></div><div className="title-block"><p className="eyebrow">{document.group} · {document.fileName.replace(/\.(xlsx|xls)$/i, "")}</p><h1>{assembly.name}</h1></div><button className="back-button" onClick={onBack}>← Volver al tablero</button></header>
    <section className="detail-sheet">
      <div className="detail-heading"><div><p className="eyebrow">ENSAMBLE DE {document.group}</p><h2>Piezas de {assembly.name}</h2></div><span className="detail-pct-badge">{done}% completado · {document.images.length} dibujo(s)</span></div>
      <div className="detail-grid">{assembly.pieces.map((piece, index) => <article className="piece-card" key={piece.id}><div className="piece-image">{piece.image ? <img src={piece.image} alt={`Dibujo técnico de ${piece.name}`} /> : <span>DIBUJO NO DISPONIBLE<br/>EN EL ARCHIVO</span>}</div><div><p className="eyebrow">PIEZA {piece.number}</p><h4>{piece.name}</h4><dl><div><dt>NO. DE PLANO</dt><dd>{piece.plan}</dd></div><div><dt>MATERIAL</dt><dd>{piece.material}</dd></div><div><dt>CANTIDAD</dt><dd>{piece.quantity}</dd></div></dl></div></article>)}</div>
    </section>
  </main>;
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imports, setImports] = useState<ImportResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<Group>("GRÚA");
  const [activeView, setActiveView] = useState<"RESUMEN" | "DOCUMENTOS">("RESUMEN");
  const [selectedAssembly, setSelectedAssembly] = useState<{ document: ImportResult; assembly: Assembly } | null>(null);

  const importFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files).filter((file) => /\.(xlsx|xls)$/i.test(file.name));
    if (!selected.length) return;
    setLoading(true);
    const next = await Promise.all(selected.map(async (file) => parseWorkbook(file.name, activeGroup, await file.arrayBuffer())));
    setImports((current) => [...current, ...next]);
    setLoading(false);
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ""; };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void importFiles(event.dataTransfer.files); };
  const removeFile = (id: string) => setImports((current) => current.filter((item) => item.id !== id));
  const visibleImports = imports.filter((item) => item.group === activeGroup);
  const assemblyEntries = visibleImports.flatMap((doc) => doc.assemblies.map((assembly) => ({ document: doc, assembly })));
  const total = assemblyEntries.reduce((sum, { assembly }) => sum + assembly.target, 0);
  const made = assemblyEntries.reduce((sum, { assembly }) => sum + assembly.made, 0);

  if (selectedAssembly) return <AssemblyDetail document={selectedAssembly.document} assembly={selectedAssembly.assembly} onBack={() => setSelectedAssembly(null)} />;

  return <main className="shell">
    <header className="masthead"><div className="brand"><img src={equiposMcLogo} alt="Equipos Hidromecánicos MC" /></div><div className="title-block"><p>CONTROL DE FABRICACIÓN</p><h1>Tablero de ensambles</h1></div></header>
    <nav className="group-tabs" aria-label="Tipo de ensambles">{(["GRÚA", "CARROCERÍA"] as Group[]).map((group) => <button key={group} className={activeGroup === group ? "active" : ""} onClick={() => setActiveGroup(group)}>{group}<span>{imports.filter((item) => item.group === group).length}</span></button>)}</nav>
    <nav className="sub-tabs" aria-label="Vistas de la categoría"><button className={activeView === "RESUMEN" ? "active" : ""} onClick={() => setActiveView("RESUMEN")}>Resumen</button><button className={activeView === "DOCUMENTOS" ? "active" : ""} onClick={() => setActiveView("DOCUMENTOS")}>Subir documentos <span>{visibleImports.length}</span></button></nav>
    <section className="workspace">
      <div className="workspace-head"><div><p className="eyebrow">ENSAMBLES DE {activeGroup}</p><h2>Avance de fabricación</h2></div>{assemblyEntries.length > 0 && <div className="global-progress"><b>{percent(made, total)}%</b><span>avance general</span></div>}</div>
      {activeView === "DOCUMENTOS" ? <>
        <div className="import-strip"><div><b>Documentos de {activeGroup.toLowerCase()}</b><span>Importa y conserva los Excel de esta categoría.</span></div><div className={`dropzone compact ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => event.key === "Enter" && inputRef.current?.click()}><input ref={inputRef} type="file" accept=".xlsx,.xls" multiple onChange={handleChange} /><strong>{loading ? "Leyendo…" : "＋ Agregar archivos Excel"}</strong></div></div>
        <div className="file-list document-list">{visibleImports.length ? visibleImports.map((item) => <div key={item.id} className={item.error ? "file-row error" : "file-row"}><span className="file-status">{item.error ? "!" : "✓"}</span><span className="file-name">{item.fileName}</span><small>{item.error ?? `${item.assemblies.length} ensamble(s)`}</small><button className="remove-file" onClick={() => removeFile(item.id)} aria-label={`Eliminar ${item.fileName}`}>Eliminar</button></div>) : <p className="no-documents">No hay documentos cargados en {activeGroup.toLowerCase()}.</p>}</div>
      </> : assemblyEntries.length ? <section className="progress-list" aria-label={`Avance de los ensambles de ${activeGroup}`}><div className="list-labels"><span>ENSAMBLE</span><span>AVANCE</span><span>%</span><span>CANTIDAD DE ENSAMBLES</span><span>HECHAS</span><span>POR HACER</span></div>{assemblyEntries.map(({ document, assembly }, index) => <AssemblyProgress key={`${assembly.name}-${index}`} assembly={assembly} onClick={() => setSelectedAssembly({ document, assembly })} />)}</section> : <section className="empty-state"><div className="empty-symbol">▦</div><p className="eyebrow">{activeGroup} EN ESPERA</p><h2>Aún no hay ensambles cargados</h2><p>Ve a "Subir documentos" para importar los archivos de {activeGroup.toLowerCase()}.</p></section>}
    </section>
  </main>;
}
