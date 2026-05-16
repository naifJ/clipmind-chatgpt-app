import { fetchFileBytes } from "../lib/fileStorage.js";
import type { FileReference, WidgetOperationResult } from "../lib/types.js";
import { assertPdfFile } from "../lib/validation.js";
import { extractPdfText } from "./pdfText.js";

type ConfidenceValue<T> = {
  value: T | null;
  confidence: number;
};

type InvoiceLineItem = {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  confidence: number;
};

export type InvoiceData = {
  vendor_name: ConfidenceValue<string>;
  invoice_number: ConfidenceValue<string>;
  invoice_date: ConfidenceValue<string>;
  total_amount: ConfidenceValue<number>;
  tax_amount: ConfidenceValue<number>;
  currency: ConfidenceValue<string>;
  line_items: InvoiceLineItem[];
};

function cleanText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function firstMatch(text: string, patterns: RegExp[]): ConfidenceValue<string> {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return { value, confidence: 0.78 };
    }
  }

  return { value: null, confidence: 0 };
}

function amountMatch(text: string, patterns: RegExp[]): ConfidenceValue<number> {
  const match = firstMatch(text, patterns);
  if (!match.value) {
    return { value: null, confidence: 0 };
  }

  const normalized = match.value.replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  if (!normalized) {
    return { value: null, confidence: 0 };
  }

  return { value: Number(normalized[0]), confidence: match.confidence };
}

function detectCurrency(text: string): ConfidenceValue<string> {
  const currencyPatterns: Array<[RegExp, string]> = [
    [/\bUSD\b|\$/i, "USD"],
    [/\bEUR\b|€/i, "EUR"],
    [/\bGBP\b|£/i, "GBP"],
    [/\bSAR\b|ر\.س|ريال/i, "SAR"],
    [/\bAED\b|درهم/i, "AED"],
  ];

  for (const [pattern, currency] of currencyPatterns) {
    if (pattern.test(text)) {
      return { value: currency, confidence: 0.7 };
    }
  }

  return { value: null, confidence: 0 };
}

function extractVendorName(text: string): ConfidenceValue<string> {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  const labeled = firstMatch(text, [
    /(?:vendor|supplier|from|billed by|seller)\s*[:#-]\s*([^\n]+)/i,
    /(?:المورد|البائع|من)\s*[:#-]\s*([^\n]+)/i,
  ]);

  if (labeled.value) {
    return labeled;
  }

  const candidate = lines.find((line) => !/invoice|فاتورة|tax|date|total/i.test(line));
  return candidate ? { value: candidate.slice(0, 120), confidence: 0.45 } : { value: null, confidence: 0 };
}

function extractLineItems(text: string): InvoiceLineItem[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);

  const itemLines = lines.filter((line) => {
    const amountCount = (line.match(/\d+[,.]?\d*/g) ?? []).length;
    return (
      amountCount >= 2 &&
      !/^--/.test(line) &&
      !/invoice|date|total|subtotal|tax|vat|balance|amount due/i.test(line)
    );
  });

  return itemLines.slice(0, 12).map((line) => {
    const numbers = [...line.matchAll(/-?\d+(?:,\d{3})*(?:\.\d{1,2})?/g)].map((match) =>
      Number(match[0].replace(/,/g, ""))
    );

    return {
      description: line.replace(/-?\d+(?:,\d{3})*(?:\.\d{1,2})?/g, "").replace(/\s{2,}/g, " ").trim() || line,
      quantity: numbers.length >= 3 ? numbers[0] : null,
      unit_price: numbers.length >= 3 ? numbers[1] : null,
      amount: numbers.at(-1) ?? null,
      confidence: 0.42,
    };
  });
}

export async function extractInvoiceData(params: {
  file: FileReference;
  publicBaseUrl: string;
}): Promise<WidgetOperationResult & { invoice_data: InvoiceData }> {
  const bytes = await fetchFileBytes(params.file);
  assertPdfFile(params.file, bytes);

  const { text, pageCount } = await extractPdfText(bytes);
  const cleaned = cleanText(text);
  const invoiceData: InvoiceData = {
    vendor_name: extractVendorName(cleaned),
    invoice_number: firstMatch(cleaned, [
      /(?:invoice\s*(?:number|no\.?|#)|inv\s*(?:no\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9-_/]+)/i,
      /(?:رقم\s*الفاتورة|فاتورة\s*رقم)\s*[:#-]?\s*([A-Z0-9\u0660-\u0669][A-Z0-9\u0660-\u0669-_/]+)/i,
    ]),
    invoice_date: firstMatch(cleaned, [
      /(?:invoice\s*date|date)\s*[:#-]?\s*([0-9]{1,4}[\/.-][0-9]{1,2}[\/.-][0-9]{1,4})/i,
      /(?:تاريخ\s*الفاتورة|التاريخ)\s*[:#-]?\s*([0-9\u0660-\u0669]{1,4}[\/.-][0-9\u0660-\u0669]{1,2}[\/.-][0-9\u0660-\u0669]{1,4})/i,
    ]),
    total_amount: amountMatch(cleaned, [
      /(?:grand\s*total|amount\s*due|total\s*amount|total)\s*[:#-]?\s*(?:[A-Z]{3}\s*)?([$€£]?\s*-?\d[\d,]*(?:\.\d{1,2})?)/i,
      /(?:الإجمالي|المبلغ\s*المستحق|المجموع)\s*[:#-]?\s*(?:[A-Z]{3}\s*)?([$€£]?\s*-?\d[\d,]*(?:\.\d{1,2})?)/i,
    ]),
    tax_amount: amountMatch(cleaned, [
      /(?:tax|vat|sales\s*tax)\s*[:#-]?\s*([$€£]?\s*-?\d[\d,]*(?:\.\d{1,2})?)/i,
      /(?:الضريبة|ضريبة\s*القيمة\s*المضافة)\s*[:#-]?\s*([$€£]?\s*-?\d[\d,]*(?:\.\d{1,2})?)/i,
    ]),
    currency: detectCurrency(cleaned),
    line_items: extractLineItems(cleaned),
  };

  return {
    operation: "extract_invoice_data",
    status: "completed",
    summary_ar:
      "تم استخراج بيانات الفاتورة من ملف PDF. القيم غير المؤكدة تظهر كـ null أو بثقة منخفضة.",
    summary_en:
      "Extracted invoice data from the PDF. Missing or uncertain values are returned as null or low-confidence fields.",
    files: [],
    invoice_data: invoiceData,
    details: {
      source_file: params.file.file_name ?? "invoice.pdf",
      page_count: pageCount,
      extracted_text_chars: cleaned.length,
      note: "Rule-based MVP extraction. No external OCR or AI service was used.",
    },
  };
}
