const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const archiver = require("archiver");
const stream = require("stream");
const { pipeline } = stream;
const { PDFDocument } = require("pdf-lib");
const { promisify } = require("util");
const streamPipeline = promisify(pipeline);
const fsp = fs.promises;
const fileModel = require("../models/file_model");

// Ensure directories exist
const downloadDir = path.join("downloads");
const uploadDir = path.join("uploads");
// Helper function to safely delete a file with logging
const safeUnlink = async (filePath, fileName = "unknown") => {
  if (!filePath) {
    console.warn(`No file path provided for deletion (file: ${fileName})`);
    return;
  }
  try {
    if (fs.existsSync(filePath)) {
      await fsp.unlink(filePath);
      console.log(`Successfully deleted file: ${filePath}`);
    } else {
      console.warn(`File not found for deletion: ${filePath}`);
    }
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err.message);
  }
};

// Helper function to parse and validate page ranges
const parsePageRanges = (rangesInput, pageCount) => {
  let ranges = [];
  const invalidRanges = [];

  // Handle both string and array inputs
  let rangeParts;
  if (typeof rangesInput === "string") {
    rangeParts = rangesInput
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part);
  } else if (Array.isArray(rangesInput)) {
    rangeParts = rangesInput.filter(
      (part) => typeof part === "string" && part.trim()
    );
  } else {
    console.warn("Invalid page ranges format; defaulting to all pages");
    ranges.push({ start: 1, end: pageCount });
    return { ranges, invalidRanges };
  }

  let lastTo = 0;
  for (const part of rangeParts) {
    try {
      let start, end;
      if (part.includes("-")) {
        [start, end] = part.split("-").map((num) => parseInt(num.trim()));
        if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
          console.warn(`Invalid range: ${part}`);
          invalidRanges.push(part);
          continue;
        }
        if (start > pageCount || end > pageCount) {
          console.warn(`Range ${part} exceeds PDF page count (${pageCount})`);
          invalidRanges.push(part);
          continue;
        }
        if (start <= lastTo) {
          console.warn(
            `Range ${part} overlaps or is out of order with previous range (lastTo: ${lastTo})`
          );
          invalidRanges.push(part);
          continue;
        }
        ranges.push({ start, end });
        lastTo = end;
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
        if (pageNum <= lastTo) {
          console.warn(
            `Page ${part} overlaps or is out of order with previous range (lastTo: ${lastTo})`
          );
          invalidRanges.push(part);
          continue;
        }
        ranges.push({ start: pageNum, end: pageNum });
        lastTo = pageNum;
      }
    } catch (err) {
      console.warn(`Error parsing range ${part}: ${err.message}`);
      invalidRanges.push(part);
    }
  }

  if (ranges.length === 0) {
    console.warn("No valid ranges provided; defaulting to all pages");
    ranges.push({ start: 1, end: pageCount });
  }

  return { ranges, invalidRanges };
};

// Reusable function for client ID determination
const getClientIdAndProcess = (req, res, callback) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;
  if (userId) {
    console.log(`Using userId: ${userId}`);
    return callback(userId);
  }
  if (guestId) {
    console.log(`Using guestId: ${guestId}`);
    return callback(guestId);
  }
  const newGuestId = new mongoose.Types.ObjectId().toString();
  console.log(`Generated new guestId: ${newGuestId}`);
  req.session.guestId = newGuestId;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Failed to save session" });
    }
    callback(newGuestId);
  });
};

