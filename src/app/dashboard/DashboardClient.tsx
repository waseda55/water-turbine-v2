'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calculate, getEfficiencyCurve } from '@/lib/turbine-calc'
import { exportJSON, exportCSV, exportExcel, importJSON } from '@/lib/export'
import type { TurbineInputs, TurbineResults, TurbineType, HQRange, NsRange } from '@/types'
import { useRouter } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

// ─── 型 ────────────────────────────────────────────────────────
interface HistoryRow {
  id: string; name: string; turbine_type: string
  turbine_power: number; specific_speed: number; created_at: string
  head: number; flow_rate: number
}
interface ProjectRow { id: string; name: string }

interface Props {
  user: { email: string }
  initialCalculations: HistoryRow[]
  initialProjects: ProjectRow[]
  hqRanges: HQRange[]
  nsRanges: NsRange[]
}

// ─── 流量単位変換 ──────────────────────────────────────────────
type FlowUnit = 'm3/s' | 'l/s' | 'm3/min' | 'm3/h' | 'l/min' | 'l/h'

const FLOW_UNITS: { key: FlowUnit; label: string; toM3s: number; dec: number; max: number; step: number }[] = [
  { key: 'm3/s',   label: 'm³/s',   toM3s: 1,          dec: 3, max: 200,    step: 0.001 },
  { key: 'l/s',    label: 'l/s',    toM3s: 0.001,      dec: 1, max: 200000, step: 0.1   },
  { key: 'm3/min', label: 'm³/min', toM3s: 1/60,       dec: 2, max: 12000,  step: 0.01  },
  { key: 'm3/h',   label: 'm³/h',   toM3s: 1/3600,     dec: 1, max: 720000, step: 0.1   },
  { key: 'l/min',  label: 'l/min',  toM3s: 1/60000,    dec: 0, max: 12e6,   step: 1     },
  { key: 'l/h',    label: 'l/h',    toM3s: 1/3600000,  dec: 0, max: 720e6,  step: 1     },
]
function toDisplayFlow(m3s: number, unit: FlowUnit): number {
  return m3s / FLOW_UNITS.find(u => u.key === unit)!.toM3s
}
function toM3s(val: number, unit: FlowUnit): number {
  return val * FLOW_UNITS.find(u => u.key === unit)!.toM3s
}

const DEFAULT_INPUTS: TurbineInputs = {
  head: 50, flowRate: 5, turbineEff: 88, generatorEff: 96,
  suctionHead: 2, altitude: 0, frequency: 50,
  powerFactor: 0.85, operatingHours: 8000, capacityFactor: 70,
  penstock: { length: 500, material: 'steel' },
}

// ─── Badge ────────────────────────────────────────────────────
function Badge({ result }: { result: string }) {
  const cls: Record<string, string> = { OK: 'badge-ok', NG: 'badge-ng', '注意': 'badge-warn', 'N/A': 'badge-info', INFO: 'badge-info' }
  return <span className={`badge ${cls[result] ?? 'badge-info'}`}>{result}</span>
}

