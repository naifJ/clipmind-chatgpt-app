import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

import type { FileReference } from "../src/lib/types.js";
import { mergePdfs } from "../src/tools/mergePdfs.js";
import { splitPdf } from "../src/tools/splitPdf.js";
import { addWatermark, deletePages, imagesToPdf, reorderPages } from "../src/tools/pdfProTools.js";

const publicBaseUrl = "http://localhost:8787";

async function makePdf(lines: string[], pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${lines.join(" ")} page ${pageIndex + 1}`, {
      x: 50,
      y: 720,
      size: 12,
      font,
    });
  }
  return Buffer.from(await pdf.save());
}

function pdfRef(bytes: Buffer, fileName: string): FileReference {
  return {
    download_url: `data:application/pdf;base64,${bytes.toString("base64")}`,
    file_name: fileName,
    mime_type: "application/pdf",
  };
}

function pngRef(): FileReference {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  return {
    download_url: `data:image/png;base64,${png.toString("base64")}`,
    file_name: "pixel.png",
    mime_type: "image/png",
  };
}

test("mergePdfs combines source PDFs", async () => {
  const first = pdfRef(await makePdf(["first"]), "a.pdf");
  const second = pdfRef(await makePdf(["second"], 2), "b.pdf");

  const result = await mergePdfs({
    files: [first, second],
    output_name: "merged.pdf",
    publicBaseUrl,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.files.length, 1);
  assert.equal(result.details?.total_pages, 3);
});

test("splitPdf exports requested ranges", async () => {
  const source = pdfRef(await makePdf(["split"], 4), "source.pdf");
  const result = await splitPdf({
    file: source,
    ranges: "1-2,3-4",
    output_prefix: "part",
    publicBaseUrl,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.files.length, 2);
});

test("reorderPages, deletePages, and addWatermark create output PDFs", async () => {
  const source = pdfRef(await makePdf(["ops"], 3), "ops.pdf");

  const reordered = await reorderPages({
    file: source,
    order: [3, 1, 2],
    publicBaseUrl,
  });
  assert.equal(reordered.files.length, 1);

  const deleted = await deletePages({
    file: source,
    pages: "2",
    publicBaseUrl,
  });
  assert.equal(deleted.details?.kept_pages instanceof Array, true);

  const watermarked = await addWatermark({
    file: source,
    text: "CONFIDENTIAL",
    publicBaseUrl,
  });
  assert.equal(watermarked.status, "completed");

  const imageWatermarked = await addWatermark({
    file: source,
    watermark_image: pngRef(),
    publicBaseUrl,
  });
  assert.equal(imageWatermarked.status, "completed");
});

test("imagesToPdf creates a PDF from PNG input", async () => {
  const result = await imagesToPdf({
    images: [pngRef()],
    output_name: "image-output.pdf",
    publicBaseUrl,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.mime_type, "application/pdf");
});
