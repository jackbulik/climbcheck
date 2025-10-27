
import React, { useMemo, useState, useEffect } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceDot } from "recharts";

/********************
 * ClimbCheck — Koch Chart Calculator (v6.4.2 RC)
 ********************/

/************ Utilities ************/
function round(n: number, d: number = 0) { const p = Math.pow(10, d); return Math.round((n + Number.EPSILON) * p) / p; }
function cToF(c: number) { return c * 9 / 5 + 32; }
function fToC(f: number) { return (f - 32) * 5 / 9; }
function ftToM(ft: number){ return ft * 0.3048; }
function isaTempAtElevationC(altFt: number) { return 15 - 1.98 * (altFt / 1000); }
function pressureAltitudeFromAltimeterFt(fieldElevFt: number, altInHg: number) { return (29.92 - altInHg) * 1000 + fieldElevFt; }
function densityAltitudeRuleOfThumbFt(paFt: number, tempC: number, fieldElevFt: number) { const isa = isaTempAtElevationC(fieldElevFt); return paFt + 120 * (tempC - isa); }
function inHgToHpa(inHg: number){ return inHg * 33.8638866667; }
function hpaToInHg(hpa: number){ return hpa * 0.0295299830714; }
function nz(n:number){ return Number.isFinite(n) ? n : 0; }

/************ Precise DA helpers ************/
const P0=101325, T0=288.15, L=0.0065, g=9.80665, R=8.314462618, M=0.0289644;
const nExp = g*M/(R*L);          // ~5.25588
const Rd   = 287.05;             // J/(kg·K) dry air
const rho0 = 1.225;              // kg/m^3 sea-level ISA
const eps  = 0.622;              // Mw/Md
function stdPressureAtAltitude(pa_m:number){ const ratio=1-(L*pa_m)/T0; return P0*Math.pow(ratio,nExp); }
function preciseDensityAltitudeFt(paFt:number,tempC:number,dewC?:number|null){
  const h_m = paFt * 0.3048; const p = stdPressureAtAltitude(h_m); const T = tempC + 273.15; let Tv = T;
  if (dewC!=null && isFinite(dewC)) { const e_hPa = 6.112 * Math.exp((17.67*dewC)/(dewC+243.5)); const p_hPa = p/100; const r = Math.max(0, Math.min(0.1, eps * e_hPa / Math.max(1e-6, (p_hPa - e_hPa)))); Tv = T * (1 + r/eps) / (1 + r); }
  const rho = p/(Rd*Tv); const expo = 1/(nExp-1); const term = Math.pow(rho/rho0, expo); const h_m_da = (T0/L)*(1-term); return h_m_da/0.3048;
}

