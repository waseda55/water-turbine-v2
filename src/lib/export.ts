/**
 * 水車選定ツール — ローカルエクスポート / インポートユーティリティ
 *
 * 提供機能:
 *   exportJSON   — 入力値＋計算結果を JSON ファイルとしてダウンロード
 *   exportCSV    — 主要パラメータを CSV ファイルとしてダウンロード
 *   exportExcel  — Excel (XLSX) ファイルとしてダウンロード（SheetJS 使用）
 *   importJSON   — JSON ファイルから TurbineInputs を復元
 */

import type { TurbineInputs, TurbineResults } from '@/types'

// ─── 共通ヘルパー ──────────────────────────────────────────────────────────────
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function timestamp() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '_',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join('')
}

// ─── JSON エクスポート ─────────────────────────────────────────────────────────
export interface ExportPayload {
  version:    string
  exportedAt: string
  caseName:   string
  inputs:     TurbineInputs
  results:    TurbineResults
}

export function exportJSON(
  inputs:   TurbineInputs,
  results:  TurbineResults,
  caseName: string = '無題'
) {
  const payload: ExportPayload = {
    version:    '1.0',
    exportedAt: new Date().toISOString(),
    caseName,
    inputs,
    results,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const safe = caseName.replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(blob, `turbine_${safe}_${timestamp()}.json`)
}

// ─── JSON インポート ───────────────────────────────────────────────────────────
export function importJSON(file: File): Promise<ExportPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const payload = JSON.parse(e.target?.result as string) as ExportPayload
        if (!payload.inputs || !payload.results) {
          reject(new Error('このファイルは有効な水車選定データではありません'))
          return
        }
        resolve(payload)
      } catch {
        reject(new Error('JSON の解析に失敗しました'))
      }
    }
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
    reader.readAsText(file)
  })
}

