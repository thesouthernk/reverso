"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type CellValueChangedEvent } from "ag-grid-community";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as ChartsModule, ModuleRegistry as ChartsRegistry, type AgCartesianChartOptions, type AgPolarChartOptions } from "ag-charts-community";

ModuleRegistry.registerModules([AllCommunityModule]);
ChartsRegistry.registerModules([ChartsModule]);

type Row = { id: string; model: string; payment: string; budget: string; when: string; buyer: string; bids: number; myPrice: number | null; rank: number | null; status: string;
  myFloor: number | null; myRealCost: number | null; bestRival: number | null; reasoning: string; note: string; toLead: number | null; aheadBy: number | null };
type Spend = { contact: number; visit: number; reserve: number; refunded: number };
type Inv = { key: string; model: string; trim: string; msrp: number; otd: number; floor: number };
type Deal = { reqId: string; name: string; email: string; phone: string; car: string; price: number; stage: number; paid: number; refunded: number; visit?: string };
type View = { dealer: string; balance: number; fees: { contact: number; visit: number; reserve: number }; rows: Row[]; inventory: Inv[]; deals: Deal[]; topups: { amount: number; refunded: number }[]; log: { at: number; text: string }[]; clientId: string; spend: Spend };

const usd = (n: number) => "$" + new Intl.NumberFormat("en-US").format(Math.round(n));
const STAGES = ["New contact", "Visit booked", "Reserved", "Sold", "Refunded"];
const FONT = { fontFamily: "var(--font-geist), system-ui, sans-serif" };

/** AG Charts: where you stand on each live request, and where your money went. Both redraw as the grid changes. */
function Charts({ rows, spend }: { rows: Row[]; spend: Spend }) {
  const live = rows.filter((r) => ["Bidding", "Re-bidding"].includes(r.status) && r.myRealCost != null);
  const data = (live.length ? live : rows.filter((r) => r.myRealCost != null)).slice(0, 6).reverse()
    .map((r) => ({ id: r.id, floor: r.myFloor, mine: r.myRealCost, rival: r.bestRival }));
  const vals = data.flatMap((d) => [d.floor, d.mine, d.rival]).filter((v): v is number => v != null);
  const min = vals.length ? Math.floor((Math.min(...vals) - 600) / 500) * 500 : 0;
  const money = { formatter: ({ value }: { value: number }) => usd(value) };
  const bars: AgCartesianChartOptions = {
    data, background: { visible: false }, title: { text: "Your position on live requests", ...FONT, fontSize: 15, fontWeight: 600, textAlign: "left" },
    subtitle: { text: "Buyer's real cost of your offer vs the best rival, with your floor", ...FONT, fontSize: 12, color: "#6B7280", textAlign: "left" },
    series: [
      { type: "bar", xKey: "id", yKey: "floor", yName: "Your floor", fill: "#D7DCE5", cornerRadius: 6, label: { ...money, ...FONT, fontSize: 11, color: "#4B5563", placement: "inside-end" }, tooltip: { renderer: ({ datum }) => `Floor ${usd(datum.floor)}` } },
      { type: "bar", xKey: "id", yKey: "mine", yName: "Your real cost", fill: "#2F6BFF", cornerRadius: 6, label: { ...money, ...FONT, fontSize: 11, color: "#fff", placement: "inside-end" } },
      { type: "bar", xKey: "id", yKey: "rival", yName: "Best rival", fill: "#F59E0B", cornerRadius: 6, label: { ...money, ...FONT, fontSize: 11, color: "#fff", placement: "inside-end" } },
    ],
    axes: { x: { type: "category", position: "bottom", label: FONT }, y: { type: "number", position: "left", min, label: { ...money, ...FONT }, gridLine: { style: [{ stroke: "#EEF0F3" }] } } },
    legend: { position: "bottom", item: { label: FONT } },
  };
  const parts = [
    { kind: "Contacts", amount: spend.contact, fill: "#2F6BFF" }, { kind: "Visits", amount: spend.visit, fill: "#14B8A6" },
    { kind: "Reservations", amount: spend.reserve, fill: "#84CC16" }, { kind: "Refunded via PayPal", amount: spend.refunded, fill: "#D7DCE5" },
  ].filter((p) => p.amount > 0);
  const net = spend.contact + spend.visit + spend.reserve - spend.refunded;
  const donut: AgPolarChartOptions = {
    data: parts, background: { visible: false }, title: { text: "Where your money went", ...FONT, fontSize: 15, fontWeight: 600, textAlign: "left" },
    subtitle: { text: "Fees by outcome, and what PayPal sent back", ...FONT, fontSize: 12, color: "#6B7280", textAlign: "left" },
    series: [{ type: "donut", angleKey: "amount", legendItemKey: "kind", fills: parts.map((p) => p.fill), strokeWidth: 2, innerRadiusRatio: 0.68,
      innerLabels: [{ text: usd(net), ...FONT, fontSize: 22, fontWeight: 650 }, { text: "net spent", ...FONT, fontSize: 12, color: "#6B7280" }],
      tooltip: { renderer: ({ datum }) => `${datum.kind}: ${usd(datum.amount)}` } }],
    legend: { position: "bottom", item: { label: FONT } },
  };
  return (
    <section className="charts" aria-label="Charts">
      <div className="chart wide">{data.length ? <AgCharts options={bars} /> : <p className="empty">Your position appears here as soon as your agent bids.</p>}</div>
      <div className="chart">{parts.length ? <AgCharts options={donut} /> : <p className="empty">Nothing charged yet. You pay only when a buyer picks you.</p>}</div>
    </section>
  );
}

