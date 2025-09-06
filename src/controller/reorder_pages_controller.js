const { PDFDocument, rgb, degrees } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const fileModel = require("../models/file_model");

// Ensure directories exist
const downloadDir = path.join("downloads");
const uploadDir = path.join("Uploads");
try {
  if (!fs.existsSync(downloadDir))
    fs.mkdirSync(downloadDir, { recursive: true });
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  console.error("Failed to create directories:", err.message);
  process.exit(1);
}

// Function to generate output file path (from your original code)
function createOutputFilePath(ext) {
  const date = new Date();
  const dateString =
    date.getFullYear() +
    "-" +
    ("0" + (date.getMonth() + 1)).slice(-2) +
    "-" +
    ("0" + date.getDate()).slice(-2) +
    "T" +
    ("0" + date.getHours()).slice(-2) +
    "-" +
    ("0" + date.getMinutes()).slice(-2) +
    "-" +
    ("0" + date.getSeconds()).slice(-2);
  return `${downloadDir}/${dateString}.${ext}`;
}

// Reusable function for client ID determination (from your original code)
const getClientIdAndProcess = (req, res, callback) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;
  if (userId) {
    return callback(userId);
  }
  if (guestId) {
    console.log(guestId, "oldguest");
    return callback(guestId);
  }
  const newGuestId = new mongoose.Types.ObjectId().toString();
  req.session.guestId = newGuestId;
  console.log(newGuestId, "newGuest");
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Failed to save session" });
    }
    callback(newGuestId);
  });
};

// Helper function to safely delete a file with retry and logging
const safeUnlink = async (
  filePath,
  fileName = "unknown",
  retries = 3,
  delayMs = 100
) => {
  if (!filePath) {
    console.warn(`No file path provided for deletion (file: ${fileName})`);
    return;
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (fs.existsSync(filePath)) {
        await unlinkAsync(filePath);
        console.log(
          `Successfully deleted file: ${filePath} (attempt ${attempt})`
        );
        return;
      } else {
        console.warn(
          `File not found for deletion: ${filePath} (attempt ${attempt})`
        );
        return;
      }
    } catch (err) {
      console.error(
        `Failed to delete file ${filePath} (attempt ${attempt}):`,
        err.message
      );
      if (attempt < retries) {
        console.log(`Retrying deletion after ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  console.error(`Failed to delete ${filePath} after ${retries} attempts`);
};

// Reorder PDF pages endpoint
exports.reorderPdf = async (req, res) => {
  // Get page order from request body or query (e.g., [3, 4, 1, 2])
  let pageOrder = req.body.pageOrder || req.query.pageOrder;
  if (typeof pageOrder === "string") {
    try {
      pageOrder = JSON.parse(pageOrder);
    } catch (err) {
      return res
        .status(400)
        .json({ error: `Invalid pageOrder format: ${err.message}` });
    }
  }

  getClientIdAndProcess(req, res, async (clientId) => {
    let outputFilePath = null;
    const inputFilePath = req.file?.path;
    const originalFileName = req.file?.originalname || "unknown";

    try {
      // Validate input file
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      console.log("File received for reorder:", {
        path: inputFilePath,
        originalname: originalFileName,
        mimetype: req.file.mimetype,
      });
      if (!fs.existsSync(inputFilePath)) {
        console.error(`Input file does not exist: ${inputFilePath}`);
        return res
          .status(400)
          .json({ error: `Input file not found at ${inputFilePath}` });
      }

      if (req.file.mimetype !== "application/pdf") {
        await safeUnlink(inputFilePath, originalFileName);
        return res
          .status(400)
          .json({ error: `File '${originalFileName}' is not a PDF.` });
      }

      // Load the input PDF
      const pdfBytes = fs.readFileSync(inputFilePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pageCount = pdfDoc.getPageCount();

      // Validate pageOrder
      if (!Array.isArray(pageOrder) || pageOrder.length === 0) {
        // await safeUnlink(inputFilePath, originalFileName);
        return res
          .status(400)
          .json({ error: "pageOrder must be a non-empty array" });
      }
      const pageSet = new Set(pageOrder);
      if (pageSet.size !== pageOrder.length) {
        // await safeUnlink(inputFilePath, originalFileName);
        return res
          .status(400)
          .json({ error: "pageOrder contains duplicate page numbers" });
      }

      for (const pageNum of pageOrder) {
        if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pageCount) {
          return res.status(400).json({
            error: `Invalid page number ${pageNum}: must be an integer between 1 and ${pageCount}`,
          });
        }
      }

      // Create a new PDF document
      const newPdfDoc = await PDFDocument.create();

      // Copy pages in the specified order (convert 1-based to 0-based indexing)
      const pageIndices = pageOrder.map((num) => num - 1);
      const copiedPages = await newPdfDoc.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach((page) => newPdfDoc.addPage(page));

      // Save reordered PDF
      outputFilePath = createOutputFilePath("pdf");
      const reorderedPdfBytes = await newPdfDoc.save();
      fs.writeFileSync(outputFilePath, reorderedPdfBytes);
      console.log(`Saving reordered PDF at ${outputFilePath}`);

      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      // Save to database
      const pdfFileRecord = await fileModel
        .create({
          fileType: "pdf",
          fileUrl: downloadUrl,
          userId: clientId,
          action: `reordered PDF pages to [${pageOrder.join(", ")}]`,
          fileName: `reordered_${originalFileName}`,
          icon: "reorder_pdf",
        })

      // Clean up input file
      // await safeUnlink(inputFilePath, originalFileName);

      res.status(200).json({
        message: `PDF pages reordered successfully to [${pageOrder.join(
          ", "
        )}]. Use the link to download.`,
        file: {
          fileId: pdfFileRecord._id,
          downloadUrl: downloadUrl,
          fileName: `reordered_${originalFileName}`,
        },
      });
    } catch (err) {
      console.error("Error reordering PDF:", err);
      res.status(400).json({ error: `Failed to reorder PDF: ${err.message}` });
    } finally {
      await safeUnlink(inputFilePath, originalFileName);
    }
  });
};
