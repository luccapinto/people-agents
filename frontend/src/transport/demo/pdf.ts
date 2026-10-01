/** Client-side PDFs (payslip, letters, income statement) with pdf-lib and an embedded TTF.
 *  Same content as `backend/atrium/pdf/templates/*.html`, laid out for A4. */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import { fmtDate, fromISO } from './core/date';
import { brl, dec } from './core/money';
import { monthLabel } from './tools/util';
import type { Branding } from './runtime/prompts';

const A4: [number, number] = [595.28, 841.89];
const MARGIN_X = 45;
const MARGIN_TOP = 51;
const INK = rgb(0.067, 0.094, 0.153);
const MUTED = rgb(0.42, 0.447, 0.502);
const BRAND = rgb(0.192, 0.18, 0.506);
const RULE = rgb(0.898, 0.906, 0.922);
const HEAD_BG = rgb(0.933, 0.949, 1);
const BOX_BG = rgb(0.961, 0.969, 1);

let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontCache) return fontCache;
  // `?url` asset imports must be dynamic here so the 1.4 MB of TTF stays out of the entry chunk.
  const [regularUrl, boldUrl] = await Promise.all([
    import('./assets/DejaVuSans.ttf?url').then((m) => m.default as string),
    import('./assets/DejaVuSans-Bold.ttf?url').then((m) => m.default as string),
  ]);
  const [regular, bold] = await Promise.all([
    fetch(regularUrl).then((r) => r.arrayBuffer()),
    fetch(boldUrl).then((r) => r.arrayBuffer()),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  brand: Branding & { company: { name: string; cnpj?: string; headquarters?: string } };
}

function text(ctx: Ctx, value: string, x: number, size: number, bold = false, color = INK): void {
  ctx.page.drawText(value, { x, y: ctx.y, size, font: bold ? ctx.bold : ctx.font, color });
}

function rightText(ctx: Ctx, value: string, right: number, size: number, bold = false, color = INK): void {
  const font = bold ? ctx.bold : ctx.font;
  const width = font.widthOfTextAtSize(value, size);
  ctx.page.drawText(value, { x: right - width, y: ctx.y, size, font, color });
}

function header(ctx: Ctx): void {
  ctx.y = A4[1] - MARGIN_TOP;
  text(ctx, ctx.brand.company.name, MARGIN_X, 13, true, BRAND);
  rightText(ctx, `Emitido via ${ctx.brand.productName}`, A4[0] - MARGIN_X, 8.5, false, MUTED);
  ctx.y -= 12;
  text(ctx, `CNPJ ${ctx.brand.company.cnpj ?? '-'} · ${ctx.brand.company.headquarters ?? ''}`, MARGIN_X, 8.5, false, MUTED);
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: A4[0] - MARGIN_X, y: ctx.y },
    thickness: 1.6,
    color: BRAND,
  });
  ctx.y -= 24;
}

function title(ctx: Ctx, value: string): void {
  text(ctx, value, MARGIN_X, 15, true);
  ctx.y -= 22;
}

function kv(ctx: Ctx, pairs: [string, string][]): void {
  const half = (A4[0] - 2 * MARGIN_X) / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    const row = pairs.slice(i, i + 2);
    row.forEach(([label], col) => text(ctx, label, MARGIN_X + col * half, 8, false, MUTED));
    ctx.y -= 11;
    row.forEach(([, value], col) => text(ctx, value, MARGIN_X + col * half, 9.5));
    ctx.y -= 16;
  }
  ctx.y -= 4;
}

function paragraph(ctx: Ctx, value: string, size = 9.5, color = INK): void {
  const maxWidth = A4[0] - 2 * MARGIN_X;
  const words = value.split(' ');
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.font.widthOfTextAtSize(candidate, size) > maxWidth) {
      text(ctx, line, MARGIN_X, size, false, color);
      ctx.y -= size + 4;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    text(ctx, line, MARGIN_X, size, false, color);
    ctx.y -= size + 4;
  }
  ctx.y -= 6;
}

