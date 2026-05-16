import React, { useMemo, useState } from "react";

type OutputFile = {
  file_name: string;
  download_url: string;
  size_bytes?: number;
};

type ToolResult = {
  operation?: string;
  status?: "ready" | "processing" | "completed" | "error";
  summary_ar?: string;
  summary_en?: string;
  files?: OutputFile[];
  details?: Record<string, unknown>;
};

type Props = {
  result?: ToolResult;
  onStart?: () => void;
};

export function PdfProEditor({ result, onStart }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const status = result?.status ?? "ready";
  const title = useMemo(() => operationTitle(result?.operation), [result?.operation]);

  return (
    <main className="card" dir="rtl">
      <header>
        <h1>{title}</h1>
        <p>Edit, convert, OCR, and repair PDFs directly inside ChatGPT.</p>
        <p>ارفع ملفات PDF، ثم اكتب طلبك في المحادثة. ChatGPT سيختار الأداة المناسبة.</p>
      </header>

      <label className="drop">
        <strong>اسحب ملفات PDF هنا</strong>
        <span>أو اختر الملفات من جهازك</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
        />
      </label>

      <ul className="files">
        {files.map((file) => (
          <li key={file.name}>
            <span>{file.name}</span>
            <span>{formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>

      <button type="button" onClick={onStart}>
        ابدأ المعالجة
      </button>

      <section className="status" data-state={status}>
        <span>{statusLabel(status)}</span>
        <span>{result?.summary_ar ?? "بانتظار الملفات أو نتيجة الأداة."}</span>
      </section>

      {result ? (
        <section className="result visible">
          <div className="summary">{result.summary_ar ?? result.summary_en}</div>
          <div className="download-list">
            {(result.files ?? []).map((file) => (
              <a key={file.download_url} className="download" href={file.download_url}>
                تحميل {file.file_name}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function operationTitle(operation?: string) {
  const labels: Record<string, string> = {
    upload_pdf: "رفع ملف PDF",
    analyze_pdf: "تحليل ملف PDF",
    merge_pdfs: "دمج ملفات PDF",
    split_pdf: "تقسيم ملف PDF",
    reorder_pages: "إعادة ترتيب الصفحات",
    rotate_pages: "تدوير الصفحات",
    delete_pages: "حذف الصفحات",
    compress_pdf: "ضغط ملف PDF",
    add_watermark: "إضافة علامة مائية",
    add_signature: "إضافة توقيع",
    fill_pdf_form: "تعبئة نموذج PDF",
    ocr_pdf: "OCR",
    extract_text: "استخراج النص",
    extract_images: "استخراج الصور",
    compare_pdfs: "مقارنة ملفات PDF",
    export_pdf: "تصدير PDF",
  };
  return operation ? labels[operation] ?? "PDF Pro Editor" : "PDF Pro Editor";
}

function statusLabel(status: ToolResult["status"]) {
  return {
    ready: "جاهز",
    processing: "جاري المعالجة",
    completed: "اكتمل",
    error: "حدث خطأ",
  }[status ?? "ready"];
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