exports.SplitPDF = async (req, res) => {
  console.log("Raw request payload:", {
    body: req.body,
    query: req.query,
    file: req.file
      ? { originalname: req.file.originalname, path: req.file.path }
      : null,
  });

  const inputFilePath = req.file?.path;
  let pageRangesInput = req.body.pageRanges ||
    req.query.pageRanges || ["1-3", "4"];
  console.log(`Received pageRanges: ${JSON.stringify(pageRangesInput)}`);

  if (!inputFilePath || !fs.existsSync(inputFilePath)) {
    console.error("No file provided or file not found");
    return res
      .status(400)
      .json({ error: "No file provided or file not found." });
  }

  const stats = fs.statSync(inputFilePath);
  if (stats.size === 0) {
    console.error("Input file is empty");
    return res.status(400).json({ error: "Uploaded file is empty" });
  }

  getClientIdAndProcess(req, res, async (clientId) => {
    const tempDir = path.join(downloadDir, `temp_${Date.now()}`);
    const zipFilePath = path.join(downloadDir, `split_pdf_${Date.now()}.zip`);
    const originalFilename = req.file.originalname.split(".")[0];

    try {
      // Create directories
      await fsp.mkdir(tempDir, { recursive: true });
      console.log(`Created temporary directory: ${tempDir}`);

      // Load the original PDF
      console.log(`Loading PDF from: ${inputFilePath}`);
      const pdfBytes = await fsp.readFile(inputFilePath);
      let pdfDoc;
      try {
        pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
      } catch (err) {
        console.error("Failed to load PDF:", err.message);
        return res
          .status(400)
          .json({ error: `Invalid or encrypted PDF: ${err.message}` });
      }
      const pageCount = pdfDoc.getPageCount();
      console.log(`Input PDF page count: ${pageCount}`);

      // Parse and validate page ranges
      const { ranges, invalidRanges } = parsePageRanges(
        pageRangesInput,
        pageCount
      );
      if (invalidRanges.length > 0) {
        console.warn(`Invalid ranges detected: ${invalidRanges.join(", ")}`);
        return res.status(400).json({
          error: `Invalid page ranges: ${invalidRanges.join(", ")}`,
        });
      }
      console.log("Validated ranges:", ranges);

      // Split PDF into parts
      const outputFiles = [];
      for (let i = 0; i < ranges.length; i++) {
        const { start, end } = ranges[i];
        console.log(`Processing range ${start}-${end}`);
        const newPdfDoc = await PDFDocument.create();
        const pageIndices = Array.from(
          { length: end - start + 1 },
          (_, k) => start - 1 + k
        );
        const pages = await newPdfDoc.copyPages(pdfDoc, pageIndices);
        pages.forEach((page) => newPdfDoc.addPage(page));
        const outputBytes = await newPdfDoc.save();
        const tempFilePath = path.join(
          tempDir,
          `${originalFilename}_part_${i + 1}.pdf`
        );
        await fsp.writeFile(tempFilePath, outputBytes);
        console.log(`Saved part ${i + 1} to ${tempFilePath}`);
        outputFiles.push(tempFilePath);
      }

      // Create a zip file
      console.log(`Creating zip file at ${zipFilePath}`);
      const zipOutputStream = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("warning", (err) => console.warn("Archiver warning:", err));
      archive.on("error", (err) => {
        console.error("Archiver error:", err);
        throw err;
      });
      archive.directory(tempDir, false);
      archive.finalize();
      await streamPipeline(archive, zipOutputStream);
      console.log(`Zip file created: ${zipFilePath}`);

      // Clean up
      await fsp.rm(tempDir, { recursive: true, force: true });

      // Save to database
      const downloadUrl = `${req.protocol}://${req.get("host")}/${zipFilePath}`;
      const newFileRecord = await fileModel.create({
        fileType: "zip",
        fileUrl: downloadUrl,
        userId: clientId,
        action: `split PDF into ${ranges.length} files and compressed`,
        fileName: `pdfplug${originalFilename}_split.zip`,
        icon: "split_pdf_pages",
      });
      res.status(200).json({
        message:
          "PDF split and compressed successfully. Use the link to download the zip file.",
        fileId: newFileRecord._id,
        fileUrl: downloadUrl,
      });
    } catch (err) {
      console.error("Error splitting PDF:", err.stack);
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
      res.status(400).json({
        error: `Failed to split PDF: ${err.message}`,
      });
    }
  });
};

