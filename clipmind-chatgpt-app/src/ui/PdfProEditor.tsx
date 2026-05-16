import React, { useMemo, useState } from "react";

type OutputFile = {
  file_name: string;
  mime_type?: string;
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
  onTool?: (name: string, args?: Record<string, unknown>) => void;
};

const tools = [
  ["merge_pdfs", "دمج"],
  ["split_pdf", "تقسيم"],
  ["compress_pdf", "ضغط"],
  ["add_watermark", "علامة مائية"],
  ["rotate_pages", "تدوير"],
  ["delete_pages", "حذف صفحات"],
  ["ocr_pdf", "OCR"],
  ["extract_text", "استخراج نص"],
  ["export_pdf", "تصدير"],
];

export function PdfProEditor({ result, onTool }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [operation, setOperation] = useState("analyze_pdf");
  const [parameter, setParameter] = useState("");
  const status = result?.status ?? "ready";
  const title = useMemo(() => operationTitle(result?.operation), [result?.operation]);
  const outputPdf = result?.files?.find((file) => file.mime_type === "application/pdf");
  const thumbnails = result?.files?.filter((file) => file.mime_type?.startsWith("image/")) ?? [];

  return (
    <main className="app" dir="rtl">
      <header className="topbar">
        <div>
          <h1>PDF Pro Editor</h1>
          <p>Edit, convert, OCR, and repair PDFs directly inside ChatGPT.</p>
        </div>
        <strong>{statusLabel(status)}</strong>
      </header>

      <section className="uploadbar">
        <label className="drop">
          <strong>اسحب ملفات PDF هنا</strong>
          <span>أو اختر ملفات من جهازك لبدء التحرير داخل ChatGPT.</span>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            multiple
            onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
          />
        </label>
        <button type="button" onClick={() => onTool?.("upload_pdf")}>
          إدخال الملف
        </button>
      </section>

      <section className="toolbar">
        {tools.map(([name, label]) => (
          <button key={name} type="button" className="secondary" onClick={() => onTool?.(name)}>
            {label}
          </button>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>الصفحات</h2>
          <div className="thumbs">
            {thumbnails.length ? (
              thumbnails.map((file, index) => <img key={file.download_url} src={file.download_url} alt={`صفحة ${index + 1}`} />)
            ) : (
              <div className="empty">ستظهر الصور المصغرة بعد تحديث المعاينة.</div>
            )}
          </div>
        </aside>

        <section className="preview">
          <div className="preview-head">
            <strong>{title}</strong>
          </div>
          <div className="canvas">
            {outputPdf ? <iframe title="PDF preview" src={outputPdf.download_url} /> : <div className="empty">ارفع ملف PDF لعرضه وتعديله.</div>}
          </div>
        </section>

        <aside className="inspector">
          <h2>إعدادات العملية</h2>
          <div className="inspector-body">
            <ul className="files">
              {files.map((file) => (
                <li key={file.name}>
                  <strong>{file.name}</strong>
                  <span>{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>

            <select value={operation} onChange={(event) => setOperation(event.currentTarget.value)}>
              <option value="analyze_pdf">تحليل الملف</option>
              <option value="split_pdf">تقسيم PDF</option>
              <option value="reorder_pages">إعادة ترتيب الصفحات</option>
              <option value="add_watermark">إضافة علامة مائية</option>
              <option value="images_to_pdf">صور إلى PDF</option>
            </select>
            <input value={parameter} onChange={(event) => setParameter(event.currentTarget.value)} placeholder="نص العلامة أو الصفحات" />
            <button type="button" onClick={() => onTool?.(operation, { parameter })}>
              طبّق التعديل
            </button>

            <div className="summary">{result?.summary_ar ?? "بانتظار ملف PDF."}</div>
            <div className="download-list">
              {(result?.files ?? []).map((file) => (
                <a key={file.download_url} className="download" href={file.download_url}>
                  تحميل {file.file_name}
                </a>
              ))}
            </div>
          </div>
        </aside>
      </section>
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
    convert_pdf_to_images: "PDF إلى صور",
    images_to_pdf: "صور إلى PDF",
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