// ─── H-Q 選定図 ──────────────────────────────────────────────
function HQChart({ head, flowRate, turbineType, hqRanges, flowUnit }: {
  head: number; flowRate: number; turbineType: string; hqRanges: HQRange[]; flowUnit: FlowUnit
}) {
  const W = 560, H = 380, pad = { top: 20, right: 30, bottom: 50, left: 60 }
  const cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom
  const Q_MIN = 0.05, Q_MAX = 600, H_MIN = 2, H_MAX = 1200
  const toX = (q: number) => pad.left + Math.log10(q / Q_MIN) / Math.log10(Q_MAX / Q_MIN) * cw
  const toY = (h: number) => pad.top + ch - Math.log10(h / H_MIN) / Math.log10(H_MAX / H_MIN) * ch
  const qTicks = [0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500]
  const hTicks = [2, 5, 10, 20, 50, 100, 200, 500, 1000]
  const ptStr = (pts: { q: number; h: number }[]) =>
    pts.map(p => `${toX(p.q).toFixed(1)},${toY(p.h).toFixed(1)}`).join(' ')
  const cx = toX(flowRate), cy = toY(head)
  const fu = FLOW_UNITS.find(u => u.key === flowUnit)!

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="var(--bg)" />
      {qTicks.map(q => <line key={q} x1={toX(q)} y1={pad.top} x2={toX(q)} y2={pad.top+ch} stroke="var(--border)" strokeWidth="1" />)}
      {hTicks.map(h => <line key={h} x1={pad.left} y1={toY(h)} x2={pad.left+cw} y2={toY(h)} stroke="var(--border)" strokeWidth="1" />)}
      {hqRanges.map(r => (
        <polygon key={r.id} points={ptStr(r.boundaryPoints)}
          fill={r.turbineType.color} fillOpacity="0.08"
          stroke={turbineType === r.turbineType.name ? r.turbineType.color : r.turbineType.color + '55'}
          strokeWidth={turbineType === r.turbineType.name ? 1.5 : 1}
          strokeDasharray={turbineType === r.turbineType.name ? '' : '4 3'} />
      ))}
      {hqRanges.map(r => {
        const p = r.boundaryPoints[0]
        return (
          <text key={r.id} x={toX(p.q * 1.3)} y={toY(p.h * 1.8)}
            fill={r.turbineType.color} fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace"
            opacity={turbineType === r.turbineType.name ? 1 : 0.5}>
            {r.turbineType.name.replace('水車', '')}
          </text>
        )
      })}
      {flowRate >= Q_MIN && flowRate <= Q_MAX && head >= H_MIN && head <= H_MAX && (
        <g>
          <line x1={cx} y1={pad.top} x2={cx} y2={pad.top+ch} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <line x1={pad.left} y1={cy} x2={pad.left+cw} y2={cy} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <polygon points={`${cx},${cy-8} ${cx+8},${cy} ${cx},${cy+8} ${cx-8},${cy}`} fill="var(--accent)" />
          <rect x={cx+12} y={cy-18} width={124} height={28} fill="var(--surface)" stroke="var(--accent)" strokeWidth="1" />
          <text x={cx+19} y={cy-5} fill="var(--accent)" fontSize="10" fontFamily="'JetBrains Mono', monospace" fontWeight="700">
            Q={toDisplayFlow(flowRate, flowUnit).toFixed(fu.dec)} {fu.label}
          </text>
          <text x={cx+19} y={cy+7} fill="var(--accent)" fontSize="10" fontFamily="'JetBrains Mono', monospace">H={head} m</text>
        </g>
      )}
      {qTicks.map(q => <text key={q} x={toX(q)} y={pad.top+ch+16} textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">{q}</text>)}
      <text x={pad.left+cw/2} y={H-4} textAnchor="middle" fill="var(--muted)" fontSize="11">設計流量 Q [{fu.label}]　※軸はm³/s基準</text>
      {hTicks.map(h => <text key={h} x={pad.left-8} y={toY(h)+4} textAnchor="end" fill="var(--muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">{h}</text>)}
      <text x={14} y={pad.top+ch/2} textAnchor="middle" fill="var(--muted)" fontSize="11"
        transform={`rotate(-90, 14, ${pad.top+ch/2})`}>有効落差 H [m]</text>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="none" stroke="var(--border)" strokeWidth="1" />
    </svg>
  )
}

// ─── Ns 分布図 ───────────────────────────────────────────────
function NsChart({ ns, turbineType, nsRanges }: { ns: number; turbineType: string; nsRanges: NsRange[] }) {
  const W = 560, H = 220, pad = { top: 24, right: 40, bottom: 40, left: 20 }
  const cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom
  const NS_MAX = 1000
  const toX = (n: number) => pad.left + (n / NS_MAX) * cw
  const rowH = 36
  const nsTicks = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
  const nsX = toX(Math.min(Math.max(ns, 0), NS_MAX))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="var(--bg)" />
      {nsTicks.map(t => <line key={t} x1={toX(t)} y1={pad.top} x2={toX(t)} y2={pad.top+ch} stroke="var(--border)" strokeWidth="1" />)}
      {nsRanges.map((r, i) => {
        const active = turbineType === r.turbineType.name
        const x1 = toX(r.nsMin), x2 = toX(r.nsMax)
        const barY = pad.top + i * rowH + 8
        return (
          <g key={r.id}>
            <rect x={pad.left} y={barY} width={cw} height={rowH - 4} fill={r.turbineType.color} fillOpacity="0.03" />
            <rect x={x1} y={barY + 6} width={x2 - x1} height={rowH - 16}
              fill={r.turbineType.color} fillOpacity={active ? 0.25 : 0.10}
              stroke={r.turbineType.color} strokeWidth={active ? 1.5 : 1} />
            <text x={pad.left + 6} y={barY + rowH/2 - 1}
              fill={active ? r.turbineType.color : 'var(--muted)'} fontSize="11"
              fontWeight={active ? '700' : '400'} dominantBaseline="middle">
              {r.turbineType.name}
            </text>
            <text x={x2 + 6} y={barY + rowH/2 - 1}
              fill={r.turbineType.color} fontSize="10" fontFamily="'JetBrains Mono', monospace"
              dominantBaseline="middle" opacity={active ? 1 : 0.5}>
              {r.nsMin}〜{r.nsMax}
            </text>
          </g>
        )
      })}
      <line x1={nsX} y1={pad.top} x2={nsX} y2={pad.top+ch} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
      <polygon points={`${nsX},${pad.top-8} ${nsX+5},${pad.top} ${nsX-5},${pad.top}`} fill="var(--accent)" />
      <rect x={nsX - 30} y={pad.top - 20} width={60} height={14} fill="var(--surface)" stroke="var(--accent)" strokeWidth="1" />
      <text x={nsX} y={pad.top - 9} textAnchor="middle" fill="var(--accent)" fontSize="10" fontFamily="'JetBrains Mono', monospace" fontWeight="700">
        Ns={ns.toFixed(1)}
      </text>
      {nsTicks.map(t => <text key={t} x={toX(t)} y={pad.top+ch+14} textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">{t}</text>)}
      <text x={pad.left+cw/2} y={H-2} textAnchor="middle" fill="var(--muted)" fontSize="11">比速度 Ns</text>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="none" stroke="var(--border)" strokeWidth="1" />
    </svg>
  )
}

// ─── FlowRateInput ───────────────────────────────────────────
function FlowRateInput({ flowRate, flowUnit, onFlowRateChange, onUnitChange }:
  { flowRate: number; flowUnit: FlowUnit; onFlowRateChange: (m3s: number) => void; onUnitChange: (unit: FlowUnit) => void }
) {
  const u = FLOW_UNITS.find(fu => fu.key === flowUnit)!
  const displayVal = toDisplayFlow(flowRate, flowUnit)
  const [raw, setRaw] = useState(parseFloat(displayVal.toFixed(u.dec)).toString())

  const commit = (rawStr: string) => {
    const num = parseFloat(rawStr)
    if (!isNaN(num) && num > 0) {
      const m3s = Math.max(0.0001, toM3s(num, flowUnit))
      onFlowRateChange(m3s)
      setRaw(parseFloat(toDisplayFlow(m3s, flowUnit).toFixed(u.dec)).toString())
    } else {
      setRaw(parseFloat(displayVal.toFixed(u.dec)).toString())
    }
  }

  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--muted)' }}>設計流量（Q）</span>
        <select value={flowUnit}
          onChange={e => {
            const nu = e.target.value as FlowUnit
            const newU = FLOW_UNITS.find(fu => fu.key === nu)!
            setRaw(parseFloat(toDisplayFlow(flowRate, nu).toFixed(newU.dec)).toString())
            onUnitChange(nu)
          }}
          style={{
            fontSize: 10, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--accent)', padding: '2px 6px', outline: 'none', cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
          {FLOW_UNITS.map(fu => <option key={fu.key} value={fu.key}>{fu.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={u.max} step={u.step} value={displayVal}
          onChange={e => {
            const v = Math.max(0.0001, toM3s(parseFloat(e.target.value), flowUnit))
            setRaw(parseFloat(toDisplayFlow(v, flowUnit).toFixed(u.dec)).toString())
            onFlowRateChange(v)
          }}
          className="flex-1" />
        <input type="text" inputMode="decimal" value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={() => commit(raw)}
          onKeyDown={e => e.key === 'Enter' && commit(raw)}
          style={{
            width: 72, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--accent)', textAlign: 'right', padding: '4px 6px',
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none',
            flexShrink: 0,
          }} />
      </div>
      <div className="flex justify-between mt-1 pr-20">
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>0 {u.label}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{u.max.toLocaleString()} {u.label}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right', marginTop: 2 }}>
        = {flowRate.toFixed(4)} m³/s
      </div>
    </div>
  )
}

// ─── SliderInput ─────────────────────────────────────────────
function SliderInput({ label, id, value, min, max, step, unit, dec = 1, onChange }:
  { label: string; id: string; value: number; min: number; max: number; step: number; unit: string; dec?: number; onChange: (v: number) => void }
) {
  const [raw, setRaw] = useState(parseFloat(value.toFixed(dec)).toString())
  const isFocused = useRef(false)

  useEffect(() => {
    if (!isFocused.current) setRaw(parseFloat(value.toFixed(dec)).toString())
  }, [value, dec])

  const commit = (rawStr: string) => {
    const num = parseFloat(rawStr)
    if (!isNaN(num)) {
      const clamped = Math.min(max, Math.max(min, num))
      setRaw(clamped.toFixed(dec)); onChange(clamped)
    } else { setRaw(parseFloat(value.toFixed(dec)).toString()) }
  }

  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <label htmlFor={id} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--muted)' }}>{label}</label>
        <div className="flex items-center gap-1.5">
          <input id={id} type="text" inputMode="decimal" value={raw}
            onFocus={() => { isFocused.current = true }}
            onChange={e => setRaw(e.target.value)}
            onBlur={() => { isFocused.current = false; commit(raw) }}
            onKeyDown={e => { if (e.key === 'Enter') commit(raw) }}
            style={{
              width: 66, textAlign: 'right', fontSize: 12, fontWeight: 700,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--accent)', padding: '3px 6px', outline: 'none',
              fontFamily: "'JetBrains Mono', monospace",
            }} />
          <span style={{ fontSize: 10, color: 'var(--muted)', width: 32, textAlign: 'right', flexShrink: 0 }}>{unit}</span>
        </div>
      </div>
      <div className="relative" style={{ height: 1, background: 'var(--border)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: pct + '%', height: '100%', background: 'var(--accent)', transition: 'width 0.05s' }} />
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ marginTop: -1, display: 'block', width: '100%' }} />
      <div className="flex justify-between" style={{ marginTop: 2 }}>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{min} {unit}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{max} {unit}</span>
      </div>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────
export default function DashboardClient({ user, initialCalculations, initialProjects, hqRanges, nsRanges }: Props) {
  const [inputs, setInputs] = useState<TurbineInputs>(DEFAULT_INPUTS)
  const [forcedType, setForcedType] = useState<TurbineType | null>(null)
  const [results, setResults] = useState<TurbineResults>(() => calculate(DEFAULT_INPUTS))
  const [history, setHistory] = useState<HistoryRow[]>(initialCalculations)
  const [projects] = useState<ProjectRow[]>(initialProjects)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportName, setExportName] = useState('')
  const [exportLoading, setExportLoading] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)
  const [sidebarTab, setSidebarTab] = useState<'history' | 'projects'>('history')
  const [mainTab, setMainTab] = useState<'result' | 'hq' | 'ns'>('result')
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('m3/s')
  const router = useRouter()
  const supabase = createClient()

  const update = useCallback((patch: Partial<TurbineInputs>) => {
    setInputs(prev => {
      const next = { ...prev, ...patch }
      setResults(calculate(next, forcedType ?? undefined))
      return next
    })
  }, [forcedType])

  const handleForcedType = useCallback((type: TurbineType | null) => {
    setForcedType(type)
    setInputs(prev => { setResults(calculate(prev, type ?? undefined)); return prev })
  }, [])

  const set = (key: keyof TurbineInputs) => (v: number) => update({ [key]: v })

  const typeColor =
    results.turbineType === 'ペルトン水車'     ? '#a78bfa'
    : results.turbineType === 'フランシス水車' ? '#38bdf8'
    : results.turbineType === 'カプラン水車'   ? '#34d399'
    : results.turbineType === 'クロスフロー水車' ? '#fb923c'
    : '#f472b6'  // チューブラ水車

  const effData = getEfficiencyCurve(results.turbineType, inputs.turbineEff / 100)

  const handleSave = async () => {
    if (!saveName.trim()) return
    setSaving(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { setSaving(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from('calculations').insert({
      user_id: authUser.id, project_id: selectedProjectId || null, name: saveName,
      head: inputs.head, flow_rate: inputs.flowRate, turbine_eff: inputs.turbineEff,
      generator_eff: inputs.generatorEff, suction_head: inputs.suctionHead,
      altitude: inputs.altitude, frequency: inputs.frequency,
      turbine_type: results.turbineType, turbine_power: results.turbinePower,
      generator_power: results.generatorPower, specific_speed: results.specificSpeed,
      rated_rpm: results.ratedRpm, poles: results.poles, runaway_speed: results.runawaySpeed,
      cavitation_coef: results.cavitationCoef, hs_max: results.hsMax,
      atm_pressure: results.atmPressure, check_cavitation: results.checks.cavitation.result,
      check_ns: results.checks.specificSpeed.result, check_altitude: results.checks.altitude.result,
    }).select().single()
    if (!error && data) {
      setHistory(prev => [data as unknown as HistoryRow, ...prev.slice(0, 19)])
      setShowSaveModal(false); setSaveName('')
    }
    setSaving(false)
  }

  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/auth/login') }
  const handleExportJSON  = () => { exportJSON(inputs, results, exportName || results.turbineType); setShowExportModal(false) }
  const handleExportCSV   = () => { exportCSV(inputs, results, exportName || results.turbineType);  setShowExportModal(false) }
  const handleExportExcel = async () => {
    setExportLoading('excel')
    try { await exportExcel(inputs, results, exportName || results.turbineType) } catch (e) { console.error(e) }
    finally { setExportLoading(null); setShowExportModal(false) }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImportMsg(null)
    try {
      const payload = await importJSON(file)
      setInputs(payload.inputs); setResults(calculate(payload.inputs, forcedType ?? undefined))
      setImportMsg({ type: 'ok', text: `「${payload.caseName}」を読み込みました` })
    } catch (err) {
      setImportMsg({ type: 'err', text: err instanceof Error ? err.message : '読み込みエラー' })
    }
    if (importFileRef.current) importFileRef.current.value = ''
    setTimeout(() => setImportMsg(null), 4000)
  }

  const loadHistory = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('calculations').select('*').eq('id', id).single()
    if (!data) return
    const restored: TurbineInputs = {
      head: data.head, flowRate: data.flow_rate, turbineEff: data.turbine_eff,
      generatorEff: data.generator_eff, suctionHead: data.suction_head,
      altitude: data.altitude, frequency: data.frequency as 50 | 60,
      powerFactor: data.power_factor ?? 0.85, operatingHours: data.operating_hours ?? 8000,
      capacityFactor: data.capacity_factor ?? 70,
      penstock: { length: data.penstock_length ?? 500, material: data.penstock_material ?? 'steel' },
    }
    setInputs(restored); setResults(calculate(restored, forcedType ?? undefined))
  }

  const fu = FLOW_UNITS.find(u => u.key === flowUnit)!

  const ModalBack = ({ children }: { children: React.ReactNode }) => (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
    }}>
      <div className="panel" style={{
        background: 'var(--surface)', width: '100%', maxWidth: 380, padding: 24,
        boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
      }}>
        {children}
      </div>
    </div>
  )

  const selStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none',
    fontFamily: "'Space Grotesk', sans-serif", cursor: 'pointer', width: '100%',
  }
  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none',
    fontFamily: "'Space Grotesk', sans-serif", width: '100%',
  }

  return (
    <div className={`min-h-screen flex flex-col ${theme}`} style={{ background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 20px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, var(--accent), ${typeColor})` }} />
        <div className="flex items-center gap-4" style={{ height: 52 }}>
          <div style={{ width: 32, height: 32, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--surface2)' }}>
            <div style={{ width: 14, height: 14, background: typeColor, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)', transition: 'background 0.3s' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)', lineHeight: 1.2 }}>水車選定ツール</div>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>HPP Design · 2026.05</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px', border: '1px solid var(--border)', background: 'var(--surface2)', marginLeft: 8 }}>
            <div style={{ width: 6, height: 6, background: typeColor, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: typeColor, letterSpacing: '0.04em' }}>{results.turbineType}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>
              {results.turbinePower.toFixed(0)} kW · Ns {results.specificSpeed.toFixed(0)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }} className="hidden sm:block">{user.email}</span>
            <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="btn" style={{ padding: '4px 8px', fontSize: 13 }}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            <button onClick={() => importFileRef.current?.click()} className="btn">読込</button>
            <button onClick={() => { setExportName(results.turbineType); setShowExportModal(true) }} className="btn btn-ok">出力</button>
            <button onClick={() => setShowSaveModal(true)} className="btn btn-accent">保存</button>
            <button onClick={handleLogout} className="btn">ログアウト</button>
          </div>
        </div>
      </header>

      {importMsg && (
        <div style={{
          position: 'fixed', top: 60, right: 16, zIndex: 200,
          padding: '8px 14px', border: `1px solid ${importMsg.type === 'ok' ? 'var(--ok)' : 'var(--ng)'}`,
          background: 'var(--surface)', fontSize: 11, fontWeight: 600,
          color: importMsg.type === 'ok' ? 'var(--ok)' : 'var(--ng)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}>
          {importMsg.text}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Inputs ── */}
        <aside style={{ width: 310, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '16px 16px 24px' }}>

          {/* 水車種類選択 — GitHubの新機能 */}
          <div className="sec-hd">水車種類</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 18 }}>
            <button onClick={() => handleForcedType(null)}
              style={{
                gridColumn: '1/-1', padding: '7px 0', fontSize: 11, fontWeight: 700,
                border: `1px solid ${forcedType === null ? 'var(--accent)' : 'var(--border)'}`,
                background: forcedType === null ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                color: forcedType === null ? 'var(--accent)' : 'var(--muted)',
                cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.04em',
              }}>
              🔄 自動選択（推奨）
            </button>
            {([
              { type: 'ペルトン水車'     as TurbineType, color: '#a78bfa', note: '高落差・低流量' },
              { type: 'フランシス水車'   as TurbineType, color: '#38bdf8', note: '中落差・中流量' },
              { type: 'カプラン水車'     as TurbineType, color: '#34d399', note: '低落差・大流量' },
              { type: 'クロスフロー水車' as TurbineType, color: '#fb923c', note: '低〜中落差・小流量' },
              { type: 'チューブラ水車'   as TurbineType, color: '#f472b6', note: '超低落差・大流量' },
            ]).map(({ type, color, note }) => (
              <button key={type} onClick={() => handleForcedType(type)}
                style={{
                  padding: '6px 0', fontSize: 10, fontWeight: 600,
                  border: `1px solid ${forcedType === type ? color : 'var(--border)'}`,
                  background: forcedType === type ? `color-mix(in srgb, ${color} 10%, transparent)` : 'var(--surface2)',
                  color: forcedType === type ? color : 'var(--muted)',
                  cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.4,
                }}>
                <div>{type.replace('水車', '')}</div>
                <div style={{ fontSize: 8, opacity: 0.7, fontWeight: 400 }}>{note}</div>
              </button>
            ))}
          </div>
          {forcedType && (
            <div style={{ marginBottom: 16, padding: '8px 10px', border: '1px solid var(--border)', borderLeft: '2px solid var(--warn)', background: 'color-mix(in srgb, var(--warn) 6%, transparent)', fontSize: 11, color: 'var(--warn)', lineHeight: 1.6 }}>
              ⚠ 強制指定モード：条件に最適でない水車も計算できますが、判定結果にご注意ください。
            </div>
          )}

          <div className="sec-hd">基本パラメータ</div>
          <SliderInput label="有効落差（H）" id="H" value={inputs.head} min={2} max={1000} step={1} unit="m" dec={0} onChange={set('head')} />
          <FlowRateInput flowRate={inputs.flowRate} flowUnit={flowUnit}
            onFlowRateChange={v => update({ flowRate: v })} onUnitChange={setFlowUnit} />
          <SliderInput label="水車効率（η_t）"   id="eta_t" value={inputs.turbineEff}   min={70}  max={95}   step={0.1} unit="%" dec={1} onChange={set('turbineEff')} />
          <SliderInput label="発電機効率（η_g）" id="eta_g" value={inputs.generatorEff} min={90}  max={99}   step={0.1} unit="%" dec={1} onChange={set('generatorEff')} />

          <div className="sec-hd" style={{ marginTop: 16 }}>設置条件</div>
          <SliderInput label="吸出し高さ（Hs）" id="Hs"  value={inputs.suctionHead} min={-5} max={15}   step={0.1} unit="m" dec={1} onChange={set('suctionHead')} />
          <SliderInput label="設置標高"          id="alt" value={inputs.altitude}    min={0}  max={3000} step={10}  unit="m" dec={0} onChange={set('altitude')} />

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.03em' }}>電源周波数（f）</div>
            <div className="flex gap-1.5">
              {([50, 60] as const).map(f => (
                <button key={f} onClick={() => update({ frequency: f })}
                  style={{
                    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700,
                    border: `1px solid ${inputs.frequency === f ? 'var(--accent)' : 'var(--border)'}`,
                    background: inputs.frequency === f ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                    color: inputs.frequency === f ? 'var(--accent)' : 'var(--muted)',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: "'JetBrains Mono', monospace",
                  }}>
                  {f} Hz<br />
                  <span style={{ fontSize: 9, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 400 }}>{f === 50 ? '東日本' : '西日本'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sec-hd" style={{ marginTop: 16 }}>電気系パラメータ</div>
          <SliderInput label="力率（cos φ）" id="pf" value={inputs.powerFactor}    min={0.70} max={1.00} step={0.01} unit=""     dec={2} onChange={v => update({ powerFactor: v })} />
          <SliderInput label="年間稼働時間"   id="oh" value={inputs.operatingHours} min={1000} max={8760} step={100}  unit="h/年" dec={0} onChange={v => update({ operatingHours: v })} />
          <SliderInput label="設備利用率"     id="cf" value={inputs.capacityFactor} min={10}   max={100}  step={1}    unit="%"    dec={0} onChange={v => update({ capacityFactor: v })} />

          <div className="sec-hd" style={{ marginTop: 16 }}>導水管パラメータ</div>
          <SliderInput label="導水管延長" id="pl" value={inputs.penstock.length} min={10} max={5000} step={10} unit="m" dec={0}
            onChange={v => update({ penstock: { ...inputs.penstock, length: v } })} />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.03em' }}>管種</div>
            <div className="flex gap-1.5">
              {([{ key: 'steel', label: '鋼管' }, { key: 'ductile', label: 'ダクタイル' }, { key: 'frp', label: 'FRP' }] as const).map(m => (
                <button key={m.key} onClick={() => update({ penstock: { ...inputs.penstock, material: m.key } })}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600,
                    border: `1px solid ${inputs.penstock.material === m.key ? 'var(--accent)' : 'var(--border)'}`,
                    background: inputs.penstock.material === m.key ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                    color: inputs.penstock.material === m.key ? 'var(--accent)' : 'var(--muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16, padding: '10px 12px', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 4%, transparent)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.7 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.04em' }}>HPP Design</span>（45 Engineering, Italy）比較版<br />
            主要静的項目は±3%以内で一致。動的項目の差はCFD相当の詳細計算によるものです。<br />
            概略選定・比較検討用。詳細設計には製造者への確認が必要です。
          </div>
        </aside>

        {/* ── CENTER: Results ── */}
        <main className="flex-1 overflow-y-auto min-w-0 flex flex-col" style={{ background: 'var(--bg)' }}>
          <div style={{ display: 'flex', gap: 0, padding: '0 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
            {([{ id: 'result', label: '計算結果' }, { id: 'hq', label: 'H-Q 選定図' }, { id: 'ns', label: 'Ns 分布図' }] as const).map(tab => (
              <button key={tab.id} onClick={() => setMainTab(tab.id)} className={`tab ${mainTab === tab.id ? 'active' : ''}`}>{tab.label}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>

            {/* ══ TAB: 計算結果 ══ */}
            {mainTab === 'result' && (<>
              <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${typeColor}, transparent)` }} />
                <div className="flex items-start gap-4 mb-4">
                  <div style={{ width: 48, height: 48, border: `1px solid ${typeColor}40`, background: `${typeColor}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                    <div style={{ width: 20, height: 20, background: typeColor, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' }} />
                    {[[0,0],[48,0],[0,48],[48,48]].map(([x,y],i) => (
                      <div key={i} style={{ position: 'absolute', width: 3, height: 3, background: `${typeColor}80`, top: y === 0 ? -1 : 'auto', bottom: y === 48 ? -1 : 'auto', left: x === 0 ? -1 : 'auto', right: x === 48 ? -1 : 'auto' }} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 20, fontWeight: 700, color: typeColor, letterSpacing: '0.02em', lineHeight: 1.2 }}>{results.turbineType}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
                      H={inputs.head}m · Q={toDisplayFlow(inputs.flowRate, flowUnit).toFixed(fu.dec)} {fu.label} · {inputs.frequency}Hz · Ns={results.specificSpeed.toFixed(1)}
                      {forcedType && <span style={{ color: 'var(--warn)', marginLeft: 8 }}>【強制指定】</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
                  {[
                    { label: '水車出力 Pw',  val: results.turbinePower.toFixed(1),   unit: 'kW' },
                    { label: '発電機出力',   val: results.generatorPower.toFixed(1), unit: 'kW' },
                    { label: '比速度 Ns',    val: results.specificSpeed.toFixed(1),  unit: 'm·kW' },
                    { label: '定格回転速度', val: Math.round(results.ratedRpm),      unit: 'rpm' },
                    { label: '極数',         val: results.poles,                     unit: 'P' },
                    { label: '暴走速度',     val: Math.round(results.runawaySpeed),  unit: 'rpm' },
                  ].map(k => (
                    <div key={k.label} className="kpi-tile">
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', lineHeight: 1.15 }}>{k.val}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{k.label}<br /><span style={{ fontSize: 8, opacity: 0.7 }}>{k.unit}</span></div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {[
                    { label: 'キャビテーション', ...results.checks.cavitation },
                    { label: '比速度の妥当性',   ...results.checks.specificSpeed },
                    { label: '標高・大気圧低下', ...results.checks.altitude },
                    { label: '暴走速度',         result: 'INFO', message: results.checks.runaway.message },
                  ].map(c => (
                    <div key={c.label} style={{ border: '1px solid var(--border)', background: 'var(--surface2)', padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Badge result={c.result} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{c.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{c.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                {[{ label: '管路損失', ...results.checks.headLoss }, { label: '水撃圧', ...results.checks.waterHammer }].map(c => (
                  <div key={c.label} className="panel" style={{ padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Badge result={c.result} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{c.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{c.message}</div>
                    </div>
                  </div>
                ))}
              </div>

              {results.dimensions.pelton && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">💧 ペルトン水車　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ジェット数 J', `${results.dimensions.pelton.numJets} 本`],
                      ['ジェット径 d', `${(results.dimensions.pelton.jetDiameter * 1000).toFixed(1)} mm`],
                      ['D/d 比', results.dimensions.pelton.dOverD.toFixed(2)],
                      ['バケット内幅 B2', `${(results.dimensions.pelton.bucketWidth * 1000).toFixed(1)} mm`],
                      ['D/B 比', results.dimensions.pelton.dOverB.toFixed(2)],
                      ['バケット数', `${results.dimensions.pelton.numBuckets} 枚`],
                      ['最小流量 Qmin', `${(results.dimensions.pelton.minFlow * 1000).toFixed(2)} l/s`],
                      ['ランナーピッチ径 D1', `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {results.dimensions.francis && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">🌊 フランシス水車　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['アウトレット径 D2e', `${(results.dimensions.francis.outletDiameter * 1000).toFixed(1)} mm`],
                      ['入口径 D01', `${(results.dimensions.francis.inletDiameter * 1000).toFixed(1)} mm`],
                      ['ガイドベーン高さ Bd', `${(results.dimensions.francis.guideVaneHeight * 1000).toFixed(1)} mm`],
                      ['スパイラルケーシング径', `${(results.dimensions.francis.spiralCaseInlet * 1000).toFixed(1)} mm`],
                      ['ランナーブレード数', `${results.dimensions.francis.numBlades} 枚`],
                      ['ガイドベーン数', `${results.dimensions.francis.numGuideVanes} 枚`],
                      ['最小流量 Qmin', `${(results.dimensions.francis.minFlow * 1000).toFixed(1)} l/s`],
                      ['暴走時流量 Qr', `${(results.dimensions.francis.flowAtRunaway * 1000).toFixed(1)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {results.dimensions.crossflow && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">🌊 クロスフロー水車（Banki-Michell）　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ランナー径 D',   `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                      ['ランナー幅 B',   `${(results.dimensions.crossflow.runnerWidth * 1000).toFixed(1)} mm`],
                      ['B/D 比',        results.dimensions.crossflow.aspectRatio.toFixed(2)],
                      ['ブレード数',     `${results.dimensions.crossflow.numBlades} 枚`],
                      ['入射角',         `${results.dimensions.crossflow.attackAngle}°`],
                      ['最小流量 Qmin', `${(results.dimensions.crossflow.minFlow * 1000).toFixed(2)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: '7px 10px', background: 'color-mix(in srgb, #fb923c 6%, transparent)', border: '1px solid color-mix(in srgb, #fb923c 30%, transparent)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                    衝動式・横流れ形式。部分負荷特性に優れ、流量変動が大きい小水力サイトに適する。ランナーは製作が容易でメンテナンス性が高い。適用落差：2〜200 m / 適用流量：0.02〜10 m³/s
                  </div>
                </div>
              )}
              {results.dimensions.tubular && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">💧 チューブラ水車（貫流型）　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ランナー径 D',         `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                      ['ハブ径 Dh',            `${(results.dimensions.tubular.hubDiameter * 1000).toFixed(1)} mm`],
                      ['ハブ比 Dh/D',          results.dimensions.tubular.hubRatio.toFixed(3)],
                      ['ランナーブレード数',    `${results.dimensions.tubular.numBlades} 枚`],
                      ['ガイドベーン数',        `${results.dimensions.tubular.numGuideVanes} 枚`],
                      ['DTコーン角（半角）',    `${results.dimensions.tubular.coneAngle}°`],
                      ['最小流量 Qmin',         `${(results.dimensions.tubular.minFlow * 1000).toFixed(1)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: '7px 10px', background: 'color-mix(in srgb, #f472b6 6%, transparent)', border: '1px solid color-mix(in srgb, #f472b6 30%, transparent)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                    反動式・水平軸・軸流型。超低落差大流量に適し、河川・農業用水路に多用される。水平設置により土木コスト低減が期待できる。適用落差：2〜30 m / 適用流量：1〜100 m³/s
                  </div>
                </div>
              )}
              {results.dimensions.kaplan && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">🌀 カプラン水車　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ランナーブレード数', `${results.dimensions.kaplan.numBlades} 枚`],
                      ['ガイドベーン数', `${results.dimensions.kaplan.numGuideVanes} 枚`],
                      ['ハブ径 Dh', `${(results.dimensions.kaplan.hubDiameter * 1000).toFixed(1)} mm`],
                      ['ハブ比 Dh/D', results.dimensions.kaplan.hubRatio.toFixed(3)],
                      ['最小流量 Qmin', `${(results.dimensions.kaplan.minFlow * 1000).toFixed(1)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                {[
                  { title: '📐 寸法系（共通）', rows: [
                    ['ランナー径 D', `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                    ['吸出し管径', results.dimensions.draftTubeDiameter != null ? `${(results.dimensions.draftTubeDiameter * 1000).toFixed(1)} mm` : '—（衝動式）'],
                    ['ケーシング概略径', results.dimensions.casingDiameter != null ? `${(results.dimensions.casingDiameter * 1000).toFixed(1)} mm` : '—'],
                    ['導水管径', `${(results.dimensions.penstockDiameter * 1000).toFixed(1)} mm`],
                    ['導水管流速', `${results.dimensions.penstockVelocity.toFixed(1)} m/s`],
                  ]},
                  { title: '💧 水理・構造系', rows: [
                    ['GD²', `${results.hydraulics.gd2.toFixed(2)} kN·m²`],
                    ['水撃圧 ΔH', `${results.hydraulics.waterHammerHead.toFixed(1)} m`],
                    ['水撃圧上昇率', `+${results.hydraulics.waterHammerRise.toFixed(1)} %`],
                    ['管路損失 hf', `${results.hydraulics.penstock.headLoss.toFixed(2)} m`],
                    ['管路損失率', `${results.hydraulics.penstock.headLossRatio.toFixed(1)} %`],
                  ]},
                  { title: '⚡ 電気系', rows: [
                    ['発電機容量', `${results.electrical.generatorKva.toFixed(1)} kVA`],
                    ['力率', `${(inputs.powerFactor * 100).toFixed(0)} %`],
                    ['年間稼働時間', `${inputs.operatingHours.toLocaleString()} h/年`],
                    ['設備利用率', `${inputs.capacityFactor} %`],
                    ['年間発電量', `${results.electrical.annualEnergy.toFixed(1)} MWh`],
                  ], highlight: results.electrical.annualEnergy >= 1000
                    ? `${results.electrical.annualEnergyGwh.toFixed(3)} GWh`
                    : `${results.electrical.annualEnergy.toFixed(1)} MWh`
                  },
                ].map(card => (
                  <div key={card.title} className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd" style={{ fontSize: 8 }}>{card.title}</div>
                    {card.rows.map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                    {'highlight' in card && card.highlight && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ok)', fontFamily: "'JetBrains Mono', monospace" }}>{card.highlight}</div>
                        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.08em' }}>年間発電量</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="panel" style={{ padding: 14 }}>
                  <div className="sec-hd">効率曲線 η(Q/Qd)</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={effData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--muted)', fontFamily: 'JetBrains Mono' }} tickFormatter={v => v + '%'} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)', fontFamily: 'JetBrains Mono' }} tickFormatter={v => v + '%'} />
                      <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, fontSize: 11, fontFamily: 'JetBrains Mono' }}
                        formatter={(v: number, name: string) => [v.toFixed(1) + '%', name]} labelFormatter={v => `Q/Qd = ${v}%`} />
                      {[
                        { key: 'フランシス水車',   color: '#38bdf8', dash: '' },
                        { key: 'カプラン水車',     color: '#34d399', dash: '4 3' },
                        { key: 'ペルトン水車',    color: '#a78bfa', dash: '2 2' },
                        { key: 'クロスフロー水車', color: '#fb923c', dash: '6 2' },
                        { key: 'チューブラ水車',   color: '#f472b6', dash: '1 3' },
                      ].map(({ key, color, dash }) => (
                        <Line key={key} type="monotone" dataKey={key}
                          stroke={results.turbineType === key ? color : color + '44'}
                          strokeWidth={results.turbineType === key ? 2 : 1}
                          strokeDasharray={dash} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="panel" style={{ padding: 14 }}>
                  <div className="sec-hd">詳細計算値</div>
                  <div style={{ overflowY: 'auto', maxHeight: 220 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['項目', '値', '区分'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '3px 4px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['水車形式', results.turbineType, '静的'],
                          ['定格回転速度', Math.round(results.ratedRpm) + ' rpm', '静的'],
                          ['極数', results.poles + ' P', '静的'],
                          ['比速度 Ns', results.specificSpeed.toFixed(2), '静的'],
                          ['水車出力 Pw', results.turbinePower.toFixed(2) + ' kW', '静的'],
                          ['発電機出力 Pe', results.generatorPower.toFixed(2) + ' kW', '静的'],
                          ['暴走速度', Math.round(results.runawaySpeed) + ' rpm', '動的'],
                          ['許容吸出し高さ', results.hsMax != null ? results.hsMax.toFixed(2) + ' m' : '—', '動的'],
                          ['大気圧（補正後）', results.atmPressure.toFixed(3) + ' kPa', '動的'],
                          ['σ_c（キャビ係数）', results.cavitationCoef != null ? results.cavitationCoef.toFixed(5) : '—', '導出'],
                          ...(results.dimensions.pelton ? [
                            ['── ペルトン ──', '', ''],
                            ['ジェット数 J', String(results.dimensions.pelton.numJets) + ' 本', '導出'],
                            ['ジェット径 d', (results.dimensions.pelton.jetDiameter * 1000).toFixed(1) + ' mm', '導出'],
                            ['D/d 比', results.dimensions.pelton.dOverD.toFixed(2), '導出'],
                            ['バケット内幅 B2', (results.dimensions.pelton.bucketWidth * 1000).toFixed(1) + ' mm', '導出'],
                            ['バケット数', String(results.dimensions.pelton.numBuckets) + ' 枚', '導出'],
                            ['最小流量 Qmin', (results.dimensions.pelton.minFlow * 1000).toFixed(2) + ' l/s', '導出'],
                          ] : []),
                          ...(results.dimensions.francis ? [
                            ['── フランシス ──', '', ''],
                            ['入口径 D01', (results.dimensions.francis.inletDiameter * 1000).toFixed(1) + ' mm', '導出'],
                            ['ガイドベーン高さ', (results.dimensions.francis.guideVaneHeight * 1000).toFixed(1) + ' mm', '導出'],
                            ['ケーシング入口径', (results.dimensions.francis.spiralCaseInlet * 1000).toFixed(1) + ' mm', '導出'],
                            ['ブレード数', String(results.dimensions.francis.numBlades) + ' 枚', '導出'],
                            ['最小流量 Qmin', (results.dimensions.francis.minFlow * 1000).toFixed(1) + ' l/s', '導出'],
                            ['暴走時流量 Qr', (results.dimensions.francis.flowAtRunaway * 1000).toFixed(1) + ' l/s', '導出'],
                          ] : []),
                          ...(results.dimensions.kaplan ? [
                            ['── カプラン ──', '', ''],
                            ['ブレード数', String(results.dimensions.kaplan.numBlades) + ' 枚', '導出'],
                            ['ハブ径 Dh', (results.dimensions.kaplan.hubDiameter * 1000).toFixed(1) + ' mm', '導出'],
                            ['ハブ比 Dh/D', results.dimensions.kaplan.hubRatio.toFixed(3), '導出'],
                            ['最小流量 Qmin', (results.dimensions.kaplan.minFlow * 1000).toFixed(1) + ' l/s', '導出'],
                          ] : []),
                        ].map(([label, val, type], i) => (
                          <tr key={label + i} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)', background: label.startsWith('──') ? 'transparent' : i % 2 === 0 ? 'color-mix(in srgb, var(--accent) 2%, transparent)' : 'transparent' }}>
                            <td style={{ padding: '4px', fontSize: 10, color: label.startsWith('──') ? 'var(--accent)' : 'var(--muted)', fontStyle: label.startsWith('──') ? 'italic' : 'normal' }}>{label}</td>
                            <td style={{ padding: '4px', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: 'var(--accent)' }}>{val}</td>
                            <td style={{ padding: '4px', fontSize: 9, color: 'var(--muted)' }}>{type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>)}

            {/* ══ TAB: H-Q ══ */}
            {mainTab === 'hq' && (
              <div className="panel" style={{ padding: 16 }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>H-Q 形式選定図</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>有効落差 H [m] と設計流量 Q [m³/s] による水車形式の適用範囲</div>
                  </div>
                  <div className="flex gap-4">
                    {hqRanges.map(r => (
                      <div key={r.id} className="flex items-center gap-1.5">
                        <div style={{ width: 8, height: 8, background: r.turbineType.color }} />
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.turbineType.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <HQChart head={inputs.head} flowRate={inputs.flowRate} turbineType={results.turbineType} hqRanges={hqRanges} flowUnit={flowUnit} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
                  {hqRanges.map(r => {
                    const inRange = inputs.head >= r.hMin && inputs.head <= r.hMax && inputs.flowRate >= r.qMin && inputs.flowRate <= r.qMax
                    return (
                      <div key={r.id} style={{ padding: '10px 12px', border: `1px solid ${inRange ? r.turbineType.color + '60' : 'var(--border)'}`, background: inRange ? `${r.turbineType.color}08` : 'var(--surface2)', transition: 'all 0.15s' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div style={{ width: 6, height: 6, background: r.turbineType.color }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: inRange ? r.turbineType.color : 'var(--muted)' }}>{r.turbineType.name}</span>
                          {inRange && <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>適用可</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.8 }}>
                          H: {r.hMin}〜{r.hMax} m<br />Q: {r.qMin}〜{r.qMax} m³/s
                        </div>
                        {r.note && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{r.note}</div>}
                        {r.source && <div style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6, marginTop: 2 }}>出典: {r.source}</div>}
                      </div>
                    )
                  })}
                </div>
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 10, textAlign: 'right' }}>※ 適用範囲は一般的な参考値です。詳細は製造者にご確認ください。</p>
              </div>
            )}

            {/* ══ TAB: Ns ══ */}
            {mainTab === 'ns' && (
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>比速度 Ns 分布図</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Ns = n × √Pw ÷ H<sup>1.25</sup>　による形式選定の基準</div>
                </div>
                <NsChart ns={results.specificSpeed} turbineType={results.turbineType} nsRanges={nsRanges} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
                  {nsRanges.map(r => {
                    const inRange = results.specificSpeed >= r.nsMin && results.specificSpeed <= r.nsMax
                    return (
                      <div key={r.id} style={{ padding: '10px 12px', border: `1px solid ${inRange ? r.turbineType.color + '60' : 'var(--border)'}`, background: inRange ? `${r.turbineType.color}08` : 'var(--surface2)', transition: 'all 0.15s' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span style={{ fontSize: 16 }}>{r.turbineType.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: inRange ? r.turbineType.color : 'var(--muted)' }}>{r.turbineType.name}</span>
                          {inRange && <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>該当</span>}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: r.turbineType.color, marginBottom: 8 }}>Ns: {r.nsMin} 〜 {r.nsMax}</div>
                        <div style={{ height: 2, background: 'var(--border)' }}>
                          <div style={{ height: '100%', background: r.turbineType.color, opacity: inRange ? 1 : 0.2, width: '100%' }} />
                        </div>
                        {inRange && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>現在値 Ns = <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: r.turbineType.color }}>{results.specificSpeed.toFixed(1)}</span></div>}
                        {r.overlapNote && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{r.overlapNote}</div>}
                        {r.source && <div style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6, marginTop: 2 }}>出典: {r.source}</div>}
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                  <strong style={{ color: 'var(--text)' }}>Ns の算出式：</strong>　Ns = n × √Pw ÷ H<sup>1.25</sup><br />
                  ペルトンとフランシスの適用範囲（Ns 60〜100）は重複します。フランシスとカプランの境界（Ns 250〜400）も同様です。
                </div>
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, textAlign: 'right' }}>※ Ns範囲は一般的な参考値です。詳細は製造者にご確認ください。</p>
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT: Sidebar ── */}
        <aside style={{ width: 220, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
            {(['history', 'projects'] as const).map(t => (
              <button key={t} onClick={() => setSidebarTab(t)} className={`tab flex-1 ${sidebarTab === t ? 'active' : ''}`} style={{ fontSize: 10 }}>
                {t === 'history' ? '履歴' : 'プロジェクト'}
              </button>
            ))}
          </div>
          {sidebarTab === 'history' && (
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.length === 0 && <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>保存された計算がありません</p>}
              {history.map(h => (
                <button key={h.id} onClick={() => loadHistory(h.id)}
                  style={{ textAlign: 'left', padding: '8px 10px', cursor: 'pointer', width: '100%', border: '1px solid var(--border)', background: 'var(--surface2)', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{h.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.turbine_type} · {h.turbine_power.toFixed(0)} kW</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>H={h.head}m Q={h.flow_rate}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6, marginTop: 3 }}>{new Date(h.created_at).toLocaleString('ja-JP')}</div>
                </button>
              ))}
            </div>
          )}
          {sidebarTab === 'projects' && (
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projects.length === 0 && <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>プロジェクトがありません</p>}
              {projects.map(p => (
                <div key={p.id} style={{ padding: '8px 10px', border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* ── Save Modal ── */}
      {showSaveModal && (
        <ModalBack>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 16 }}>計算結果を保存</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ケース名 *</div>
            <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="例：A案　H=50m Q=5m³/s" style={{ ...inputStyle }} />
          </div>
          {projects.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>プロジェクト（任意）</div>
              <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={selStyle}>
                <option value="">なし</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ padding: '8px 10px', marginBottom: 14, border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            {results.turbineType} · Pw={results.turbinePower.toFixed(1)} kW · Ns={results.specificSpeed.toFixed(1)}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowSaveModal(false)} className="btn flex-1" style={{ justifyContent: 'center' }}>キャンセル</button>
            <button onClick={handleSave} disabled={saving || !saveName.trim()} className="btn btn-accent flex-1" style={{ justifyContent: 'center' }}>
              {saving ? '保存中…' : '保存する'}
            </button>
          </div>
        </ModalBack>
      )}

      {/* ── Export Modal ── */}
      {showExportModal && (
        <ModalBack>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>ローカル出力</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>計算結果をお使いのPCに保存します</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ファイル名</div>
            <input autoFocus value={exportName} onChange={e => setExportName(e.target.value)} placeholder={results.turbineType} style={{ ...inputStyle }} />
          </div>
          <div style={{ padding: '8px 10px', marginBottom: 14, border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.8 }}>
            {results.turbineType}<br />H={inputs.head}m · Q={inputs.flowRate} m³/s · {inputs.frequency}Hz<br />Pw={results.turbinePower.toFixed(2)} kW · Ns={results.specificSpeed.toFixed(1)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {[
              { icon: 'xlsx', label: 'Excel (.xlsx)', desc: '全パラメータ・判定結果を2シートで出力', color: 'var(--ok)', action: handleExportExcel, loading: exportLoading === 'excel' },
              { icon: 'json', label: 'JSON (.json)',  desc: '入力値＋全計算結果。「読込」ボタンで再インポート可', color: 'var(--accent)', action: handleExportJSON, loading: false },
              { icon: 'csv',  label: 'CSV (.csv)',    desc: 'Excelで開ける軽量フォーマット', color: 'var(--warn)', action: handleExportCSV, loading: false },
            ].map(opt => (
              <button key={opt.label} onClick={opt.action} disabled={opt.loading}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${opt.color}`, cursor: 'pointer', transition: 'all 0.15s', background: `color-mix(in srgb, ${opt.color} 8%, transparent)`, opacity: opt.loading ? 0.6 : 1 }}
                onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${opt.color} 18%, transparent)`)}
                onMouseLeave={e => (e.currentTarget.style.background = `color-mix(in srgb, ${opt.color} 8%, transparent)`)}>
                <div style={{ width: 32, height: 32, border: `1px solid ${opt.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: opt.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em', flexShrink: 0 }}>
                  {opt.icon.toUpperCase()}
                </div>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: opt.color }}>{opt.loading ? '生成中…' : opt.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{opt.desc}</div>
                </div>
                <span style={{ color: opt.color, fontSize: 14, opacity: 0.6 }}>↓</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowExportModal(false)} className="btn" style={{ width: '100%', justifyContent: 'center' }}>閉じる</button>
        </ModalBack>
      )}
    </div>
  )
}
