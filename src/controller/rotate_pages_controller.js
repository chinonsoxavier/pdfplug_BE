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

// Function to create output PDF file path for JpgToPdf (from your original code)
function createOutputPdfPath(marginSetting, orientationSetting) {
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
  return `${downloadDir}/${dateString}_${orientationSetting}_${marginSetting}_margin.pdf`;
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

exports.RotatePdf = async (req, res) => {
  // Get rotation angle from request body or query (default: 90 degrees)
  const angle = parseInt(req.body.angle || req.query.angle || 90, 10);
  const validAngles = [0, 90, 180, 270];
  if (!validAngles.includes(angle)) {
    return res.status(400).json({
      error: `Invalid rotation angle: ${angle}. Must be one of ${validAngles.join(
        ", "
      )}.`,
    });
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
      console.log("File received for rotation:", {
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

      // Validate file type
      if (req.file.mimetype !== "application/pdf") {
        await safeUnlink(inputFilePath, originalFileName);
        return res
          .status(400)
          .json({ error: `File '${originalFileName}' is not a PDF.` });
      }

      // Load the input PDF
      const pdfBytes = fs.readFileSync(inputFilePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // Rotate all pages
      const pages = pdfDoc.getPages();
      for (const page of pages) {
        // Get current rotation and add the new angle (pdf-lib uses additive rotation)
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees((currentRotation + angle) % 360));
      }

      // Save rotated PDF
      outputFilePath = createOutputFilePath("pdf");
      const rotatedPdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputFilePath, rotatedPdfBytes);
      console.log(`Saving rotated PDF at ${outputFilePath}`);

      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      // Save to database
      const pdfFileRecord = await fileModel
        .create({
          fileType: "pdf",
          fileUrl: downloadUrl,
          userId: clientId,
          action: `rotated PDF pages by ${angle} degrees`,
          fileName: `rotated_${originalFileName}`,
          icon: "rotate_pdf",
        });
      // Clean up input file
      console.log(pdfFileRecord._id, "file id");
      res.status(200).json({
        message: `PDF pages rotated successfully by ${angle} degrees. Use the link to download.`,
          fileId: pdfFileRecord?._id,
          downloadUrl: downloadUrl,
          fileName: `rotated_${originalFileName}`,
      });
    } catch (err) {
      console.error("Error rotating PDF:", err);
      res.status(400).json({ error: `Failed to rotate PDF: ${err.message}` });
    } finally {
      await safeUnlink(inputFilePath, originalFileName);
    }
  });
};
