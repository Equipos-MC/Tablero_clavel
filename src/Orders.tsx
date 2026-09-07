import { useEffect, useRef, useState, type FormEvent } from "react";
import Board from "./App";
import logo from "./assets/equipos-mc-logo.png";
import { listStoredDocuments, saveWorkOrder, type WorkOrder } from "./storage";

export default function Orders() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<"order" | "tab" | null>(null);
  useEffect(() => { if (form) dialogRef.current?.showModal(); }, [form]);
  const [name, setName] = useState("");
  const [tabs, setTabs] = useState([""]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const active = orders.find((order) => order.id === selected);
  useEffect(() => { document.title = `${active?.name ?? "Órdenes de trabajo"} | Equipos MC`; }, [active?.name]);
  async function refresh() {
    setLoading(true); setError("");
    try {
      const result = await listStoredDocuments();
      if (!Array.isArray(result.orders)) throw new Error("Es necesario actualizar el servicio de almacenamiento para gestionar las OT.");
      setOrders(result.orders);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudieron cargar las OT."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  function openForm(kind: "order" | "tab") { setName(""); setTabs([""]); setFormError(""); setForm(kind); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError("");
    try {
      const { order } = await saveWorkOrder(form === "tab" && active
        ? { action: "add-tab", orderId: active.id, tab: name }
        : { action: "create-order", name, tabs });
      setOrders((current) => [...current.filter((item) => item.id !== order.id), order]);
      setSelected(order.id); setForm(null);
    } catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }
  return <>
    {active ? <Board key={active.id} order={active} onBack={() => { setSelected(null); void refresh(); }} onAddTab={() => openForm("tab")} /> : <main className="shell">
      <header className="masthead"><div className="brand"><img src={logo} alt="Equipos Hidromecánicos MC" /></div><div className="title-block"><p>CONTROL DE FABRICACIÓN</p><h1>Órdenes de trabajo</h1></div><button className="primary-button" disabled={loading || !!error} onClick={() => openForm("order")}>＋ Crear OT</button></header>
      <section className="orders-heading"><div><p className="eyebrow">TU PRODUCCIÓN, POR ORDEN DE TRABAJO</p><h2>Selecciona una OT para continuar</h2><p>Cada orden tiene sus propias pestañas, documentos y avances.</p></div><label>Buscar OT<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. OT-EH-150" type="search" /></label></section>
      {loading ? <p role="status" className="loading-documents">Recuperando órdenes de trabajo…</p> : error ? <div className="database-error" role="alert">{error} <button className="back-button" onClick={() => void refresh()}>Reintentar</button></div> : <section className="orders-grid" aria-label="Órdenes de trabajo">
        {orders.filter((order) => order.name.toLowerCase().includes(search.trim().toLowerCase())).map((order) => <button className="order-card" key={order.id} onClick={() => setSelected(order.id)}><span className="eyebrow">ORDEN DE TRABAJO</span><h2>{order.name}</h2><span className="order-tags">{order.tabs.map((tab) => <span key={tab}>{tab}</span>)}</span><span className="order-footer">{order.tabs.length} pestaña(s)<b>Abrir tablero →</b></span></button>)}
        {!orders.some((order) => order.name.toLowerCase().includes(search.trim().toLowerCase())) && <p>No se encontraron órdenes con ese nombre.</p>}
      </section>}
    </main>}
    {form && <dialog ref={dialogRef} className="order-dialog" aria-labelledby="form-title" onCancel={(event) => { event.preventDefault(); if (!saving) setForm(null); }}><form onSubmit={submit}><p className="eyebrow">{form === "order" ? "NUEVA ORDEN DE TRABAJO" : active?.name}</p><h2 id="form-title">{form === "order" ? "Crea tu OT" : "Agregar pestaña"}</h2><label>{form === "order" ? "Nombre de la OT" : "Nombre de la pestaña"}<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder={form === "order" ? "OT-EP-256" : "Cocina"} disabled={saving} /></label>
      {form === "order" && <fieldset disabled={saving}><legend>Pestañas de esta OT</legend><p>Agrega las áreas que necesitas: Barrena, Chasis, Grúa, Cocina…</p>{tabs.map((tab, index) => <div className="tab-input" key={index}><input required maxLength={100} aria-label={`Nombre de pestaña ${index + 1}`} placeholder={`Pestaña ${index + 1}`} value={tab} onChange={(event) => setTabs((current) => current.map((value, position) => position === index ? event.target.value : value))} /><button type="button" className="back-button" disabled={tabs.length === 1} onClick={() => setTabs((current) => current.filter((_, position) => position !== index))} aria-label={`Quitar pestaña ${index + 1}`}>Quitar</button></div>)}<button className="back-button" type="button" onClick={() => setTabs((current) => [...current, ""])}>＋ Agregar otra pestaña</button></fieldset>}
      {formError && <p role="alert" className="form-error">{formError}</p>}<div className="dialog-actions"><button className="back-button" type="button" disabled={saving} onClick={() => setForm(null)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Guardando…" : form === "order" ? "Crear OT y abrir" : "Guardar pestaña"}</button></div>
    </form></dialog>}
  </>;
}
