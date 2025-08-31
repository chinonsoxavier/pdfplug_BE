const router = require("express").Router();
const { pdftoword } = require("../controller/pdf_to_word");
const { Wordtopdf } = require("../controller/word_to_pdf");
const tools_controller = require("../controller/tools_controller");
const { upload } = require("../utils/multer");
const { mergePdfs } = require("../controller/merge_pdf_controller");
const { compressPdf } = require("../controller/compress_pdf");
const { PdfToJpg } = require("../controller/pdf_to_jpg_controller");
const { JpgToPdf } = require("../controller/jpg_to_pdf");
const { RotatePdf } = require("../controller/rotate_pages_controller");
const { reorderPdf } = require("../controller/reorder_pages_controller");

router.get("/recent-activities", tools_controller.recentActivities);

router.post("/convert-pdf-to-word", upload.single("pdfFile"), pdftoword);
router.post(
  "/convert-word-to-pdf",
  upload.single("pdfFile"), // You might need a new upload config for DOCX files
  Wordtopdf
);
router.post(
  "/merge-pdfs",
  upload.array("pdfFiles"), // Use upload.array() for multiple files
  mergePdfs
);

router.post(
  "/compress-pdf",
  upload.array("pdfFiles"), // Single file upload for compression
  compressPdf
);

router.post(
  "/convert-pdf-to-jpg",
  upload.single("pdfFiles"), // Use upload.array() for multiple files
  PdfToJpg
);

router.post(
  "/convert-jpg-to-pdf",
  upload.single("pdfFiles"), // Use upload.array() for multiple files
  JpgToPdf
);

router.post(
  "/rotate-pdf-pages",
  upload.single("pdfFiles"), // Use upload.array() for multiple files
  RotatePdf
);

router.post(
  "/reorder-pages",
  upload.single("pdfFiles"), // Use upload.array() for multiple files
  reorderPdf
);

router.get("/download/:fileId", tools_controller.download);

module.exports = router;