const pill = (tone: (r: Row) => string) => function Pill(p: ICellRendererParams<Row>) {
  return p.value && p.data ? <span className={`pill ${tone(p.data)}`}>{p.value}</span> : null;
};
const theme = themeQuartz.withParams({
  fontFamily: "inherit", accentColor: "#2F6BFF", backgroundColor: "#FFFFFF", foregroundColor: "#0F1115", borderColor: "#EEF0F3",
  headerBackgroundColor: "#FFFFFF", headerTextColor: "#6B7280", headerFontWeight: 500, headerFontSize: 13, fontSize: 14, rowHoverColor: "#F7F8FA",
  wrapperBorder: false, wrapperBorderRadius: 0, columnBorder: false, headerColumnBorder: false, headerColumnResizeHandleColor: "transparent",
  valueChangeValueHighlightBackgroundColor: "#D7E4FF", spacing: 9,
});

declare global { interface Window { paypal?: { Buttons: (o: object) => { render: (el: HTMLElement) => Promise<void> } } } }

export default function Dealer() {
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null), rendered = useRef(false), editing = useRef(false);

  // Polling pauses while a cell is being edited, so a refresh never knocks the dealer out of the editor.
  const tick = useCallback(async () => { if (editing.current) return; const r = await fetch("/api/state"); if (r.ok && !editing.current) setView(await r.json()); }, []);
  useEffect(() => { tick(); const t = setInterval(tick, 1000); return () => clearInterval(t); }, [tick]);

  // PayPal checkout to fund the pay-per-outcome balance.
  const clientId = view?.clientId;
  useEffect(() => {
    if (!clientId || rendered.current) return;
    const mount = () => {
      if (!box.current || !window.paypal || rendered.current) return;
      rendered.current = true;
      window.paypal.Buttons({
        style: { layout: "horizontal", shape: "pill", color: "black", label: "paypal", tagline: false, height: 44 },
        createOrder: async () => { const r = await fetch("/api/paypal/order", { method: "POST", body: JSON.stringify({ kind: "topup" }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j.id; },
        onApprove: async (d: { orderID: string }) => { const r = await fetch("/api/paypal/capture", { method: "POST", body: JSON.stringify({ orderId: d.orderID }) }); const j = await r.json(); if (!r.ok) setErr(j.error); else setNote(`${usd(j.amount)} added through PayPal.`); tick(); },
        onError: (e: Error) => setErr(String(e?.message ?? e)),
      }).render(box.current);
    };
    if (window.paypal) { mount(); return; }
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons&locale=en_US`;
    s.onload = mount; document.body.appendChild(s);
  }, [clientId, tick]);

  async function act(body: object, ok?: string) {
    setErr(""); const r = await fetch("/api/state", { method: "POST", body: JSON.stringify(body) }); const j = await r.json();
    if (!r.ok || j.ok === false) setErr(j.error ?? "That didn't work"); else if (ok) setNote(ok);
    tick();
  }

  const cols = useMemo((): ColDef<Row>[] => [
    { field: "id", headerName: "Request", flex: 0.8, minWidth: 82 },
    { field: "model", headerName: "Car", flex: 1.6, minWidth: 150 },
    { field: "payment", flex: 1.5, minWidth: 130, tooltipValueGetter: (p) => (p.data ? `${p.data.payment}. Budget: ${p.data.budget}.` : undefined) },
    { field: "when", headerName: "Buying", flex: 1.1, minWidth: 115, cellRenderer: pill((r) => (r.when === "This week" ? "ok" : "")) },
    // The agent's control surface: edit this request's floor and the agent re-bids live.
    { field: "myFloor", headerName: "Your floor (edit)", flex: 1.2, minWidth: 130, enableCellChangeFlash: true, cellEditor: "agNumberCellEditor", cellEditorParams: { min: 1000, precision: 0 },
      editable: (p) => p.data?.status === "Bidding", cellClass: (p) => (p.data?.status === "Bidding" ? "editable" : ""), valueFormatter: (p) => (p.value == null ? "" : usd(p.value)),
      tooltipValueGetter: (p) => (p.data?.status === "Bidding" ? "Change it and your agent re-bids on this buyer right now" : undefined) },
    { field: "myPrice", headerName: "Your bid", flex: 1.1, minWidth: 100, enableCellChangeFlash: true, valueFormatter: (p) => (p.value == null ? "" : usd(p.value)),
      tooltipValueGetter: (p) => (p.data?.reasoning ? `Your agent: ${p.data.reasoning}` : undefined) },
    { field: "myRealCost", headerName: "Real cost", flex: 1, minWidth: 100, enableCellChangeFlash: true, valueFormatter: (p) => (p.value == null ? "" : usd(p.value)),
      tooltipValueGetter: (p) => (p.data?.note ? `Buyer's agent: ${p.data.note}` : undefined) },
    { colId: "rank", headerName: "Position", flex: 1, minWidth: 95, enableCellChangeFlash: true, valueGetter: (p) => (p.data?.rank ? `${p.data.rank} of ${p.data.bids}` : ""), cellRenderer: pill((r) => (r.rank === 1 ? "ok" : "warn")) },
    { colId: "gap", headerName: "Gap", flex: 1.3, minWidth: 140, enableCellChangeFlash: true,
      valueGetter: (p) => (!["Bidding", "Re-bidding"].includes(p.data?.status ?? "") ? "" : p.data?.aheadBy != null ? `Ahead by ${usd(p.data.aheadBy)}` : p.data?.toLead != null ? `Lead under ${usd(p.data.toLead + 1)}` : ""),
      cellRenderer: pill((r) => (r.aheadBy != null ? "ok" : "warn")),
      tooltipValueGetter: (p) => (!["Bidding", "Re-bidding"].includes(p.data?.status ?? "") ? undefined : p.data?.aheadBy != null ? `The next offer costs the buyer ${usd(p.data.aheadBy)} more. Raise your floor to keep more margin and still lead.`
        : p.data?.toLead != null ? `The best rival's real cost is ${usd(p.data.toLead + 1)}. Lower your floor below it and your agent can take 1st.` : undefined) },
    { field: "status", flex: 1.1, minWidth: 110, enableCellChangeFlash: true, cellRenderer: pill((r) => ({ Chosen: "ok", New: "new", Live: "live", Bidding: "live", "Re-bidding": "live", Failed: "warn" } as Record<string, string>)[r.status] ?? "") },
  ], []);
  // The floor your agent will never bid under. Editable right in the grid.
  const invCols = useMemo((): ColDef<Inv>[] => [
    { field: "model", flex: 1.4, minWidth: 150 },
    { field: "trim", flex: 0.9, minWidth: 90 },
    { field: "msrp", headerName: "MSRP", flex: 1, minWidth: 100, valueFormatter: (p) => usd(p.value) },
    { field: "otd", headerName: "MSRP out the door", flex: 1.3, minWidth: 150, valueFormatter: (p) => usd(p.value) },
    { field: "floor", headerName: "Your floor (edit)", flex: 1.3, minWidth: 150, editable: true, cellEditor: "agNumberCellEditor", cellEditorParams: { min: 1000, precision: 0 },
      valueFormatter: (p) => usd(p.value), cellClass: "editable", enableCellChangeFlash: true },
  ], []);
  const onRebid = useCallback((e: CellValueChangedEvent<Row>) => { if (e.data && e.newValue !== e.oldValue) act({ action: "rebid", id: e.data.id, floor: e.newValue }, `Floor for ${e.data.id} set to ${usd(e.newValue)}. Your agent is re-bidding.`); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = { onCellEditingStarted: () => { editing.current = true; }, onCellEditingStopped: () => { editing.current = false; } };
  const onFloor = useCallback((e: CellValueChangedEvent<Inv>) => { if (e.data) act({ action: "floor", key: e.data.key, floor: e.newValue }, `Floor saved. Your agent uses it on the next request.`); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lanes = [0, 1, 2, 3];
  const refundable = view ? view.topups.reduce((s, t) => s + t.amount - t.refunded, 0) : 0;

  return (
    <div className="dealer">
      <header className="top">
        <span className="brand"><i className="mark" aria-hidden />Reverso <span className="for">for {view?.dealer ?? "dealers"}</span></span>
        <nav><span className="switch"><Link href="/">Buyer</Link><Link className="on" href="/dealer">Dealer</Link></span></nav>
      </header>

      <section className="summary">
        <h1>Buyers asking for a price right now</h1>
        <p className="lede">Every buyer has a verified phone. You see the car, never the person. You pay only for outcomes, from a balance you fund with PayPal: {usd(view?.fees.contact ?? 40)} for a contact, {usd(view?.fees.visit ?? 75)} if they book a visit, {usd(view?.fees.reserve ?? 150)} if they reserve.</p>
      </section>

      <section className="stats" aria-label="Today at a glance">
        <div className="stat main">
          <span>Balance for contacts</span><strong key={view?.balance}>{usd(view?.balance ?? 0)}</strong>
          <div className="topup"><div ref={box} className="ppbox" /><small>Add $500 with PayPal</small></div>
        </div>
        <p className="stat"><span>Open requests</span><strong>{view?.rows.filter((r) => ["New", "Live", "Bidding"].includes(r.status)).length ?? 0}</strong></p>
        <p className="stat"><span>Where you&apos;re leading</span><strong>{view?.rows.filter((r) => r.rank === 1 && r.status !== "Lost").length ?? 0}</strong></p>
        <p className="stat"><span>Buyers who picked you</span><strong>{view?.deals.length ?? 0}</strong></p>
      </section>
      {(err || note) && <p className={err ? "error wide" : "okmsg wide"} role={err ? "alert" : "status"}>{err || note}</p>}

      <div className="board">
        <div className="grid">
          <AgGridReact<Row> theme={theme} rowData={view?.rows ?? []} columnDefs={cols} getRowId={(p) => p.data.id} domLayout="autoHeight" rowHeight={54} headerHeight={46}
            onCellValueChanged={onRebid} singleClickEdit stopEditingWhenCellsLoseFocus tooltipShowDelay={150} {...edit}
            overlayNoRowsTemplate="No requests yet. Open the buyer view and ask for a car." />
        </div>
      </div>

      {view && <Charts rows={view.rows} spend={view.spend ?? { contact: 0, visit: 0, reserve: 0, refunded: 0 }} />}

      <section className="pipeline" aria-label="Buyers who picked your offer">
        <h2>Buyers who picked your offer</h2>
        <div className="lanes four">
          {lanes.map((i) => {
            const cards = (view?.deals ?? []).filter((d) => d.stage === i || (i === 0 && d.stage === 4));
            return (
              <div className="lane" key={i}>
                <h3><i className={`dot s${i}`} aria-hidden />{STAGES[i]} <span>{cards.length}</span></h3>
                {cards.length === 0 && <p className="empty">{i === 0 ? "New buyers land here the moment they pick you." : "Nobody here yet."}</p>}
                {cards.map((d) => (
                  <article className={`deal${d.stage === 0 ? " hot" : ""}`} key={d.reqId}>
                    <p className="name">{d.name}</p>
                    <p>{d.car}</p>
                    <p>Accepted {usd(d.price)} out the door</p>
                    <p className="reach">{d.phone}, {d.email}</p>
                    {d.visit && <p>Visit: {d.visit}</p>}
                    <p className="fine">{usd(d.paid)} charged{d.refunded ? `, ${usd(d.refunded)} refunded through PayPal` : ""}</p>
                    {d.stage === 0 && !d.refunded && <div className="moves"><button className="link" onClick={() => act({ action: "noanswer", id: d.reqId }, "Contact fee refunded through PayPal.")}>Buyer didn&apos;t answer in 48 h: refund</button></div>}
                  </article>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="pipeline">
        <h2>Your inventory and floors</h2>
        <p className="lede small">Your agent bids on its own and never goes under these out-the-door floors. Click a floor to change it for new requests; change it on a live request above and your agent re-bids on the spot.</p>
        <div className="grid">
          <AgGridReact<Inv> theme={theme} rowData={view?.inventory ?? []} columnDefs={invCols} getRowId={(p) => p.data.key} domLayout="autoHeight" rowHeight={50} headerHeight={46}
            onCellValueChanged={onFloor} singleClickEdit stopEditingWhenCellsLoseFocus {...edit} />
        </div>
        <p className="fine">PayPal top-ups available to refund against: {usd(refundable)}</p>
      </section>

      <div className="board">
        <aside className="feed" aria-live="polite">
          <h2>What your agent is doing</h2>
          {view && view.log.length === 0 && <p className="empty">Nothing yet. Top up your balance, then ask for a car in the buyer view.</p>}
          <ul>{view?.log.map((l) => <li key={l.at + l.text}><time>{new Date(l.at).toLocaleTimeString("en-GB")}</time>{l.text}</li>)}</ul>
        </aside>
      </div>
    </div>
  );
}
