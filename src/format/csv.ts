/** RFC 4180: quote every cell, double internal quotes. */
export const csvCell = (value: unknown): string =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;

export const csvRow = (values: unknown[]): string => values.map(csvCell).join(',');

/**
 * Join rows into a file.
 *
 * The BOM is not decoration. Excel on Windows reads a CSV as the system code
 * page unless one is present, so every accented name arrives as mojibake —
 * and the person who opens it has no reason to think the file is fine and the
 * reader is wrong.
 */
export const csvFile = (rows: string[]): string => '﻿' + rows.join('\r\n') + '\r\n';