/************ METAR parsing & decoding ************/
function parseMetar(raw:string){
  const tokens=(raw||"").replace("="," ").split(/\s+/).map(t=>t.trim()).filter(Boolean);
  let tempC: number | null = null; let altInHg: number | null = null;
  for(const t of tokens){
    if (tempC==null && t.includes("/") && t.length>=4){ const [tpart]=t.split("/"); if (tpart){ const isM=tpart.startsWith("M"); const d=isM?tpart.slice(1):tpart; if(/^\d{1,2}$/.test(d)) tempC=(isM?-1:1)*Number(d); } }
    if (altInHg==null && /^A\d{4}$/.test(t)) altInHg = Number(t.slice(1))/100; else if (altInHg==null && /^Q\d{4}$/.test(t)) altInHg = hpaToInHg(Number(t.slice(1)));
  }
  return { tempC, altInHg };
}
function parseMetarPrecise(raw: string){
  const tokens = (raw || "").replace("=", " ").split(/\s+/).map(t => t.trim()).filter(Boolean);
  let tempC: number | null = null; let dewC: number | null = null; let altInHg: number | null = null; let altHpa: number | null = null; let altUnit: 'A'|'Q'|null = null;
  for (const t of tokens){ if (/^T\d{8}$/.test(t)){ const s1 = t[1]==='1'?-1:1; const s2 = t[5]==='1'?-1:1; tempC = s1*(Number(t.slice(2,5))/10); dewC  = s2*(Number(t.slice(6,9))/10); } }
  for (const t of tokens){
    if ((tempC==null || dewC==null) && t.includes("/")){
      const [ta,da] = t.split("/");
      if (tempC==null && ta){ const neg=ta.startsWith('M'); const val=Number(neg?ta.slice(1):ta); if (isFinite(val)) tempC = neg?-val:val; }
      if (dewC==null  && da){ const neg=da.startsWith('M'); const val=Number(neg?da.slice(1):da); if (isFinite(val)) dewC  = neg?-val:val; }
    }
    if (altInHg==null && /^A\d{4}$/.test(t)) { altInHg = Number(t.slice(1))/100; altHpa = inHgToHpa(altInHg); altUnit='A'; }
    else if (altInHg==null && /^Q\d{4}$/.test(t)) { altHpa = Number(t.slice(1)); altInHg = hpaToInHg(altHpa); altUnit='Q'; }
  }
  return { tempC, dewC, altInHg, altHpa, altUnit };
}
function parseMetarMore(raw:string){
  const base=parseMetar(raw); const tokens=(raw||"").replace("="," ").split(/\s+/).map(t=>t.trim()).filter(Boolean);
  let wind: string | null = null; let visSM: string | null = null; let clouds:string[]=[]; let wx:string[]=[]; let type=''; let time='';
  if(tokens.length){ type = tokens[0]; const tt = tokens.find(t=>/\d{6}Z/.test(t)); if(tt) time=tt; }
  for(const t of tokens){
    if (/^(\d{3}|VRB)\d{2,3}(G\d{2,3})?KT$/.test(t)) wind = t;
    if (/^(\d{1,2}|\d?\/\d)SM$/.test(t)) visSM = t;
    if (/^(FEW|SCT|BKN|OVC)\d{3}/.test(t)) clouds.push(t);
    if (/^(RA|SN|FG|BR|HZ|TS|DZ|SH|SQ|FZ|PL)/.test(t)) wx.push(t);
  }
  return { ...base, wind, visSM, clouds, wx, type, time };
}
function getFlightCategory(visStr:string|null, clouds:string[]){
  const vis = visStr && visStr.includes('SM') ? parseFloat(visStr.replace('SM','')) : NaN;
  let ceiling = 99999;
  for (const c of clouds){ const type=c.slice(0,3); const height=Number(c.slice(3))*100; if(['BKN','OVC'].includes(type)) ceiling=Math.min(ceiling,height); }
  if(!isFinite(vis) || vis===0) return {cat:'UNK',color:'text-slate-500'};
  if (ceiling<500 || vis<1) return {cat:'LIFR',color:'text-purple-600'};
  if (ceiling<1000 || vis<3) return {cat:'IFR',color:'text-red-600'};
  if (ceiling<=3000 || vis<=5) return {cat:'MVFR',color:'text-blue-600'};
  return {cat:'VFR',color:'text-emerald-600'};
}
function DecodedMetar({ raw }:{ raw:string }){
  if (!raw) return null;
  const base  = parseMetarMore(raw);
  const pprec = parseMetarPrecise(raw);
  const tokens = (raw || "").replace("="," ").split(/\s+/).map(t=>t.trim()).filter(Boolean);
  const qTok = tokens.find(t => /^Q\d{4}$/.test(t));
  const aTok = tokens.find(t => /^A\d{4}$/.test(t));
  let altLine = '–';
  if (qTok) { const qv = Number(qTok.slice(1)); altLine = `QNH ${Math.round(qv)} hPa / ${round(hpaToInHg(qv),2)} inHg`; }
  else if (aTok) { const av = Number(aTok.slice(1))/100; altLine = `${round(av,2)} inHg / QNH ${Math.round(inHgToHpa(av))} hPa`; }
  else if (base.altInHg != null) { altLine = `${round(base.altInHg,2)} inHg / QNH ${Math.round(inHgToHpa(base.altInHg))} hPa`; }
  const cat = getFlightCategory(base.visSM, base.clouds);
  return (
    <div className="mb-3 text-xs text-slate-700 border-t pt-2">
      <div className="font-semibold mb-1">Decoded METAR</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1">
        <div><span className="text-slate-500">Type:</span> {base.type}</div>
        <div><span className="text-slate-500">Time:</span> {base.time}</div>
        <div><span className="text-slate-500">Temp:</span> {base.tempC!=null ? `${base.tempC} °C / ${round(cToF(base.tempC),1)} °F` : '–'}</div>
        <div><span className="text-slate-500">Dew:</span> {pprec.dewC!=null ? `${round(pprec.dewC,1)} °C / ${round(cToF(pprec.dewC),1)} °F` : '–'}</div>
        <div><span className="text-slate-500">Altimeter:</span> {altLine}</div>
        <div><span className="text-slate-500">Wind:</span> {base.wind ?? '–'}</div>
        <div><span className="text-slate-500">Vis:</span> {base.visSM ?? '–'}</div>
        <div><span className="text-slate-500">Clouds:</span> {base.clouds.join(', ')||'–'}</div>
        <div><span className="text-slate-500">WX:</span> {base.wx.join(' ')||'–'}</div>
        <div className={cat.color}><span className="text-slate-500">Flight Cat:</span> <span className="font-medium">{cat.cat}</span></div>
      </div>
    </div>
  );
}