function table(ctx: Ctx, columns: string[], widths: number[], rows: string[][], footer?: string[]): void {
  const left = MARGIN_X;
  const right = A4[0] - MARGIN_X;
  const total = widths.reduce((a, b) => a + b, 0);
  const scaled = widths.map((w) => ((right - left) * w) / total);
  ctx.page.drawRectangle({ x: left, y: ctx.y - 5, width: right - left, height: 18, color: HEAD_BG });
  let x = left;
  columns.forEach((c, i) => {
    if (i === 0) text(ctx, c, x + 6, 8.5, true, BRAND);
    else rightText(ctx, c, x + scaled[i] - 6, 8.5, true, BRAND);
    x += scaled[i];
  });
  ctx.y -= 20;
  for (const row of rows) {
    x = left;
    row.forEach((cell, i) => {
      if (i === 0 || i === 1) text(ctx, cell, x + 6, 9);
      else rightText(ctx, cell, x + scaled[i] - 6, 9);
      x += scaled[i];
    });
    ctx.y -= 5;
    ctx.page.drawLine({ start: { x: left, y: ctx.y }, end: { x: right, y: ctx.y }, thickness: 0.5, color: RULE });
    ctx.y -= 13;
  }
  if (footer) {
    ctx.page.drawLine({ start: { x: left, y: ctx.y + 8 }, end: { x: right, y: ctx.y + 8 }, thickness: 1.2, color: BRAND });
    x = left;
    footer.forEach((cell, i) => {
      if (i === 0 || i === 1) text(ctx, cell, x + 6, 9, true);
      else rightText(ctx, cell, x + scaled[i] - 6, 9, true);
      x += scaled[i];
    });
    ctx.y -= 20;
  }
}

function footerNote(ctx: Ctx, value: string): void {
  ctx.page.drawText(`${ctx.brand.company.name} — documento fictício gerado para demonstração · página 1`, {
    x: MARGIN_X,
    y: 36,
    size: 7.5,
    font: ctx.font,
    color: MUTED,
  });
  paragraph(ctx, value, 8.5, MUTED);
}

async function newDoc(branding: Branding): Promise<Ctx> {
  const fonts = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const page = doc.addPage(A4);
  const ctx: Ctx = { doc, page, font, bold, y: 0, brand: branding as Ctx['brand'] };
  header(ctx);
  return ctx;
}

export interface PayslipPdfInput {
  month: string;
  kind: string;
  lines: { code: string; label: string; earning?: number | null; deduction?: number | null }[];
  gross: number;
  deductions: number;
  net: number;
  inss_base: number;
  irrf_base: number;
  fgts: number;
  paid_on: string;
}

export interface PersonPdfInput {
  id: string;
  name: string;
  title: string;
  hire_date: string;
}

export async function payslipPdf(
  branding: Branding,
  slip: PayslipPdfInput,
  person: PersonPdfInput,
): Promise<Uint8Array> {
  const ctx = await newDoc(branding);
  title(ctx, `Demonstrativo de pagamento — ${monthLabel(slip.month)}`);
  kv(ctx, [
    ['Colaborador(a)', person.name],
    ['Cargo', person.title],
    ['Matrícula', person.id],
    ['Admissão', fmtDate(fromISO(person.hire_date))],
    ['Tipo', slip.kind === 'plr' ? 'Participação nos Lucros' : 'Folha mensal'],
    ['Pagamento', fmtDate(fromISO(slip.paid_on))],
  ]);
  table(
    ctx,
    ['Código', 'Descrição', 'Proventos', 'Descontos'],
    [12, 50, 19, 19],
    slip.lines.map((ln) => [
      ln.code,
      ln.label,
      ln.earning === undefined || ln.earning === null ? '' : brl(dec(String(ln.earning))),
      ln.deduction === undefined || ln.deduction === null ? '' : brl(dec(String(ln.deduction))),
    ]),
    ['', 'Totais', brl(dec(String(slip.gross))), brl(dec(String(slip.deductions)))],
  );
  ctx.page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - 6,
    width: A4[0] - 2 * MARGIN_X,
    height: 24,
    color: BOX_BG,
    borderColor: rgb(0.78, 0.82, 0.996),
    borderWidth: 1,
  });
  ctx.y += 2;
  text(ctx, `Líquido a receber: ${brl(dec(String(slip.net)))}`, MARGIN_X + 10, 10.5, true);
  ctx.y -= 32;
  kv(ctx, [
    ['Base INSS', brl(dec(String(slip.inss_base)))],
    ['Base IRRF', brl(dec(String(slip.irrf_base)))],
    ['FGTS do mês (8%, depositado pela empresa)', brl(dec(String(slip.fgts)))],
  ]);
  footerNote(
    ctx,
    'Cálculos com as tabelas oficiais vigentes (INSS: Portaria Interministerial MPS/MF nº 13/2026; IRRF: Lei 15.191/2025 e redução da Lei 15.270/2025). Documento fictício.',
  );
  return ctx.doc.save();
}

