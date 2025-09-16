const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const fileModel = require("../models/file_model");

// Ensure directories exist
const downloadDir = path.join("downloads");
const uploadDir = path.join("uploads");

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
  cleanedRangesStr = cleanedRangesStr.replace(/^"|"$/g, "").trim();
  if (!cleanedRangesStr) {
    console.warn("No page ranges provided; will process all pages");
    for (let i = 1; i <= pageCount; i++) {
      pageNumbers.push(i);
    }
    hasValidRanges = pageCount > 0;
    return { pageNumbers, hasValidRanges, invalidRanges };
  }

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

// Helper function to get text position coordinates
const getPositionCoordinates = (
  position,
  pageWidth,
  pageHeight,
  textWidth,
  textHeight
) => {
  const margin = 50; // Margin from edges
  switch (position.toLowerCase()) {
    case "top-left":
      return { x: margin, y: pageHeight - margin - textHeight };
    case "top-center":
      return {
        x: (pageWidth - textWidth) / 2,
        y: pageHeight - margin - textHeight,
      };
    case "top-right":
      return {
        x: pageWidth - margin - textWidth,
        y: pageHeight - margin - textHeight,
      };
    case "bottom-left":
      return { x: margin, y: margin };
    case "bottom-center":
      return { x: (pageWidth - textWidth) / 2, y: margin };
    case "bottom-right":
      return { x: pageWidth - margin - textWidth, y: margin };
    default:
      return { x: (pageWidth - textWidth) / 2, y: margin }; // Default to bottom-center
  }
};

// PDF Page Numbering endpoint
exports.AddPageNumbers = async (req, res) => {
  const startPosition = parseInt(req.body.startPosition) || 1; // Default starts at page 1
  const position = req.body.position || req.query.position || "bottom-center"; // Default position
  const fontSize = parseInt(req.body.fontSize) || 12; // Default font size
  const colorHex = req.body.color || req.query.color || "#000000"; // Default black color
  console.log(position);
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

      console.log(`Processing file: ${inputFilePath}`);

      // Read file into buffer
      const pdfBuffer = fs.readFileSync(inputFilePath);

      // Load input PDF
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();
      console.log(`Input PDF page count: ${pageCount}`);

      // Parse page ranges (if provided)
      console.log(`Parsing page ranges: "${req.body.pageRanges || ""}"`);
      const { pageNumbers, hasValidRanges, invalidRanges } = parsePageRanges(
        req.body.pageRanges || "",
        pageCount
      );

      // Check if any valid pages were provided
      if (!hasValidRanges && (req.body.pageRanges || "").trim() !== "") {
        return res.status(400).json({
          error: `No valid page ranges provided. Invalid ranges: ${invalidRanges.join(
            ", "
          )}`,
        });
      }

      // Embed a font for text rendering
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Parse colorHex to RGB
      const hex = colorHex.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;

      // Add page numbers to specified pages
      const pages = pdfDoc.getPages();
      for (let i = 0; i < pageCount; i++) {
        // Only add page numbers to pages in pageNumbers (1-based)
        if (pageNumbers.includes(i + 1)) {
          const page = pages[i];
          const pageNumberText = `${startPosition + i}`;
          const textWidth = font.widthOfTextAtSize(pageNumberText, fontSize);
          const textHeight = font.heightAtSize(fontSize);

          // Get position coordinates
          const { x, y } = getPositionCoordinates(
            position,
            page.getWidth(),
            page.getHeight(),
            textWidth,
            textHeight
          );

          // Draw page number
          page.drawText(pageNumberText, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(r, g, b),
          });
        }
      }

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      outputFilePath = createOutputFilePath("pdf");
      fs.writeFileSync(outputFilePath, pdfBytes);
      console.log(`Saved numbered PDF at ${outputFilePath}`);

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
          action: `added page numbers to PDF (starting at ${startPosition}, ${position}, size: ${fontSize}px, color: ${colorHex})`,
          fileName: `${req.file.originalname.replace(".pdf", "_numbered.pdf")}`,
          icon: "pdf_number",
        })
        ;

      res.status(200).json({
        message:
          "PDF page numbers added successfully. Use the link to download the numbered file.",
        fileId: pdfFileRecord._id,
        fileUrl: downloadUrl,
      });
    } catch (err) {
      console.error("Error adding page numbers to PDF:", err.stack);
      if (inputFilePath && fs.existsSync(inputFilePath)) {
        await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
      }
      res.status(400).json({
        error: `Failed to add page numbers to PDF: ${err.message}`,
      });
    }
  });
};
