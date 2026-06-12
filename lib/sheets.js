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

export async function updateCell(spreadsheetId, tab, row, col, value) {
  const sheets = await getSheetsClient()
  const colLetter = String.fromCharCode(64 + col)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!${colLetter}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
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
