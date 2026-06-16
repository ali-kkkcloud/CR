import { google } from 'googleapis'

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

export async function getSheetsClient() {
  const auth = getAuth()
  return google.sheets({ version: 'v4', auth })
}

export const CRM_SHEET_ID   = process.env.CRM_SHEET_ID
export const ISSUE_SHEET_ID = process.env.ISSUE_TRACKER_SHEET_ID

export const TABS = {
  CREDENTIALS: 'Credentials',
  SHIFT_LOG:   'Shift_Log',
  CRM_UPDATES: 'CRM_Updates',
  REDISTRIB:   'Redistribution_Log',
}

export async function readSheet(spreadsheetId, range) {
  const sheets = await getSheetsClient()
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range })
  return res.data.values || []
}

export async function appendRow(spreadsheetId, tab, values) {
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  })
}

export async function updateRowCells(spreadsheetId, tab, row, startCol, values) {
  const sheets = await getSheetsClient()
  const colLetter = String.fromCharCode(64 + startCol)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!${colLetter}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  })
}

export async function updateSingleCell(spreadsheetId, tab, row, col, value) {
  const sheets = await getSheetsClient()
  const colLetter = String.fromCharCode(64 + col)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!${colLetter}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  })
}

export function todayStr() {
  return new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Asia/Kolkata'
  })
}

export function nowStr() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata'
  })
}

export function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

export function parseISTDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [day, month, year] = parts.map(s => parseInt(s, 10))
  const m = timeStr.trim().match(/(\d+):(\d+):(\d+)\s*(am|pm)/i)
  if (!m) return null
  let [, h, min, sec, ampm] = m
  h = parseInt(h, 10)
  if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
  if (ampm.toLowerCase() === 'am' && h === 12) h = 0
  return new Date(year, month - 1, day, h, parseInt(min, 10), parseInt(sec, 10))
}

export function calcDuration(dateStr, startTimeStr, endDateStr, endTimeStr) {
  const start = parseISTDateTime(dateStr, startTimeStr)
  const end   = parseISTDateTime(endDateStr || dateStr, endTimeStr)
  if (!start || !end) return '—'
  let diffMs = end - start
  if (diffMs < 0) diffMs += 24 * 3600000
  const h = Math.floor(diffMs / 3600000)
  const m = Math.floor((diffMs % 3600000) / 60000)
  return `${h}h ${m}m`
}
