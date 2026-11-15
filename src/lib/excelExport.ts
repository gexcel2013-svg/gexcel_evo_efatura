/**
 * Gerador Nativo Multi-Folha Excel (.xlsx OpenXML) — Zero Dependências Externas
 * Suporta múltiplas folhas, larguras automáticas, estilos executivos e formatos numéricos (#,##0.00).
 */

export type ExcelCellType = 'string' | 'currency' | 'integer' | 'date';

export interface ExcelColumnDef {
  key: string;
  label: string;
  type: ExcelCellType;
  width?: number;
}

export interface ExcelMetaItem {
  label: string;
  value: string;
}

export interface ExcelSheetInput {
  name: string;
  title: string;
  subtitle?: string;
  metadata?: ExcelMetaItem[];
  columns: ExcelColumnDef[];
  rows: Record<string, string | number | null | undefined>[];
  topTotalsRow?: Record<string, string | number | null | undefined>;
  bottomTotalsRow?: Record<string, string | number | null | undefined>;
  extraSection?: {
    title: string;
    columns: ExcelColumnDef[];
    rows: Record<string, string | number | null | undefined>[];
    bottomTotalsRow?: Record<string, string | number | null | undefined>;
  };
}

// Tabela CRC32 pré-calculada para ZIP STORED
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string): string {
  // Remove caracteres de controlo XML inválidos (mantém \t \n \r)
  const clean = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(colIdx1Based: number): string {
  let n = colIdx1Based;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sanitizeSheetName(raw: string, usedNames: Set<string>): string {
  // Excel proíbe \ / ? * [ ] : e limite de 31 caracteres
  let base = (raw || 'Folha')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = 'Folha';
  if (base.length > 31) base = base.slice(0, 31).trim();

  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    const maxLen = Math.max(1, 31 - suffix.length);
    candidate = base.slice(0, maxLen).trim() + suffix;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
  </numFmts>
  <fonts count="5">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0369A1"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0284C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD7E0EA"/></left>
      <right style="thin"><color rgb="FFD7E0EA"/></right>
      <top style="thin"><color rgb="FFD7E0EA"/></top>
      <bottom style="thin"><color rgb="FFD7E0EA"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="thin"><color rgb="FF64748B"/></top>
      <bottom style="double"><color rgb="FF64748B"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="15">
    <!-- 0: Default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: Title -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
    <!-- 2: Meta Label -->
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <!-- 3: Meta Value -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <!-- 4: Header -->
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <!-- 5: Text Left -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 6: Text Center -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 7: Currency Right -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 8: Integer Right -->
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 9: Total Text -->
    <xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 10: Total Currency -->
    <xf numFmtId="164" fontId="3" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 11: Total Integer -->
    <xf numFmtId="165" fontId="3" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 12: Top Banner Text -->
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 13: Top Banner Currency -->
    <xf numFmtId="164" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 14: Top Banner Integer -->
    <xf numFmtId="165" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function renderCellXml(
  rowIdx: number,
  colIdx: number,
  val: string | number | null | undefined,
  type: ExcelCellType,
  styleId: number
): string {
  const ref = `${colLetter(colIdx)}${rowIdx}`;
  if (val === null || val === undefined || val === '') {
    return `<c r="${ref}" s="${styleId}"/>`;
  }
  if ((type === 'currency' || type === 'integer') && typeof val === 'number' && Number.isFinite(val)) {
    const cleanVal = type === 'currency' ? Math.round(val * 100) / 100 : Math.round(val);
    return `<c r="${ref}" s="${styleId}"><v>${cleanVal}</v></c>`;
  }
  if ((type === 'currency' || type === 'integer') && typeof val === 'string') {
    const num = Number(val.replace(',', '.'));
    if (!Number.isNaN(num) && val.trim() !== '') {
      const cleanVal = type === 'currency' ? Math.round(num * 100) / 100 : Math.round(num);
      return `<c r="${ref}" s="${styleId}"><v>${cleanVal}</v></c>`;
    }
  }
  const str = String(val);
  return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${escapeXml(str)}</t></is></c>`;
}

function buildWorksheetXml(sheet: ExcelSheetInput): string {
  const colsCount = Math.max(sheet.columns.length, sheet.extraSection?.columns.length || 0, 2);
  const colWidths = new Array<number>(colsCount).fill(14);

  const trackWidth = (colIdx0: number, text: string) => {
    const len = Math.min(48, Math.max(10, text.length + 3));
    if (len > colWidths[colIdx0]) colWidths[colIdx0] = len;
  };

  sheet.columns.forEach((col, i) => {
    colWidths[i] = Math.max(colWidths[i], col.width || Math.min(40, col.label.length + 4));
  });

  const rowsXml: string[] = [];
  let rowIdx = 1;

  // Linha 1: Título
  rowsXml.push(
    `<row r="${rowIdx}" ht="24" customHeight="1">${renderCellXml(rowIdx, 1, sheet.title, 'string', 1)}${
      sheet.subtitle ? renderCellXml(rowIdx, 3, sheet.subtitle, 'string', 0) : ''
    }</row>`
  );
  rowIdx += 2;

  // Metadados (filtros aplicados)
  if (sheet.metadata && sheet.metadata.length > 0) {
    for (const meta of sheet.metadata) {
      trackWidth(0, meta.label);
      trackWidth(1, meta.value);
      rowsXml.push(
        `<row r="${rowIdx}" ht="18" customHeight="1">${renderCellXml(rowIdx, 1, meta.label, 'string', 2)}${renderCellXml(
          rowIdx,
          2,
          meta.value,
          'string',
          3
        )}</row>`
      );
      rowIdx++;
    }
    rowIdx++;
  }

  // Totais no topo (semelhante à linha 12 do MapasResumo_xml.xlsm)
  if (sheet.topTotalsRow) {
    const cells = sheet.columns.map((col, idx) => {
      const val = sheet.topTotalsRow?.[col.key];
      const style = col.type === 'currency' ? 13 : col.type === 'integer' ? 14 : 12;
      if (val !== undefined && val !== null) trackWidth(idx, String(val));
      return renderCellXml(rowIdx, idx + 1, val, col.type, style);
    });
    rowsXml.push(`<row r="${rowIdx}" ht="20" customHeight="1">${cells.join('')}</row>`);
    rowIdx++;
  }

  // Cabeçalho da Tabela Principal
  const headerCells = sheet.columns.map((col, idx) =>
    renderCellXml(rowIdx, idx + 1, col.label, 'string', 4)
  );
  rowsXml.push(`<row r="${rowIdx}" ht="26" customHeight="1">${headerCells.join('')}</row>`);
  rowIdx++;

  // Linhas de Dados
  for (const row of sheet.rows) {
    const cells = sheet.columns.map((col, idx) => {
      const val = row[col.key];
      if (val !== undefined && val !== null) {
        const displayStr =
          typeof val === 'number' && col.type === 'currency'
            ? val.toFixed(2)
            : String(val);
        trackWidth(idx, displayStr);
      }
      const style =
        col.type === 'currency'
          ? 7
          : col.type === 'integer'
            ? 8
            : col.type === 'date'
              ? 6
              : 5;
      return renderCellXml(rowIdx, idx + 1, val, col.type, style);
    });
    rowsXml.push(`<row r="${rowIdx}">${cells.join('')}</row>`);
    rowIdx++;
  }

  // Linha Total Geral (Rodapé)
  if (sheet.bottomTotalsRow) {
    const cells = sheet.columns.map((col, idx) => {
      const val = sheet.bottomTotalsRow?.[col.key];
      if (val !== undefined && val !== null) trackWidth(idx, String(val));
      const style = col.type === 'currency' ? 10 : col.type === 'integer' ? 11 : 9;
      return renderCellXml(rowIdx, idx + 1, val, col.type, style);
    });
    rowsXml.push(`<row r="${rowIdx}" ht="21" customHeight="1">${cells.join('')}</row>`);
    rowIdx++;
  }

  // Secção Extra (usada em ContagemDocumentos para colocar Recibos Eletrónicos abaixo ou ao lado)
  if (sheet.extraSection) {
    const extra = sheet.extraSection;
    rowIdx += 2;
    rowsXml.push(
      `<row r="${rowIdx}" ht="22" customHeight="1">${renderCellXml(rowIdx, 1, extra.title, 'string', 1)}</row>`
    );
    rowIdx++;
    const extraHeaders = extra.columns.map((col, idx) => {
      trackWidth(idx, col.label);
      return renderCellXml(rowIdx, idx + 1, col.label, 'string', 4);
    });
    rowsXml.push(`<row r="${rowIdx}" ht="26" customHeight="1">${extraHeaders.join('')}</row>`);
    rowIdx++;
    for (const row of extra.rows) {
      const cells = extra.columns.map((col, idx) => {
        const val = row[col.key];
        if (val !== undefined && val !== null) trackWidth(idx, String(val));
        const style = col.type === 'currency' ? 7 : col.type === 'integer' ? 8 : col.type === 'date' ? 6 : 5;
        return renderCellXml(rowIdx, idx + 1, val, col.type, style);
      });
      rowsXml.push(`<row r="${rowIdx}">${cells.join('')}</row>`);
      rowIdx++;
    }
    if (extra.bottomTotalsRow) {
      const extraBottom = extra.bottomTotalsRow;
      const cells = extra.columns.map((col, idx) => {
        const val = extraBottom[col.key];
        const style = col.type === 'currency' ? 10 : col.type === 'integer' ? 11 : 9;
        return renderCellXml(rowIdx, idx + 1, val, col.type, style);
      });
      rowsXml.push(`<row r="${rowIdx}" ht="21" customHeight="1">${cells.join('')}</row>`);
    }
  }

  const colsXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml.join('')}</sheetData>
  <pageSetup paperSize="9" orientation="landscape"/>
</worksheet>`;
}

interface ZipEntryInput {
  name: string;
  data: Uint8Array;
}

function buildZipBytes(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local File Header (30 bytes + filename)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression STORED
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localParts.push(lh, entry.data);

    // Central Directory Header (46 bytes + filename)
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    centralParts.push(ch);
    offset += lh.length + entry.data.length;
  }

  let centralSize = 0;
  for (const cp of centralParts) centralSize += cp.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of localParts) {
    output.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    output.set(part, pos);
    pos += part.length;
  }
  output.set(eocd, pos);
  return output;
}

function gerarXlsxBlob(sheets: ExcelSheetInput[]): Blob {
  const encoder = new TextEncoder();
  const usedNames = new Set<string>();
  const sanitizedSheets = sheets.map(s => ({
    ...s,
    safeName: sanitizeSheetName(s.name, usedNames),
  }));

  const entries: ZipEntryInput[] = [];

  // [Content_Types].xml
  const sheetOverrides = sanitizedSheets
    .map(
      (_, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  entries.push({
    name: '[Content_Types].xml',
    data: encoder.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`
    ),
  });

  // _rels/.rels
  entries.push({
    name: '_rels/.rels',
    data: encoder.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    ),
  });

  // xl/workbook.xml
  const workbookSheetsXml = sanitizedSheets
    .map(
      (s, idx) =>
        `<sheet name="${escapeXml(s.safeName)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
    )
    .join('');

  entries.push({
    name: 'xl/workbook.xml',
    data: encoder.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheetsXml}</sheets>
</workbook>`
    ),
  });

  // xl/_rels/workbook.xml.rels
  const sheetRelsXml = sanitizedSheets
    .map(
      (_, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join('');

  entries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: encoder.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRelsXml}
  <Relationship Id="rId${sanitizedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    ),
  });

  // xl/styles.xml
  entries.push({
    name: 'xl/styles.xml',
    data: encoder.encode(buildStylesXml()),
  });

  // xl/worksheets/sheetN.xml
  sanitizedSheets.forEach((s, idx) => {
    entries.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: encoder.encode(buildWorksheetXml(s)),
    });
  });

  const zipBytes = buildZipBytes(entries);
  return new Blob([zipBytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const safeName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 1. Exporta um único mapa ativo para .xlsx (equivalente a copiarFolhaParaNova)
 */
export function exportarMapaUnicoXlsx(nomeFicheiro: string, sheet: ExcelSheetInput): void {
  const blob = gerarXlsxBlob([sheet]);
  downloadBlob(blob, nomeFicheiro);
}

/**
 * 2. Exporta todos os mapas e tabelas de suporte num único livro .xlsx (equivalente a exportarTodos_Excel)
 */
export function exportarTodosMapasXlsx(nomeFicheiro: string, sheets: ExcelSheetInput[]): void {
  if (!sheets.length) return;
  const blob = gerarXlsxBlob(sheets);
  downloadBlob(blob, nomeFicheiro);
}

export interface DocHorizontalExportRow {
  contraparte_nif: string;
  contraparte_nome: string;
  tipo_doc: string;
  n_fatura: string;
  data_emissao: string;
  base_tributavel: number;
  total_iva: number;
  total_liquido: number;
  base_ise: number;
  base_red: number;
  iva_red: number;
  base_int: number;
  iva_int: number;
  base_nor: number;
  iva_nor: number;
}

const COLUNAS_RESUMO_DOCS: ExcelColumnDef[] = [
  { key: 'contraparte_nif', label: 'NIF Entidade', type: 'string', width: 13 },
  { key: 'contraparte_nome', label: 'Nome Contraparte', type: 'string', width: 34 },
  { key: 'tipo_doc', label: 'Tipo Doc', type: 'string', width: 18 },
  { key: 'n_fatura', label: 'N.º Fatura', type: 'string', width: 24 },
  { key: 'data_emissao', label: 'Data Emissão', type: 'date', width: 13 },
  { key: 'base_tributavel', label: 'Base Tributável', type: 'currency', width: 15 },
  { key: 'total_iva', label: 'Total IVA', type: 'currency', width: 14 },
  { key: 'total_liquido', label: 'Total Líquido', type: 'currency', width: 15 },
  { key: 'base_ise', label: 'Base Isenta', type: 'currency', width: 14 },
  { key: 'base_red', label: 'Base Red.', type: 'currency', width: 14 },
  { key: 'iva_red', label: 'IVA Red.', type: 'currency', width: 13 },
  { key: 'base_int', label: 'Base Int.', type: 'currency', width: 14 },
  { key: 'iva_int', label: 'IVA Int.', type: 'currency', width: 13 },
  { key: 'base_nor', label: 'Base Nor.', type: 'currency', width: 14 },
  { key: 'iva_nor', label: 'IVA Nor.', type: 'currency', width: 13 },
];

function somarDocsExport(docs: DocHorizontalExportRow[]): Record<string, string | number> {
  const acc = {
    contraparte_nif: 'Total Geral',
    contraparte_nome: `${docs.length} doc(s)`,
    tipo_doc: '',
    n_fatura: '',
    data_emissao: '',
    base_tributavel: 0,
    total_iva: 0,
    total_liquido: 0,
    base_ise: 0,
    base_red: 0,
    iva_red: 0,
    base_int: 0,
    iva_int: 0,
    base_nor: 0,
    iva_nor: 0,
  };
  for (const d of docs) {
    acc.base_tributavel += d.base_tributavel;
    acc.total_iva += d.total_iva;
    acc.total_liquido += d.total_liquido;
    acc.base_ise += d.base_ise;
    acc.base_red += d.base_red;
    acc.iva_red += d.iva_red;
    acc.base_int += d.base_int;
    acc.iva_int += d.iva_int;
    acc.base_nor += d.base_nor;
    acc.iva_nor += d.iva_nor;
  }
  return acc;
}

/**
 * 3. Exporta ResumoDocs dividido por fornecedor/cliente: 1.ª folha geral + 1 folha por NIF
 *    (equivalente fiel à rotina copiarFolhaParaNova_porFornecedor do VBA)
 */
export function exportarDivididoPorFornecedorXlsx(
  nomeFicheiro: string,
  nomeEntidadeTitular: string,
  ano: number,
  cv: 'C' | 'V',
  docs: DocHorizontalExportRow[]
): void {
  if (!docs.length) return;

  const totaisGerais = somarDocsExport(docs);
  const folhas: ExcelSheetInput[] = [
    {
      name: 'ResumoDocs',
      title: `Resumo Documentos (${cv === 'C' ? 'Compras' : 'Vendas'} · ${ano})`,
      subtitle: nomeEntidadeTitular,
      metadata: [
        { label: 'Entidade', value: nomeEntidadeTitular },
        { label: 'Fluxo / Ano', value: `${cv === 'C' ? 'Compras (C)' : 'Vendas (V)'} · ${ano}` },
      ],
      columns: COLUNAS_RESUMO_DOCS,
      rows: docs.map(d => ({ ...d })),
      topTotalsRow: { ...totaisGerais, contraparte_nif: 'Totais', contraparte_nome: '' },
      bottomTotalsRow: totaisGerais,
    },
  ];

  // Agrupar por NIF da contraparte mantendo ordem alfabética / NIF
  const grupos = new Map<string, { nome: string; docs: DocHorizontalExportRow[] }>();
  for (const d of docs) {
    const nifKey = (d.contraparte_nif || 'SEM_NIF').trim() || 'SEM_NIF';
    const existing = grupos.get(nifKey);
    if (existing) {
      existing.docs.push(d);
    } else {
      grupos.set(nifKey, {
        nome: d.contraparte_nome || nifKey,
        docs: [d],
      });
    }
  }

  const chavesOrdenadas = Array.from(grupos.keys()).sort((a, b) => a.localeCompare(b));
  for (const nifKey of chavesOrdenadas) {
    const grupo = grupos.get(nifKey)!;
    const totaisGrupo = somarDocsExport(grupo.docs);
    folhas.push({
      name: nifKey,
      title: `${nifKey} — ${grupo.nome}`,
      subtitle: `${nomeEntidadeTitular} (${ano})`,
      columns: COLUNAS_RESUMO_DOCS,
      rows: grupo.docs.map(d => ({ ...d })),
      topTotalsRow: { ...totaisGrupo, contraparte_nif: 'Totais', contraparte_nome: grupo.nome },
      bottomTotalsRow: totaisGrupo,
    });
  }

  const blob = gerarXlsxBlob(folhas);
  downloadBlob(blob, nomeFicheiro);
}