// ─── CSV エクスポート ──────────────────────────────────────────────────────────
export function exportCSV(
  inputs:   TurbineInputs,
  results:  TurbineResults,
  caseName: string = '無題'
) {
  const r = results
  const i = inputs
  const d = r.dimensions
  const h = r.hydraulics
  const e = r.electrical

  const rows: unknown[][] = [
    ['ケース名', '—', caseName],
    ['エクスポート日時', '—', new Date().toLocaleString('ja-JP')],
    ['', '', ''],
    ['【入力条件】', '', ''],
    ['有効落差 H', 'm', i.head],
    ['設計流量 Q', 'm³/s', i.flowRate],
    ['水車効率 η_t', '%', i.turbineEff],
    ['発電機効率 η_g', '%', i.generatorEff],
    ['吸出し高さ Hs', 'm', i.suctionHead],
    ['設置標高', 'm', i.altitude],
    ['電源周波数 f', 'Hz', i.frequency],
    ['力率 cosφ', '—', i.powerFactor],
    ['年間稼働時間', 'h/年', i.operatingHours],
    ['設備利用率', '%', i.capacityFactor],
    ['導水管延長', 'm', i.penstock.length],
    ['管種', '—', i.penstock.material],
    ['', '', ''],
    ['【水車仕様】', '', ''],
    ['水車形式', '—', r.turbineType],
    ['比速度 Ns', '—', r.specificSpeed.toFixed(2)],
    ['定格回転速度 n', 'rpm', Math.round(r.ratedRpm)],
    ['極数', '極', r.poles],
    ['暴走速度 nr', 'rpm', Math.round(r.runawaySpeed)],
    ['', '', ''],
    ['【出力・効率】', '', ''],
    ['水車出力 Pw', 'kW', r.turbinePower.toFixed(2)],
    ['発電機出力 Pe', 'kW', r.generatorPower.toFixed(2)],
    ['', '', ''],
    ['【主要寸法（共通）】', '', ''],
    ['ランナー径 D', 'mm', (d.runnerDiameter * 1000).toFixed(1)],
    ['吸出し管径', 'mm', d.draftTubeDiameter != null ? (d.draftTubeDiameter * 1000).toFixed(1) : '—'],
    ['ケーシング概略径', 'mm', d.casingDiameter != null ? (d.casingDiameter * 1000).toFixed(1) : '—'],
    ['導水管径', 'mm', (d.penstockDiameter * 1000).toFixed(1)],
    ['導水管流速', 'm/s', d.penstockVelocity.toFixed(1)],
    ['', '', ''],
    ...(d.pelton ? [
      ['【ペルトン水車　専用パラメータ】', '', ''],
      ['ジェット数 J',        '本',  String(d.pelton.numJets)],
      ['ジェット径 d',        'mm',  (d.pelton.jetDiameter * 1000).toFixed(1)],
      ['D/d 比',              '—',   d.pelton.dOverD.toFixed(2)],
      ['バケット内幅 B2',     'mm',  (d.pelton.bucketWidth * 1000).toFixed(1)],
      ['D/B 比',              '—',   d.pelton.dOverB.toFixed(2)],
      ['バケット数',           '枚',  String(d.pelton.numBuckets)],
      ['最小流量 Qmin',       'l/s', (d.pelton.minFlow * 1000).toFixed(2)],
    ] : []),
    ...(d.francis ? [
      ['【フランシス水車　専用パラメータ】', '', ''],
      ['アウトレット径 D2e',   'mm',  (d.francis.outletDiameter * 1000).toFixed(1)],
      ['入口径 D01',           'mm',  (d.francis.inletDiameter * 1000).toFixed(1)],
      ['ガイドベーン高さ Bd',  'mm',  (d.francis.guideVaneHeight * 1000).toFixed(1)],
      ['スパイラルケーシング径','mm', (d.francis.spiralCaseInlet * 1000).toFixed(1)],
      ['ランナーブレード数',   '枚',  String(d.francis.numBlades)],
      ['ガイドベーン数',       '枚',  String(d.francis.numGuideVanes)],
      ['最小流量 Qmin',        'l/s', (d.francis.minFlow * 1000).toFixed(1)],
      ['暴走時流量 Qr',        'l/s', (d.francis.flowAtRunaway * 1000).toFixed(1)],
    ] : []),
    ...(d.kaplan ? [
      ['【カプラン水車　専用パラメータ】', '', ''],
      ['ランナーブレード数',   '枚',  String(d.kaplan.numBlades)],
      ['ガイドベーン数',       '枚',  String(d.kaplan.numGuideVanes)],
      ['ハブ径 Dh',           'mm',  (d.kaplan.hubDiameter * 1000).toFixed(1)],
      ['ハブ比 Dh/D',         '—',   d.kaplan.hubRatio.toFixed(3)],
      ['最小流量 Qmin',        'l/s', (d.kaplan.minFlow * 1000).toFixed(1)],
    ] : []),
    ['', '', ''],
    ['【水理・構造系】', '', ''],
    ['GD²', 'kN·m²', h.gd2.toFixed(3)],
    ['水撃圧上昇値 ΔH', 'm', h.waterHammerHead.toFixed(2)],
    ['水撃圧上昇率', '%', h.waterHammerRise.toFixed(1)],
    ['管路損失 hf', 'm', h.penstock.headLoss.toFixed(3)],
    ['管路損失率', '%', h.penstock.headLossRatio.toFixed(2)],
    ['', '', ''],
    ['【電気系】', '', ''],
    ['発電機容量', 'kVA', e.generatorKva.toFixed(2)],
    ['年間発電量', 'MWh/年', e.annualEnergy.toFixed(2)],
    ['年間発電量', 'GWh/年', e.annualEnergyGwh.toFixed(4)],
    ['', '', ''],
    ['【判定結果】', '', ''],
    ['キャビテーション', '—', r.checks.cavitation.result ?? ''],
    ['キャビテーション 詳細', '—', r.checks.cavitation.message],
    ['比速度の妥当性', '—', r.checks.specificSpeed.result],
    ['比速度 詳細', '—', r.checks.specificSpeed.message],
    ['標高・大気圧', '—', r.checks.altitude.result],
    ['標高 詳細', '—', r.checks.altitude.message],
    ['管路損失', '—', r.checks.headLoss.result],
    ['管路損失 詳細', '—', r.checks.headLoss.message],
    ['水撃圧', '—', r.checks.waterHammer.result],
    ['水撃圧 詳細', '—', r.checks.waterHammer.message],
  ]

  const bom  = '\uFEFF'  // Excel で文字化けしないよう BOM 付き
  const csv  = bom + rows
    .map(([a, b, c]) => [a, b, String(c)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join('\r\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const safe = caseName.replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(blob, `turbine_${safe}_${timestamp()}.csv`)
}

// ─── Excel エクスポート（SheetJS / xlsx ライブラリ使用） ──────────────────────
// CDN から動的に SheetJS を読み込んでブラウザ上で XLSX 生成。
// バンドルサイズへの影響を避けるため動的 import を使用。

interface XLSXLib {
  utils: {
    book_new: () => XLSXWorkbook
    aoa_to_sheet: (data: unknown[][]) => XLSXSheet
    book_append_sheet: (wb: XLSXWorkbook, ws: XLSXSheet, name: string) => void
    sheet_add_aoa: (ws: XLSXSheet, data: unknown[][], opts: { origin: string }) => void
  }
  write: (wb: XLSXWorkbook, opts: { bookType: string; type: string }) => Uint8Array
}
interface XLSXWorkbook { SheetNames: string[]; Sheets: Record<string, XLSXSheet> }
interface XLSXSheet { [key: string]: unknown }

async function loadXLSX(): Promise<XLSXLib> {
  // xlsx パッケージを動的 import（Next.js バンドラー対応）
  const mod = await import('xlsx')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.default ?? mod) as unknown as XLSXLib
}

export async function exportExcel(
  inputs:   TurbineInputs,
  results:  TurbineResults,
  caseName: string = '無題'
) {
  const XLSX = await loadXLSX()

  const r  = results
  const i  = inputs
  const d  = r.dimensions
  const h  = r.hydraulics
  const e  = r.electrical

  const fmt = (v: number | null | undefined, dec = 2): string =>
    v == null ? '—' : v.toFixed(dec)

  // ─ シート1: 計算結果サマリー ─
  const summaryData: unknown[][] = [
    ['水車選定ツール — 計算結果レポート'],
    [],
    ['ケース名', caseName],
    ['出力日時', new Date().toLocaleString('ja-JP')],
    [],
    ['【入力条件】'],
    ['項目', '値', '単位'],
    ['有効落差 H', i.head, 'm'],
    ['設計流量 Q', i.flowRate, 'm³/s'],
    ['水車効率 η_t', i.turbineEff, '%'],
    ['発電機効率 η_g', i.generatorEff, '%'],
    ['吸出し高さ Hs', i.suctionHead, 'm'],
    ['設置標高', i.altitude, 'm'],
    ['電源周波数 f', i.frequency, 'Hz'],
    ['力率 cosφ', i.powerFactor, '—'],
    ['年間稼働時間', i.operatingHours, 'h/年'],
    ['設備利用率', i.capacityFactor, '%'],
    ['導水管延長', i.penstock.length, 'm'],
    ['管種', i.penstock.material, '—'],
    [],
    ['【水車仕様・出力】'],
    ['項目', '値', '単位'],
    ['水車形式', r.turbineType, '—'],
    ['比速度 Ns', fmt(r.specificSpeed, 2), '—'],
    ['定格回転速度 n', Math.round(r.ratedRpm), 'rpm'],
    ['極数', r.poles, '極'],
    ['暴走速度 nr', Math.round(r.runawaySpeed), 'rpm'],
    ['水車出力 Pw', fmt(r.turbinePower, 2), 'kW'],
    ['発電機出力 Pe', fmt(r.generatorPower, 2), 'kW'],
    ['キャビテーション係数 σ', r.cavitationCoef != null ? fmt(r.cavitationCoef, 5) : '—（ペルトン）', '—'],
    ['最大吸出し高さ Hs_max', r.hsMax != null ? fmt(r.hsMax, 2) : '—（ペルトン）', 'm'],
    ['大気圧（補正後）', fmt(r.atmPressure, 3), 'kPa'],
    [],
    ['【主要寸法（共通）】'],
    ['項目', '値', '単位'],
    ['ランナー径 D', fmt(d.runnerDiameter * 1000, 1), 'mm'],
    ['吸出し管径', d.draftTubeDiameter != null ? fmt(d.draftTubeDiameter * 1000, 1) : '—', 'mm'],
    ['ケーシング概略径', d.casingDiameter != null ? fmt(d.casingDiameter * 1000, 1) : '—', 'mm'],
    ['導水管径', fmt(d.penstockDiameter * 1000, 1), 'mm'],
    ['導水管流速', fmt(d.penstockVelocity, 1), 'm/s'],
    [],
    // ペルトン専用
    ...(d.pelton ? [
      ['【ペルトン水車　専用パラメータ】'],
      ['項目', '値', '単位'],
      ['ジェット数 J',         String(d.pelton.numJets),                          '本'],
      ['ジェット径 d',         fmt(d.pelton.jetDiameter * 1000, 1),               'mm'],
      ['D/d 比',               fmt(d.pelton.dOverD, 2),                           '—'],
      ['バケット内幅 B2',      fmt(d.pelton.bucketWidth * 1000, 1),               'mm'],
      ['D/B 比',               fmt(d.pelton.dOverB, 2),                           '—'],
      ['バケット数',            String(d.pelton.numBuckets),                       '枚'],
      ['最小流量 Qmin',        fmt(d.pelton.minFlow * 1000, 2),                   'l/s'],
    ] : []),
    // フランシス専用
    ...(d.francis ? [
      ['【フランシス水車　専用パラメータ】'],
      ['項目', '値', '単位'],
      ['アウトレット径 D2e',    fmt(d.francis.outletDiameter * 1000, 1),           'mm'],
      ['入口径 D01',            fmt(d.francis.inletDiameter * 1000, 1),            'mm'],
      ['ガイドベーン高さ Bd',   fmt(d.francis.guideVaneHeight * 1000, 1),          'mm'],
      ['スパイラルケーシング径', fmt(d.francis.spiralCaseInlet * 1000, 1),         'mm'],
      ['ランナーブレード数',    String(d.francis.numBlades),                       '枚'],
      ['ガイドベーン数',        String(d.francis.numGuideVanes),                   '枚'],
      ['最小流量 Qmin',        fmt(d.francis.minFlow * 1000, 1),                   'l/s'],
      ['暴走時流量 Qr',        fmt(d.francis.flowAtRunaway * 1000, 1),             'l/s'],
    ] : []),
    // カプラン専用
    ...(d.kaplan ? [
      ['【カプラン水車　専用パラメータ】'],
      ['項目', '値', '単位'],
      ['ランナーブレード数',    String(d.kaplan.numBlades),                        '枚'],
      ['ガイドベーン数',        String(d.kaplan.numGuideVanes),                    '枚'],
      ['ハブ径 Dh',            fmt(d.kaplan.hubDiameter * 1000, 1),               'mm'],
      ['ハブ比 Dh/D',          fmt(d.kaplan.hubRatio, 3),                          '—'],
      ['最小流量 Qmin',        fmt(d.kaplan.minFlow * 1000, 1),                    'l/s'],
    ] : []),
    [],
    ['【水理・構造系】'],
    ['項目', '値', '単位'],
    ['GD²', fmt(h.gd2, 3), 'kN·m²'],
    ['水撃圧上昇値 ΔH', fmt(h.waterHammerHead, 2), 'm'],
    ['水撃圧上昇率', fmt(h.waterHammerRise, 1), '%'],
    ['管路損失 hf', fmt(h.penstock.headLoss, 3), 'm'],
    ['管路損失率', fmt(h.penstock.headLossRatio, 2), '%'],
    [],
    ['【電気系】'],
    ['項目', '値', '単位'],
    ['発電機容量', fmt(e.generatorKva, 2), 'kVA'],
    ['年間発電量', fmt(e.annualEnergy, 2), 'MWh/年'],
    ['年間発電量', fmt(e.annualEnergyGwh, 4), 'GWh/年'],
    [],
    ['【判定結果】'],
    ['チェック項目', '結果', '詳細'],
    ['キャビテーション', r.checks.cavitation.result ?? '', r.checks.cavitation.message],
    ['比速度の妥当性',   r.checks.specificSpeed.result,    r.checks.specificSpeed.message],
    ['標高・大気圧',     r.checks.altitude.result,         r.checks.altitude.message],
    ['暴走速度',         'INFO',                           r.checks.runaway.message],
    ['管路損失',         r.checks.headLoss.result,         r.checks.headLoss.message],
    ['水撃圧',           r.checks.waterHammer.result,      r.checks.waterHammer.message],
  ]

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(summaryData)

  // 列幅設定
  ws['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 14 }]

  XLSX.utils.book_append_sheet(wb, ws, '計算結果')

  // ─ シート2: 入力値のみ（再インポート用） ─
  const inputData: unknown[][] = [
    ['水車選定ツール — 入力値（再インポート用）'],
    ['このシートは参照用です。JSONファイルをインポート機能でお使いください。'],
    [],
    ['フィールド名', '値'],
    ['head', i.head],
    ['flowRate', i.flowRate],
    ['turbineEff', i.turbineEff],
    ['generatorEff', i.generatorEff],
    ['suctionHead', i.suctionHead],
    ['altitude', i.altitude],
    ['frequency', i.frequency],
    ['powerFactor', i.powerFactor],
    ['operatingHours', i.operatingHours],
    ['capacityFactor', i.capacityFactor],
    ['penstock.length', i.penstock.length],
    ['penstock.material', i.penstock.material],
  ]
  const wsInput = XLSX.utils.aoa_to_sheet(inputData)
  wsInput['!cols'] = [{ wch: 22 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, wsInput, '入力値')

  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as unknown as ArrayBuffer
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const safe = caseName.replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(blob, `turbine_${safe}_${timestamp()}.xlsx`)
}
