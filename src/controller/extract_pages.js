const { PDFDocument, rgb, degrees } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const fileModel = require("../models/file_model");

// Ensure directories exist
const downloadDir = path.join("downloads");
const uploadDir = path.join("uploads");
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Function to generate output file path
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

// Reusable function for client ID determination
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

// Helper function to safely delete a file with logging
const safeUnlink = async (filePath, fileName = "unknown") => {
  if (!filePath) {
    console.warn(`No file path provided for deletion (file: ${fileName})`);
    return;
  }
  try {
    if (fs.existsSync(filePath)) {
      await unlinkAsync(filePath);
      console.log(`Successfully deleted file: ${filePath}`);
    } else {
      console.warn(`File not found for deletion: ${filePath}`);
    }
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err.message);
  }
};

// Helper function to parse page ranges and validate against page count
const parsePageRanges = (rangesStr, pageCount) => {
  const pageNumbers = [];
  let hasValidRanges = false;
  const invalidRanges = [];

  // Clean the input: remove surrounding quotes and extra whitespace
  let cleanedRangesStr = rangesStr || "";
  cleanedRangesStr = cleanedRangesStr.replace(/^"|"$/g, "").trim(); // Remove surrounding quotes
  if (!cleanedRangesStr) {
    console.warn("No page ranges provided; will process all pages");
    for (let i = 1; i <= pageCount; i++) {
      pageNumbers.push(i);
    }
    hasValidRanges = pageCount > 0;
    return { pageNumbers, hasValidRanges, invalidRanges };
  }

  // Split and clean parts
  const rangeParts = cleanedRangesStr
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  for (const part of rangeParts) {
    try {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map((num) => parseInt(num.trim()));
        if (isNaN(start) || isNaN(end) || start < 1 || end < 1 || start > end) {
          console.warn(`Invalid page range: ${part}`);
          invalidRanges.push(part);
          continue;
        }
        if (start > pageCount || end > pageCount) {
          console.warn(
            `Page range ${part} exceeds PDF page count (${pageCount})`
          );
          invalidRanges.push(part);
          continue;
        }
        for (let i = start; i <= end; i++) {
          if (!pageNumbers.includes(i)) {
            pageNumbers.push(i);
          }
        }
        hasValidRanges = true;
      } else {
        const pageNum = parseInt(part);
        if (isNaN(pageNum) || pageNum < 1) {
          console.warn(`Invalid page number: ${part}`);
          invalidRanges.push(part);
          continue;
        }
        if (pageNum > pageCount) {
          console.warn(`Page ${part} exceeds PDF page count (${pageCount})`);
          invalidRanges.push(part);
          continue;
        }
        if (!pageNumbers.includes(pageNum)) {
          pageNumbers.push(pageNum);
        }
        hasValidRanges = true;
      }
    } catch (err) {
      console.warn(`Error parsing page range part ${part}: ${err.message}`);
      invalidRanges.push(part);
    }
  }

  // Sort page numbers
  pageNumbers.sort((a, b) => a - b);

  return { pageNumbers, hasValidRanges, invalidRanges };
};

// PDF Pages Export endpoint
exports.ExportPdfPages = async (req, res) => {
  const pageRangesStr = req.body.pageRanges || req.query.pageRanges || "";
  const includeOriginalMetadata = req.body.includeMetadata || false;

  getClientIdAndProcess(req, res, async (clientId) => {
    let outputFilePath = null;
    const inputFilePath = req.file?.path;

    try {
      // Validate input file
      if (!req.file || !inputFilePath) {
        return res
          .status(400)
          .json({ error: "No file provided for processing" });
      }

      // Check if file exists and is accessible
      console.log(`Checking input file: ${inputFilePath}`);
      if (!fs.existsSync(inputFilePath)) {
        return res
          .status(404)
          .json({ error: `Input file not found at ${inputFilePath}` });
      }

      // Verify file is not empty
      const fileStats = fs.statSync(inputFilePath);
      if (fileStats.size === 0) {
        return res.status(400).json({ error: "Input file is empty" });
      }

      // Load input PDF and get page count
      console.log(`Processing file: ${inputFilePath}`);
      const inputPdfBytes = fs.readFileSync(inputFilePath);
      const inputPdfDoc = await PDFDocument.load(inputPdfBytes);
      const pageCount = inputPdfDoc.getPageCount();
      console.log(`Input PDF page count: ${pageCount}`);

      // Parse page ranges
      console.log(`Parsing page ranges: "${pageRangesStr}"`);
      const { pageNumbers, hasValidRanges, invalidRanges } = parsePageRanges(
        pageRangesStr,
        pageCount
      );

      // Check if any valid pages were provided
      if (!hasValidRanges && pageRangesStr.trim() !== "") {
        return res.status(400).json({
          error: `No valid page ranges provided. Invalid ranges: ${invalidRanges.join(
            ", "
          )}`,
        });
      }

      // Create a new PDF document
      const outputPdfDoc = await PDFDocument.create();

      // Copy specified pages from input to output PDF
      const copiedPages = await outputPdfDoc.copyPages(
        inputPdfDoc,
        pageNumbers.map((num) => num - 1)
      );
      copiedPages.forEach((page) => outputPdfDoc.addPage(page));

      // Preserve metadata if requested
      if (includeOriginalMetadata) {
        const metadata = inputPdfDoc.getInfoDict();
        for (const [key, value] of metadata) {
          if (value) {
            outputPdfDoc.setInfo(key, value);
          }
        }
      }

      // Save the output PDF
      outputFilePath = createOutputFilePath("pdf");
      const outputPdfBytes = await outputPdfDoc.save();
      fs.writeFileSync(outputFilePath, outputPdfBytes);
      console.log(`Saved exported pages at ${outputFilePath}`);

      // Delete input file
      await safeUnlink(inputFilePath, req.file.originalname);

      // Generate download URL
      const downloadUrl = `${req.protocol}://${req.get(
        "host"
      )}/${outputFilePath}`;

      // Save to database
      const pdfFileRecord = await fileModel
        .create({
          fileType: "pdf",
          fileUrl: downloadUrl,
          userId: clientId,
          action: `exported PDF pages (${pageRangesStr})`,
          fileName: `${req.file.originalname.replace(".pdf", "_exported.pdf")}`,
          icon: "pdf_export",
        })
      res.status(200).json({
        message:
          "PDF pages exported successfully. Use the link to download the exported file.",
        fileId: pdfFileRecord._id,
      });
    } catch (err) {
      console.error("Error exporting PDF pages:", err.stack);
      if (inputFilePath && fs.existsSync(inputFilePath)) {
        await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
      }
      res
        .status(400)
        .json({ error: `Failed to export PDF pages: ${err.message}` });
    }
  });
};