export interface LetterPdfInput {
  kind: string;
  params: Record<string, unknown>;
  verification_code: string;
  issued_on: string;
}

export interface IncomeFigures {
  taxable_income: number;
  inss: number;
  irrf: number;
  thirteenth_gross: number;
  thirteenth_irrf: number;
  health_paid: number;
  dependents: number;
}

export async function letterPdf(
  branding: Branding,
  doc: LetterPdfInput,
  person: PersonPdfInput,
  cpf: string,
  figures: IncomeFigures | null,
): Promise<Uint8Array> {
  const ctx = await newDoc(branding);
  if (doc.kind === 'income_statement' && figures) {
    title(ctx, `Comprovante de rendimentos — ano-calendário ${doc.params.year}`);
    kv(ctx, [
      ['Beneficiário(a)', person.name],
      ['CPF', cpf],
      ['Fonte pagadora', ctx.brand.company.name],
      ['Dependentes', String(figures.dependents)],
    ]);
    table(
      ctx,
      ['Rendimentos e retenções', 'Valor'],
      [70, 30],
      [
        ['Rendimentos tributáveis (salários e férias)', brl(dec(String(figures.taxable_income)))],
        ['Contribuição previdenciária oficial (INSS)', brl(dec(String(figures.inss)))],
        ['Imposto retido na fonte', brl(dec(String(figures.irrf)))],
        ['13º salário (tributação exclusiva)', brl(dec(String(figures.thirteenth_gross)))],
        ['IRRF sobre 13º salário', brl(dec(String(figures.thirteenth_irrf)))],
        ['Plano de saúde pago pelo colaborador', brl(dec(String(figures.health_paid)))],
      ].map(([label, value]) => [label, value]),
    );
  } else {
    title(ctx, doc.kind === 'visa_letter' ? 'Carta para fins de visto consular' : 'Declaração de vínculo empregatício');
    ctx.y -= 6;
    paragraph(
      ctx,
      `Declaramos, para os devidos fins, que ${person.name}, CPF ${cpf}, é colaborador(a) da ` +
        `${ctx.brand.company.name}, CNPJ ${ctx.brand.company.cnpj ?? '-'}, desde ${fmtDate(fromISO(person.hire_date))}, ` +
        `ocupando atualmente o cargo de ${person.title}, em regime CLT, com jornada de 40 horas semanais.`,
    );
    if (doc.kind === 'visa_letter') {
      paragraph(
        ctx,
        `Informamos que a viagem para ${doc.params.country}, no período de ${fmtDate(fromISO(String(doc.params.start)))} a ` +
          `${fmtDate(fromISO(String(doc.params.end)))}, foi autorizada pela empresa, e que ${person.name.split(' ')[0]} ` +
          'retornará às suas atividades ao final do período.',
      );
    } else {
      paragraph(ctx, `Esta declaração é emitida para: ${doc.params.purpose}.`);
    }
    paragraph(ctx, `São Paulo, ${fmtDate(fromISO(doc.issued_on))}.`);
    ctx.y -= 40;
    ctx.page.drawLine({
      start: { x: MARGIN_X, y: ctx.y },
      end: { x: MARGIN_X + (A4[0] - 2 * MARGIN_X) * 0.6, y: ctx.y },
      thickness: 0.8,
      color: MUTED,
    });
    ctx.y -= 14;
    text(ctx, `Departamento Pessoal — ${ctx.brand.company.name}`, MARGIN_X, 9.5);
    ctx.y -= 24;
  }
  footerNote(
    ctx,
    `Código de verificação: ${doc.verification_code}. A autenticidade pode ser conferida no portal de Pessoas. Documento fictício.`,
  );
  return ctx.doc.save();
}

export function downloadBlob(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
