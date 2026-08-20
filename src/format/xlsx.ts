import type { LeadRecord } from '../types.js';
import { DEFAULT_COLUMNS } from './records.js';

/**
 * A real .xlsx, with no dependencies.
 *
 * ── WHY NOT JUST SHIP A CSV AND CALL IT EXCEL ─────────────────────────────
 * Because Excel mangles it. A phone number like +998901234567 becomes a
 * number in scientific notation; an id like 0012 loses its zeros; a date is
 * reinterpreted in the local format. None of that is recoverable by the person
 * opening the file, and none of it looks like an error — it looks like your
 * data is wrong. An xlsx carries the type with the cell, so a string stays a
 * string.
 *
 * ── WHY NOT A LIBRARY ─────────────────────────────────────────────────────
 * The xlsx packages are large, and this package's entire value proposition is
 * zero dependencies — something you install into forty client sites should not
 * drag a spreadsheet engine along. An xlsx is a ZIP of a few XML files, and
 * writing one is about a hundred lines. The ZIP is written with the STORED
 * method (no compression), which is valid, keeps the code to a CRC-32 table,
 * and costs nothing at these sizes.
 *
 * Everything is written as an inline string (`t="inlineStr"`). No shared
 * string table, no type inference, no dates coerced to serial numbers — the
 * data came out of a form as text and stays text, which is exactly the
 * property that makes this better than a CSV.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Escape for XML, and strip what XML 1.0 cannot represent.
 *
 * `&` first, or the later replacements' own ampersands get double-escaped.
 * Control characters are not merely ugly here: most are unrepresentable in XML
 * 1.0 at all, so one pasted into a message makes the whole workbook
 * unopenable — Excel reports a corrupt file and names no cell.
 */
const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** 0 → A, 25 → Z, 26 → AA. Spreadsheet column names are base-26 with no zero. */
export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

interface Entry {
  name: string;
  data: Uint8Array;
}

function zip(entries: Entry[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    /* Fixed 1980-01-01 timestamp rather than the clock. A build that produces
       a byte-identical file twice is one you can diff; a timestamp inside the
       archive makes every export differ from every other for no reason. */
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(33), ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...nameBytes,
    ]);
    chunks.push(local, entry.data);

    central.push(
      new Uint8Array([
        0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0),
        ...u16(0), ...u16(33), ...u32(crc), ...u32(size), ...u32(size),
        ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset), ...nameBytes,
      ]),
    );
    offset += local.length + size;
  }

  const dirBytes = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(dirBytes), ...u32(offset), ...u16(0),
  ]);

  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  /* Backed by an explicit ArrayBuffer, not just `new Uint8Array(total)`. The
     latter is typed Uint8Array<ArrayBufferLike>, which is NOT assignable to
     BodyInit — so a Response built from it fails to typecheck and the
     temptation is to paper over it with a cast. This is the real fix. */
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function toXlsx(
  leads: LeadRecord[],
  columns: readonly string[] = DEFAULT_COLUMNS,
): Uint8Array<ArrayBuffer> {
  const row = (cells: unknown[], index: number) =>
    `<row r="${index + 1}">` +
    cells
      .map(
        (value, c) =>
          `<c r="${columnName(c)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`,
      )
      .join('') +
    '</row>';

  const rows = [row(columns as unknown[], 0), ...leads.map((l, i) => row(columns.map((c) => l[c]), i + 1))];

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    /* Freeze the header. On a thousand-row export, scrolling past row one and
       losing the column names is the difference between a usable file and a
       grid of unlabelled strings. */
    '<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `<sheetData>${rows.join('')}</sheetData></worksheet>`;

  return zip([
    {
      name: '[Content_Types].xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Enquiries" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheet) },
  ]);
}
