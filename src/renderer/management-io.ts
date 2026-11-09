import { createManagementWorkbook } from '../shared/management-spreadsheet'
import type { ManagementState } from '../shared/management'
import type { ManagementExportContext } from '../shared/management-spreadsheet'

export { readOpeningWorkbook, prepareOpeningImport } from '../shared/management-spreadsheet'
export type { OpeningPreview, OpeningRow } from '../shared/management-spreadsheet'

export async function exportManagementWorkbook(state: ManagementState, week: string, kind: 'week' | 'effort' | 'report', context: ManagementExportContext = {}) {
  const workbook = createManagementWorkbook(state, week, kind, context)
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = kind === 'report' ? `研发周报-${week}${context.snapshotRevision ? `-确认版本${context.snapshotRevision}` : ''}.xlsx` : kind === 'week' ? `周排期-${week}${context.snapshotRevision ? `-确认版本${context.snapshotRevision}` : ''}.xlsx` : '专项版本投入统计.xlsx'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