/************ Graph ************/
function KochGraph({ paFt, tempC, fieldElevFt, mode, dewC }:{ paFt:number; tempC:number; fieldElevFt:number; mode:'rot'|'precise'|'legacy'; dewC?:number|null; }){
  const data = useMemo(() => {
    const pts: { xTemp:number; toPct:number; rocPct:number }[] = []; const base = isFinite(tempC) ? tempC : 15; const start = Math.floor(base - 25); const end = Math.ceil(base + 25);
    for (let t = start; t <= end; t++){
      const da = mode==='precise'? preciseDensityAltitudeFt(paFt, t, dewC) : densityAltitudeRuleOfThumbFt(paFt, t, fieldElevFt);
      const toF = (mode==='legacy' ? (1 + 0.125*(da/1000)) : (1 + 0.15*(da/1000)));
      const rocF = mode==='legacy' ? NaN : Math.max(0, 1 - 0.075*(da/1000));
      const rocPctVal = mode==='legacy' ? (0.096*(da/1000)*100) : ((1-rocF)*100);
      pts.push({ xTemp:t, toPct:(toF-1)*100, rocPct: rocPctVal });
    }
    return pts;
  }, [paFt, tempC, fieldElevFt, mode, dewC]);
  const current = useMemo(() => {
    if (!isFinite(paFt) || !isFinite(tempC) || !isFinite(fieldElevFt)) return null;
    const da = mode==='precise'? preciseDensityAltitudeFt(paFt, tempC, dewC) : densityAltitudeRuleOfThumbFt(paFt, tempC, fieldElevFt);
    return { xTemp: tempC, toPct:(((mode==='legacy' ? (1 + 0.125*(da/1000)) : (1 + 0.15*(da/1000)))) - 1)*100, rocPct:(mode==='legacy' ? (0.096*(da/1000)*100) : ((1 - Math.max(0, 1 - 0.075*(da/1000)))*100)) };
  }, [paFt, tempC, fieldElevFt, mode, dewC]);
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
          <XAxis type="number" dataKey="xTemp" name="Temperature" unit="°C" stroke="#374151" />
          <YAxis yAxisId="left"  orientation="left"  domain={[0,'auto']} tickFormatter={(v)=>`${Math.round(v)}%`} label={{ value: '% Increase (TO)', angle: -90, position: 'insideLeft', fill:'#374151' }} />
          <YAxis yAxisId="right" orientation="right" domain={[0,'auto']} tickFormatter={(v)=>`${Math.round(v)}%`} label={{ value: '% Decrease (ROC)', angle:  90, position: 'insideRight', fill:'#374151' }} />
          <Tooltip formatter={(v: number) => `${round(v,1)}%`} labelFormatter={(l) => `Temp ${l} °C`} />
          <Legend />
          <Line yAxisId="left"  type="monotone" dataKey="toPct"  name="Takeoff Distance +%" stroke="#8b0000" strokeWidth={2.5} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="rocPct" name={"ROC −%"} stroke="#004d4d" strokeWidth={2.5} dot={false} />
          {current && <ReferenceDot x={current.xTemp} y={current.toPct} r={5} yAxisId="left" fill="#8b0000" />}
          {current && <ReferenceDot x={current.xTemp} y={current.rocPct} r={5} yAxisId="right" fill="#004d4d" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/************ Authentic Runway Graphic ************/
function RunwayGraphic({ rwFt, requiredFt, ok, overByFt, pctUsed }:{ rwFt:number; requiredFt:number; ok:boolean; overByFt:number; pctUsed:number; }){
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>0 ft</span>
        <span>{isFinite(rwFt) ? `${Math.round(rwFt)} ft runway` : ''}</span>
      </div>
      <div className="relative w-full overflow-hidden rounded-md border border-slate-300" style={{ height: 64, background: '#3a3a3a', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.25)' }} aria-label="Runway usage graphic">
        {/* Usage overlay */}
        <div className="absolute left-0 top-0 bottom-0" style={{ width: `${pctUsed}%`, background: ok ? 'rgba(16,185,129,0.6)' : 'rgba(244,63,94,0.6)', transition: 'width 200ms ease', zIndex: 0 }} />
        {/* Piano keys only */}
        <div className="absolute left-1 top-1 bottom-1 w-9" style={{ background: 'repeating-linear-gradient(180deg, #fff 0, #fff 6px, transparent 6px, transparent 12px)', opacity: 0.92, zIndex: 3 }} />
        <div className="absolute right-1 top-1 bottom-1 w-9" style={{ background: 'repeating-linear-gradient(180deg, #fff 0, #fff 6px, transparent 6px, transparent 12px)', opacity: 0.92, zIndex: 3 }} />
        {/* Runway numbers beyond keys */}
        <div className="absolute left-12 top-1/2 select-none" style={{ transform: 'translateY(-50%) rotate(90deg)', zIndex: 5 }}>
          <span className="font-black text-white/90" style={{ fontSize: 28, letterSpacing: 2 }}>18</span>
        </div>
        <div className="absolute right-12 top-1/2 select-none" style={{ transform: 'translateY(-50%) rotate(-90deg)', zIndex: 5 }}>
          <span className="font-black text-white/90" style={{ fontSize: 28, letterSpacing: 2 }}>9</span>
        </div>
        {/* Distance ticks */}
        {[25,50,75,100].map((p)=> (
          <div key={p} className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: `${p}%`, zIndex: 2 }} />
        ))}
        {/* Overrun label */}
        {!ok && (
          <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-2 text-[10px] font-semibold text-white" style={{ zIndex: 6 }}>
            Over by {Math.round(overByFt)} ft
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.6)' }} /> Required distance</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-slate-400" /> Runway surface</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: 'rgba(244,63,94,0.6)' }} /> Insufficient runway</span>
      </div>
    </div>
  );
}

/************ Main App ************/
export default function App(){
  const [icao, setIcao] = useState("");
  const [proxy] = useState<string>("https://api.allorigins.win/raw?url=");
  const wrap = (url: string) => { const p=(proxy??"").trim(); try{ const full = (p? `${p}${encodeURIComponent(url)}` : url); new URL(full); return full; }catch{ return url; } };

  const [metarRaw, setMetarRaw] = useState("");
  const [metarStatus, setMetarStatus] = useState("Enter ICAO/LID and click Fetch");
  const [fieldElevation, setFieldElevation] = useState<string>(""); // ft
  const [tempUnit, setTempUnit] = useState<'C'|'F'>("C");
  const [tempVal, setTempVal] = useState<string>("");
  const [paVal, setPaVal] = useState<string>("");
  const [altimeterInHg, setAltimeterInHg] = useState<number|null>(null);
  const [runwayLen, setRunwayLen] = useState<string>("");
  const [runwayUnit, setRunwayUnit] = useState<'ft'|'m'>("ft");
  const [baselineTO, setBaselineTO] = useState<string>("");
  const [baselineUnit, setBaselineUnit] = useState<'ft'|'m'>("ft");
  const [kochMode, setKochMode] = useState<'rot'|'precise'|'legacy'>("precise");
  const [showGraph, setShowGraph] = useState(false);

  // Derived values & validation
  const fieldElevValid = useMemo(() => { const s = (fieldElevation ?? "").trim(); if (s === '') return false; const v = Number(s); return isFinite(v); }, [fieldElevation]);
  const fieldElevFt = useMemo(()=>{ const v=Number(fieldElevation); return isFinite(v)? v : 0; },[fieldElevation]);
  const parsedTempC = useMemo(()=>{ const s = (tempVal ?? '').trim(); if (s==='') return NaN; const v = Number(s); if(!isFinite(v)) return NaN; return tempUnit==='C'?v:fToC(v); },[tempVal,tempUnit]);
  const parsedPA    = useMemo(()=>{ const s = (paVal ?? '').trim(); if (s==='') return NaN; const v=Number(s); return isFinite(v)? v : NaN; },[paVal]);
  const { tempC: tempExactC, dewC: dewExactC } = useMemo(()=>parseMetarPrecise(metarRaw),[metarRaw]);

  // Auto-recompute PA when field elevation changes and we have altimeter
  useEffect(() => { if (altimeterInHg != null) { const pa = pressureAltitudeFromAltimeterFt(fieldElevFt, altimeterInHg); setPaVal(String(Math.round(pa))); } }, [fieldElevFt, altimeterInHg]);

  const densityAltRotFt = useMemo(() => densityAltitudeRuleOfThumbFt(parsedPA, parsedTempC, fieldElevFt), [parsedPA, parsedTempC, fieldElevFt]);
  const densityAltPreciseFt = useMemo(() => (!isFinite(parsedPA) || tempExactC==null) ? NaN : preciseDensityAltitudeFt(parsedPA, tempExactC, dewExactC), [parsedPA, tempExactC, dewExactC]);
  const daForKoch = useMemo(() => { const v = (kochMode==='precise' ? densityAltPreciseFt : densityAltRotFt); return Number.isFinite(v) ? v : 0; }, [kochMode, densityAltPreciseFt, densityAltRotFt]);
  const toPct  = useMemo(() => { const mul = (kochMode==='legacy' ? (1 + 0.125*(daForKoch/1000)) : (1 + 0.15*(daForKoch/1000))); return Math.max(0, (mul - 1) * 100); }, [daForKoch, kochMode]);
  const rocPct = useMemo(() => (kochMode==='legacy' ? (0.096*(daForKoch/1000)*100) : Math.max(0, (1 - Math.max(0, 1 - 0.075*(daForKoch/1000))) * 100)), [daForKoch, kochMode]);

  /************ Fetch METAR ************/
  const doFetchMetar = async (): Promise<{raw:string; usedId:string}|null> => {
    const base = icao.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(base)) { setMetarStatus("Invalid station ID (use ICAO or FAA LID e.g., KSMO or F70)"); return null; }
    const candidates = Array.from(new Set([
      (!base.startsWith('K') && base.length === 3 ? `K${base}` : null),
      base,
      (!base.startsWith('K') && base.length === 4 ? `K${base}` : null)
    ].filter(Boolean)));
    setMetarStatus(`Fetching METAR… (${candidates.join(' → ')})`);
    const endpointsFor = (id:string) => [
      `https://aviationweather.gov/api/data/metar?ids=${id}&format=raw&hours=1`,
      `https://aviationweather.gov/adds/dataserver_current/httpparam?dataSource=metars&requestType=retrieve&format=xml&hoursBeforeNow=2&stationString=${id}`
    ];
    for (const id of candidates){
      for (const ep of endpointsFor(id)){
        try {
          const url = wrap(ep); const res = await fetch(url); if (!res.ok) throw new Error(String(res.status)); const txt = await res.text(); if (/<!DOCTYPE/i.test(txt)) continue; // ignore HTML
          const m = txt.match(/<raw_text>([^<]+)<\/raw_text>/i); let raw = m ? m[1].trim() : '';
          if (!raw) raw = (txt || "").split(/\r?\n+/).map(s => s.trim()).filter(Boolean)[0] || '';
          if (raw && /(METAR|SPECI|^\w{3,4}\s\d{6}Z)/.test(raw)) return { raw, usedId: id };
        } catch (e) { /* try next */ }
      }
    }
    setMetarStatus("Fetch failed (try ICAO like KF70). Paste METAR manually if needed.");
    return null;
  };
  const fetchMetarAndCompute = async () => {
    const res = await doFetchMetar(); if (!res) return; const { raw, usedId } = res; setMetarRaw(raw); setMetarStatus(`Fetched ${usedId}`);
    const { altInHg, tempC } = parseMetar(raw);
    if (altInHg != null) { setAltimeterInHg(altInHg); const pa = pressureAltitudeFromAltimeterFt(fieldElevFt, altInHg); setPaVal(String(Math.round(pa))); }
    if (tempC != null) setTempVal(String(tempUnit==='C' ? tempC : round(cToF(tempC),1)));
  };
  const onTempUnitChange = (next:'C'|'F') => { const v = Number(tempVal); if (isFinite(v)) { if (tempUnit==='C' && next==='F') setTempVal(String(round(cToF(v),1))); if (tempUnit==='F' && next==='C') setTempVal(String(round(fToC(v),1))); } setTempUnit(next); };

  return (
    <div className="w-full p-4 text-slate-800 min-h-screen bg-white">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">ClimbCheck — Koch Chart Calculator</h1>
        <p className="text-sm text-slate-600">Compare Rule-of-thumb vs Precise (humidity-corrected) Density Altitude, and drive Koch with your choice.</p>
      </header>

      {/* Airport & METAR */}
      <section className="mb-4 p-4 rounded-2xl shadow-sm bg-white">
        <h2 className="text-lg font-semibold mb-2">Airport & METAR</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input className="rounded border p-2 sm:w-48" value={icao} onChange={e=>setIcao(e.target.value.toUpperCase())} placeholder="ICAO/LID (e.g., KSMO or F70)" />
          <button className="rounded bg-slate-900 px-3 py-2 text-white" onClick={fetchMetarAndCompute}>Fetch METAR & Auto-fill</button>
        </div>
        <div className="text-xs text-slate-500 mb-2">{metarStatus}</div>
        <textarea className="w-full border p-2 rounded mb-2" rows={3} value={metarRaw} onChange={e=>setMetarRaw(e.target.value)} />
        <DecodedMetar raw={metarRaw} />
      </section>

      {/* Inputs */}
      <section className="mb-4 p-4 rounded-2xl shadow-sm bg-white">
        <h2 className="text-lg font-semibold mb-2">Inputs</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Field Elevation (ft)
            <input className={`mt-1 w-full rounded border p-2 ${!fieldElevValid ? 'border-rose-400 bg-rose-50' : ''}`} value={fieldElevation} onChange={e=>setFieldElevation(e.target.value)} />
            {!fieldElevValid && (<div className="mt-1 text-xs text-rose-600">Enter field elevation (can be 0 or negative for below-sea-level airports).</div>)}
          </label>
          <label className="text-sm">Temperature
            <div className="mt-1 flex gap-2">
              <input className="w-full rounded border p-2" value={tempVal} onChange={e=>setTempVal(e.target.value)} />
              <select className="rounded border px-3 py-2" value={tempUnit} onChange={(e)=>onTempUnitChange(e.target.value as 'C'|'F')}>
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
            </div>
          </label>
          <label className="text-sm">Pressure Altitude (ft)
            <input className="mt-1 w-full rounded border p-2" value={paVal} onChange={e=>setPaVal(e.target.value)} />
          </label>
        </div>
      </section>

      {/* Results */}
      <section className="mb-4 p-4 rounded-2xl shadow-sm bg-white">
        <h2 className="text-lg font-semibold mb-2">Conditions & Koch Results</h2>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">Use for Koch:</span>
          <label className="inline-flex items-center gap-1"><input type="radio" name="koch" checked={kochMode==='precise'} onChange={()=>setKochMode('precise')} /> <span>Precise</span></label>
          <label className="inline-flex items-center gap-1"><input type="radio" name="koch" checked={kochMode==='legacy'} onChange={()=>setKochMode('legacy')} /> <span>Legacy Koch</span></label>
          <label className="inline-flex items-center gap-1"><input type="radio" name="koch" checked={kochMode==='rot'} onChange={()=>setKochMode('rot')} /> <span>Rule-of-thumb</span></label>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div>Temp: <span className="font-medium">{isFinite(parsedTempC) ? `${round(parsedTempC,1)} °C / ${round(cToF(parsedTempC),1)} °F` : '–'}</span></div>
          <div>PA: <span className="font-medium">{isFinite(parsedPA) ? `${round(parsedPA)} ft` : '–'}</span></div>
          <div>DA (Rule-of-thumb): <span className="font-medium">{isFinite(densityAltRotFt) ? `${round(densityAltRotFt)} ft` : '–'}</span></div>
          <div>DA (Precise): <span className="font-medium">{isFinite(densityAltPreciseFt) ? `${round(densityAltPreciseFt)} ft` : '–'}</span></div>
          <div>TO Dist +% (from {kochMode==='precise'?'Precise':(kochMode==='legacy'?'Legacy Koch':'Rule-of-thumb')} DA): <span className="font-medium">{round(toPct,1)}%</span></div>
          <div>{kochMode==='legacy' ? 'Engine Power −%' : 'ROC −%'} (from {kochMode==='precise'?'Precise':'Rule-of-thumb'} DA): <span className="font-medium">{round(rocPct,1)}%</span></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Advisory use only. Always consult AFM/POH and official weather products.</p>
      </section>

      {/* Runway & Takeoff Distance */}
      <section className="mb-4 p-4 rounded-2xl shadow-sm bg-white">
        <h2 className="mb-2 text-lg font-semibold">Runway & Takeoff Distance</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">Runway Length
            <div className="mt-1 flex gap-2">
              <input className="w-full rounded border p-2" value={runwayLen} onChange={(e)=>setRunwayLen(e.target.value)} placeholder="e.g., 3800" />
              <select className="rounded border px-3 py-2" value={runwayUnit} onChange={(e)=>{ const next=e.target.value as 'ft'|'m'; const v=Number(runwayLen); if(isFinite(v)){ if(runwayUnit==='ft'&&next==='m') setRunwayLen(String(round(v*0.3048,1))); if(runwayUnit==='m'&&next==='ft') setRunwayLen(String(Math.round(v/0.3048))); } setRunwayUnit(next); }}>
                <option value="ft">ft</option>
                <option value="m">m</option>
              </select>
            </div>
          </label>
          <label className="text-sm">Baseline TO Distance (POH, sea-level/std day)
            <div className="mt-1 flex gap-2">
              <input className="w-full rounded border p-2" value={baselineTO} onChange={(e)=>setBaselineTO(e.target.value)} placeholder="e.g., 1200" />
              <select className="rounded border px-3 py-2" value={baselineUnit} onChange={(e)=>{ const next=e.target.value as 'ft'|'m'; const v=Number(baselineTO); if(isFinite(v)){ if(baselineUnit==='ft'&&next==='m') setBaselineTO(String(round(v*0.3048,1))); if(baselineUnit==='m'&&next==='ft') setBaselineTO(String(Math.round(v/0.3048))); } setBaselineUnit(next); }}>
                <option value="ft">ft</option>
                <option value="m">m</option>
              </select>
            </div>
          </label>
        </div>
        {(() => {
          const rw  = Number(runwayLen);
          const base = Number(baselineTO);
          const rwFt = runwayUnit==='ft' ? (isFinite(rw)?rw:0) : (isFinite(rw)?rw/0.3048:0);
          const baseFt = baselineUnit==='ft' ? (isFinite(base)?base:0) : (isFinite(base)?base/0.3048:0);

          // Only compute "real" results when both inputs are provided (>0)
          const hasInputs = rwFt > 0 && baseFt > 0;
          const hasRunway = rwFt > 0;

          const effDA = nz(daForKoch);
          const multiplier = kochMode==='legacy' ? (1 + 0.125*(effDA/1000)) : (1 + 0.15*(effDA/1000));

          const requiredFt = hasInputs ? (baseFt * multiplier) : 0;
          const marginFt   = hasInputs ? (rwFt - requiredFt) : 0;
          const ok         = hasInputs ? (marginFt >= 0) : true; // default OK when empty
          const isaEquivalentFt = (hasRunway && multiplier>0) ? (rwFt / multiplier) : 0;

          const pctUsed = hasInputs ? Math.max(0, Math.min(100, (requiredFt / rwFt) * 100)) : 0;
          const overByFt = hasInputs ? Math.max(0, requiredFt - rwFt) : 0;

          return (
            <div className="mt-3 grid gap-3 text-sm">
              <div>Estimated Required TO Distance: <span className="font-medium">{Math.round(requiredFt)} ft</span> ({round(ftToM(requiredFt),0)} m)</div>
              <div>Runway Margin: <span className={`font-medium ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>{ok?'+':''}{Math.round(marginFt)} ft</span></div>
              <div>In these conditions, a runway of <span className="font-medium">{Math.round(rwFt)} ft</span> (<span className="font-medium">{Math.round(ftToM(rwFt))} m</span>) would be equivalent to an ISA sea-level runway length of <span className="font-medium">{Math.round(isaEquivalentFt)} ft</span> (<span className="font-medium">{Math.round(ftToM(isaEquivalentFt))} m</span>).</div>
              {(hasInputs && !ok) && <div className="text-xs text-rose-600">Warning: Estimated distance exceeds runway length.</div>}

              <RunwayGraphic rwFt={rwFt} requiredFt={requiredFt} ok={ok} overByFt={overByFt} pctUsed={pctUsed} />
            </div>
          );
        })()}
      </section>

      {/* Performance Models Explained + Advanced Graph toggle */}
      <section className="mb-4 p-4 rounded-2xl shadow-sm bg-white">
        <h2 className="mb-1 text-lg font-semibold">Performance Models Explained</h2>
        <p className="mb-3 text-xs text-slate-500">Choose a model to suit your mission: precision for analysis, legacy for comparison, rule-of-thumb for quick estimates.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border border-slate-200 rounded-md overflow-hidden">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Formula</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <tr>
                <td className="px-3 py-2 font-medium">Precise</td>
                <td className="px-3 py-2 align-top">Physics-based density (station pressure + temperature + humidity) → DA → Koch</td>
                <td className="px-3 py-2 align-top">Most accurate for current conditions; uses virtual temperature from dewpoint to correct air density.</td>
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-2 font-medium">Legacy Koch</td>
                <td className="px-3 py-2 align-top">ΔTO = +12.5% / 1000 ft DA<br/>ΔPower = −9.6% / 1000 ft DA</td>
                <td className="px-3 py-2 align-top">Matches the classic Koch chart / legacy tools for training references and direct comparison.</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Rule-of-thumb</td>
                <td className="px-3 py-2 align-top">DA ≈ PA + 120×(OAT−ISA)<br/>ΔTO = +15% / 1000 ft DA<br/>ΔROC = −7.5% / 1000 ft DA</td>
                <td className="px-3 py-2 align-top">Fast cockpit estimate using density altitude only; good intuition, less precise.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <button className="rounded bg-slate-900 px-3 py-2 text-white text-sm" onClick={() => setShowGraph(v => !v)} aria-expanded={showGraph}>
            {showGraph ? 'Hide Performance Graph' : 'Show Performance Graph (Advanced)'}
          </button>
          {showGraph && (
            <div className="mt-4">
              <KochGraph paFt={nz(parsedPA)} tempC={isFinite(parsedTempC)?parsedTempC:15} fieldElevFt={fieldElevFt} mode={kochMode} dewC={dewExactC} />
            </div>
          )}
        </div>
      </section>

      <footer className="mt-8 text-xs text-slate-500"><p>Advisory use only. Always consult AFM/POH performance charts and official weather products.</p></footer>
    </div>
  );
}
