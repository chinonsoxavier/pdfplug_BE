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

// Function to create output PDF file path
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

// JPG to PDF conversion endpoint
exports.JpgToPdf = async (req, res) => {
  // Get options from request body or query
  const marginSetting = req.body.margin || req.query.margin || "medium";
  const orientationSetting =
    req.body.orientation || req.query.orientation || "portrait";

  // Map margin settings to points (1 inch = 72 points)
  const marginMap = {
    small: 36, // 0.5 inch
    medium: 72, // 1 inch
    large: 108, // 1.5 inches
  };

  // Map orientation to page dimensions (in points)
  const orientationMap = {
    portrait: { width: 612, height: 792 }, // 8.5 x 11 inches
    landscape: { width: 792, height: 612 }, // 11 x 8.5 inches
  };

  const marginValue = marginMap[marginSetting] || marginMap["medium"];
  const orientation =
    orientationMap[orientationSetting] || orientationMap["portrait"];

  getClientIdAndProcess(req, res, async (clientId) => {
    let outputFilePath = null;
    const inputFilePath = req.file?.path;

    try {
      // Validate input file
      if (!req.file || !fs.existsSync(inputFilePath)) {
        return res.status(400).json({
          error: `Input file not found at ${inputFilePath || "undefined"}`,
        });
      }

      // Validate file type
      if (!req.file.mimetype.match(/image\/jpe?g/)) {
        return res
          .status(400)
          .json({ error: `File '${req.file.originalname}' is not a JPG.` });
      }

      console.log(`Processing file: ${inputFilePath}`);

      // Read file into buffer and delete immediately
      const jpgBuffer = fs.readFileSync(inputFilePath);
      await safeUnlink(inputFilePath, req.file.originalname);

      // Load JPG image from buffer
      const pdfDoc = await PDFDocument.create();
      const jpgImage = await pdfDoc.embedJpg(jpgBuffer);

      // Create a page with specified dimensions
      const page = pdfDoc.addPage([orientation.width, orientation.height]);

      // Scale image to fit within margins
      const { width: imgWidth, height: imgHeight } = jpgImage.scale(1);
      const maxWidth = orientation.width - 2 * marginValue;
      const maxHeight = orientation.height - 2 * marginValue;
      const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
      const scaledWidth = imgWidth * scale;
      const scaledHeight = imgHeight * scale;

      // Center image on page
      const x = marginValue + (maxWidth - scaledWidth) / 2;
      const y = marginValue + (maxHeight - scaledHeight) / 2;

      page.drawImage(jpgImage, {
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
        rotate: orientationSetting === "landscape" ? degrees(90) : degrees(0),
      });

      // Save PDF
      const pdfBytes = await pdfDoc.save();
      outputFilePath = createOutputPdfPath(marginSetting, orientationSetting);
      fs.writeFileSync(outputFilePath, pdfBytes);

      console.log(`Saving asset at ${outputFilePath}`);
      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      // Save to database
      const pdfFileRecord = await fileModel.create({
        fileType: "pdf",
        fileUrl: downloadUrl,
        userId: clientId,
        action: `converted jpg to pdf (${orientationSetting}, ${marginSetting} margin)`,
        fileName: `${req.file.originalname.replace(/\.(jpg|jpeg)$/i, ".pdf")}`,
        icon: "jpg_to_pdf",
        metadata: {
          originalFileName: req.file.originalname,
          conversionDate: new Date(),
          orientation: orientationSetting,
          margin: marginSetting,
        },
      });

      res.status(200).json({
        message:
          "File converted successfully. Use the link to download the PDF file.",
        options: {
          margin: marginSetting,
          orientation: orientationSetting,
        },
        file: {
          fileId: pdfFileRecord._id,
          downloadUrl: downloadUrl,
          fileName: `${req.file.originalname.replace(
            /\.(jpg|jpeg)$/i,
            ".pdf"
          )}`,
        },
      });
    } catch (err) {
      console.error("Error converting JPG to PDF:", err);
      res
        .status(400)
        .json({ error: `Failed to convert JPG to PDF: ${err.message}` });
    }
  });
};
