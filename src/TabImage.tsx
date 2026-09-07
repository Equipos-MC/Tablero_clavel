import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { getTabImage, prepareTabImage, uploadToSpace } from "./storage";

export default function TabImage({ orderId, group }: { orderId: string; group: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const fallback = orderId === "legacy-eh150" && ["GRÚA", "CHASIS"].includes(group)
    ? `${import.meta.env.BASE_URL}assets/${group === "GRÚA" ? "eh150-grua.jpeg" : "eh150-carroceria.png"}` : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    getTabImage(orderId, group).then(({ downloadUrl }) => {
      if (!cancelled) setImage(downloadUrl);
    }).catch((error) => {
      if (!cancelled) setError(error instanceof Error ? error.message : "No se pudo recuperar la imagen.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, group, retry]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || saving) return;
    setError(""); setSaved(false);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
      setError("Selecciona una imagen JPG, PNG o WebP de hasta 10 MB."); return;
    }
    setSaving(true);
    let uploaded = false;
    try {
      // Comprueba que el archivo se pueda mostrar antes de reemplazar la imagen guardada.
      const bitmap = await createImageBitmap(file).catch(() => { throw new Error("No se pudo leer esta imagen. Prueba con otro archivo JPG, PNG o WebP."); });
      bitmap.close();
      const { uploadUrl } = await prepareTabImage(orderId, group, file);
      await uploadToSpace(uploadUrl, file);
      uploaded = true;
      const { downloadUrl } = await getTabImage(orderId, group);
      if (!downloadUrl) throw new Error("No se pudo recuperar la imagen guardada.");
      setImage(downloadUrl); setSaved(true);
    } catch (error) {
      setError(`${uploaded ? "La imagen se guardó, pero no se pudo mostrar. " : ""}${error instanceof Error ? error.message : "No se pudo guardar la imagen."}`);
    } finally { setSaving(false); }
  }

  const source = image || fallback;
  return <section className="tab-image-section" aria-label={`Imagen de ${group}`}>
    <div className="tab-image-heading"><div><p className="eyebrow">IMAGEN DE {group}</p><p>Una imagen de referencia para esta pestaña.</p></div><button className="back-button" disabled={loading || saving} onClick={() => inputRef.current?.click()}>{saving ? "Guardando imagen…" : source ? "Cambiar imagen" : "＋ Subir imagen"}</button><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} hidden aria-label={`Subir imagen de ${group}`} /></div>
    {loading ? <p className="image-placeholder" role="status">Cargando imagen…</p> : source ? <div className="tab-image-preview"><img src={source} alt={`Imagen de referencia de ${group}`} onError={() => { setSaved(false); setError("No se pudo mostrar la imagen. Pulsa Reintentar para cargarla de nuevo."); }} /></div> : <div className="image-placeholder">Agrega una foto o un dibujo de {group.toLowerCase()}.</div>}
    <div className="tab-image-caption"><span>JPG, PNG o WebP · Máximo 10 MB</span>{saved && <span className="image-success" role="status">✓ Imagen guardada</span>}</div>
    {error && <div className="image-error" role="alert">{error}<button className="back-button" disabled={saving || loading} onClick={() => { setSaved(false); setRetry((value) => value + 1); }}>Reintentar</button></div>}
  </section>;
}
