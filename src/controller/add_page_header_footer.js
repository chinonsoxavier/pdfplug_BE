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
          console.warn(`Page range ${part} exceeds PDF page count (${pageCount})`);
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

  pageNumbers.sort((a, b) => a - b);
  return { pageNumbers, hasValidRanges, invalidRanges };
};

// Helper function to convert number to Roman numeral
const toRomanNumeral = (num) => {
  const romanMap = [
    { value: 1000, numeral: "M" },
    { value: 900, numeral: "CM" },
    { value: 500, numeral: "D" },
    { value: 400, numeral: "CD" },
    { value: 100, numeral: "C" },
    { value: 90, numeral: "XC" },
    { value: 50, numeral: "L" },
    { value: 40, numeral: "XL" },
    { value: 10, numeral: "X" },
    { value: 9, numeral: "IX" },
    { value: 5, numeral: "V" },
    { value: 4, numeral: "IV" },
    { value: 1, numeral: "I" },
  ];
  let result = "";
  for (const { value, numeral } of romanMap) {
    while (num >= value) {
      result += numeral;
      num -= value;
    }
  }
  return result;
};

// Helper function to get text position coordinates
const getPositionCoordinates = (position, pageWidth, pageHeight, textWidth, textHeight, isHeader) => {
  const margin = 50;
  const yOffset = isHeader ? pageHeight - margin - textHeight : margin;
  console.log(`Calculating position for ${isHeader ? "header" : "footer"}: position=${position}, x=${pageWidth}, y=${pageHeight}, textWidth=${textWidth}, textHeight=${textHeight}`);
  switch (position.toLowerCase()) {
    case "top-left":
      return { x: margin, y: pageHeight - margin - textHeight };
    case "top-center":
      return { x: (pageWidth - textWidth) / 2, y: pageHeight - margin - textHeight };
    case "top-right":
      return { x: pageWidth - margin - textWidth, y: pageHeight - margin - textHeight };
    case "bottom-left":
      return { x: margin, y: margin };
    case "bottom-center":
      return { x: (pageWidth - textWidth) / 2, y: margin };
    case "bottom-right":
      return { x: pageWidth - margin - textWidth, y: margin };
    default:
      console.warn(`Invalid position "${position}", defaulting to ${isHeader ? "top-center" : "bottom-center"}`);
      return { x: (pageWidth - textWidth) / 2, y: isHeader ? pageHeight - margin - textHeight : margin };
  }
};

// PDF Header and Footer endpoint
// exports.AddPageHeaderAndFooter = async (req, res) => {
//   const pageRanges = req.body.pageRanges || req.query.pageRanges || "";
//   const headerLabel = req.body.headerLabel || req.query.headerLabel || "";
//   const footerLabel = req.body.footerLabel || req.query.footerLabel || "";
//   const customHeaderText = req.body.customHeaderText || req.query.customHeaderText || "";
//   const customFooterText = req.body.customFooterText || req.query.customFooterText || "";
//   const position = req.body.position || req.query.position || "bottom-center"; // Default to bottom-center
//   const fontSize = parseInt(req.body.fontSize) || 12; // Default font size
//   const color = req.body.color || req.query.color || "#000000"; // Default black color
//   const includeMetadata = req.body.includeMetadata || false;

//   console.log("Request parameters:", {
//     pageRanges,
//     headerLabel,
//     footerLabel,
//     customHeaderText,
//     customFooterText,
//     position,
//     fontSize,
//     color,
//     includeMetadata,
//   });

//   const validLabels = [
//     "Page 1,Page 2,Page 3",
//     "Page I,Page II,Page III",
//     "Page 1 of 20,Page 2 of 20,Page 3,Page 20",
//     "Filename on each page",
//     "Custom Text",
//     "",
//   ];
//   const validPositions = [
//     "top-left",
//     "top-center",
//     "top-right",
//     "bottom-left",
//     "bottom-center",
//     "bottom-right",
//   ];

//   getClientIdAndProcess(req, res, async (clientId) => {
//     let outputFilePath = null;
//     const inputFilePath = req.file?.path;

//     try {
//       // Validate input file
//       if (!req.file || !inputFilePath) {
//         return res.status(400).json({ error: "No file provided for processing" });
//       }

//       // Check if file exists and is accessible
//       console.log(`Checking input file: ${inputFilePath}`);
//       if (!fs.existsSync(inputFilePath)) {
//         return res.status(404).json({ error: `Input file not found at ${inputFilePath}` });
//       }

//       // Verify file is not empty
//       const fileStats = fs.statSync(inputFilePath);
//       if (fileStats.size === 0) {
//         return res.status(400).json({ error: "Input file is empty" });
//       }

//       console.log(`Processing file: ${inputFilePath}`);

//       // Read file into buffer
//       const pdfBuffer = fs.readFileSync(inputFilePath);

//       // Load input PDF
//       const pdfDoc = await PDFDocument.load(pdfBuffer);
//       const pageCount = pdfDoc.getPageCount();
//       console.log(`Input PDF page count: ${pageCount}`);

//       // Parse page ranges
//       console.log(`Parsing page ranges: "${pageRanges}"`);
//       const { pageNumbers, hasValidRanges, invalidRanges } = parsePageRanges(pageRanges, pageCount);

//       // Check if any valid pages were provided
//       if (!hasValidRanges && pageRanges.trim() !== "") {
//         return res.status(400).json({
//           error: `No valid page ranges provided. Invalid ranges: ${invalidRanges.join(", ")}`,
//         });
//       }

//       // Validate labels
//       if (headerLabel && !validLabels.includes(headerLabel)) {
//         return res.status(400).json({ error: `Invalid header label: ${headerLabel}` });
//       }
//       if (footerLabel && !validLabels.includes(footerLabel)) {
//         return res.status(400).json({ error: `Invalid footer label: ${footerLabel}` });
//       }
//       if (headerLabel === "Custom Text" && !customHeaderText) {
//         return res.status(400).json({ error: "Custom header text is required when headerLabel is 'Custom Text'" });
//       }
//       if (footerLabel === "Custom Text" && !customFooterText) {
//         return res.status(400).json({ error: "Custom footer text is required when footerLabel is 'Custom Text'" });
//       }

//       // Validate position
//       if (!validPositions.includes(position.toLowerCase())) {
//         return res.status(400).json({
//           error: `Invalid position: ${position}. Must be one of: ${validPositions.join(", ")}`,
//         });
//       }

//       // Validate color
//       const colorRegex = /^#[0-9A-Fa-f]{6}$/;
//       if (!colorRegex.test(color)) {
//         return res.status(400).json({ error: "Color must be a valid hex code (e.g., #FF0000)" });
//       }

//       // Parse color to RGB
//       const hex = color.replace("#", "");
//       const r = parseInt(hex.substring(0, 2), 16) / 255;
//       const g = parseInt(hex.substring(2, 4), 16) / 255;
//       const b = parseInt(hex.substring(4, 6), 16) / 255;
//       console.log(`Parsed color: R=${r}, G=${g}, B=${b}`);

//       // Embed a font
//       const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
//       console.log("Font embedded: Helvetica");

//       // Add headers and footers
//       const pages = pdfDoc.getPages();
//       for (let i = 0; i < pageCount; i++) {
//         if (pageNumbers.includes(i + 1)) {
//           const page = pages[i];
//           const pageNumber = i + 1;
//           console.log(`Processing page ${pageNumber}`);

//           // Helper function to get text for header or footer
//           const getText = (label, customText, fileName) => {
//             switch (label) {
//               case "Page 1,Page 2,Page 3":
//                 return `Page ${pageNumber}`;
//               case "Page I,Page II,Page III":
//                 return `Page ${toRomanNumeral(pageNumber)}`;
//               case "Page 1 of 20,Page 2 of 20,Page 3,Page 20":
//                 return `Page ${pageNumber} of ${pageCount}`;
//               case "Filename on each page":
//                 return fileName;
//               case "Custom Text":
//                 return customText;
//               default:
//                 return "";
//             }
//           };

//           // Header
//           if (headerLabel) {
//             const headerText = getText(headerLabel, customHeaderText, req.file.originalname);
//             if (headerText) {
//               const textWidth = font.widthOfTextAtSize(headerText, fontSize);
//               const textHeight = font.heightAtSize(fontSize);
//               const { x, y } = getPositionCoordinates(position, page.getWidth(), page.getHeight(), textWidth, textHeight, true);
//               console.log(`Drawing header: "${headerText}" at x=${x}, y=${y}`);
//               page.drawText(headerText, {
//                 x,
//                 y,
//                 size: fontSize,
//                 font,
//                 color: rgb(r, g, b),
//               });
//             } else {
//               console.warn(`No header text generated for label: ${headerLabel}`);
//             }
//           } else {
//             console.log("No header label provided, skipping header");
//           }

//           // Footer
//           if (footerLabel) {
//             const footerText = getText(footerLabel, customFooterText, req.file.originalname);
//             if (footerText) {
//               const textWidth = font.widthOfTextAtSize(footerText, fontSize);
//               const textHeight = font.heightAtSize(fontSize);
//               const { x, y } = getPositionCoordinates(position, page.getWidth(), page.getHeight(), textWidth, textHeight, false);
//               console.log(`Drawing footer: "${footerText}" at x=${x}, y=${y}`);
//               page.drawText(footerText, {
//                 x,
//                 y,
//                 size: fontSize,
//                 font,
//                 color: rgb(r, g, b),
//               });
//             } else {
//               console.warn(`No footer text generated for label: ${footerLabel}`);
//             }
//           } else {
//             console.log("No footer label provided, skipping footer");
//           }
//         }
//       }

//       // Preserve metadata if requested
//       if (includeMetadata) {
//         const metadata = pdfDoc.getInfoDict();
//         for (const [key, value] of metadata) {
//           if (value) {
//             pdfDoc.setInfo(key, value);
//           }
//         }
//       }

//       // Save the modified PDF
//       const pdfBytes = await pdfDoc.save();
//       outputFilePath = createOutputFilePath("pdf");
//       fs.writeFileSync(outputFilePath, pdfBytes);
//       console.log(`Saved PDF with headers and footers at ${outputFilePath}`);

//       // Delete input file
//       await safeUnlink(inputFilePath, req.file.originalname);

//       // Generate download URL
//       const downloadUrl = `${req.protocol}://${req.get("host")}/${outputFilePath}`;

//       // Save to database
//       const pdfFileRecord = await fileModel.create({
//         fileType: "pdf",
//         fileUrl: downloadUrl,
//         userId: clientId,
//         action: `added headers (${headerLabel}) and footers (${footerLabel}) to PDF`,
//         fileName: `${req.file.originalname.replace(".pdf", "_header_footer.pdf")}`,
//         icon: "pdf_header_footer",
//         metadata: {
//           originalFileName: req.file.originalname,
//           modificationDate: new Date(),
//           pageRanges,
//           headerLabel,
//           footerLabel,
//           customHeaderText,
//           customFooterText,
//           position,
//           fontSize,
//           color,
//           includeMetadata,
//         },
//       });

//       res.status(200).json({
//         message: "PDF headers and footers added successfully. Use the link to download the modified file.",
//         options: {
//           pageRanges,
//           headerLabel,
//           footerLabel,
//           customHeaderText,
//           customFooterText,
//           position,
//           fontSize,
//           color,
//           includeMetadata,
//         },
//         file: {
//           fileId: pdfFileRecord._id,
//           downloadUrl,
//           fileName: `${req.file.originalname.replace(".pdf", "_header_footer.pdf")}`,
//         },
//       });
//     } catch (err) {
//       console.error("Error adding headers and footers to PDF:", err.stack);
//       if (inputFilePath && fs.existsSync(inputFilePath)) {
//         await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
//       }
//       res.status(400).json({
//         error: `Failed to add headers and footers to PDF: ${err.message}`,
//       });
//     }
//   });
// };

// PDF Header and Footer endpoint
// PDF Header and Footer endpoint
// PDF Header and Footer endpoint
// exports.AddPageHeaderAndFooter = async (req, res) => {
//   const headerText = req.body.headerText || ""; // Header text
//   const footerText = req.body.footerText || ""; // Footer text
//   const headerPosition = req.body.headerPosition || "top-center"; // Default header position
//   const footerPosition = req.body.footerPosition || "bottom-center"; // Default footer position
//   const fontSize = parseInt(req.body.fontSize) || 12; // Default font size
//   const colorHex = req.body.color || "#000000"; // Default black color

//   getClientIdAndProcess(req, res, async (clientId) => {
//     let outputFilePath = null;
//     const inputFilePath = req.file?.path;

//     try {
//       // Validate input file
//       if (!req.file || !inputFilePath) {
//         return res
//           .status(400)
//           .json({ error: "No file provided for processing" });
//       }

//       // Check if file exists and is accessible
//       if (!fs.existsSync(inputFilePath)) {
//         return res
//           .status(404)
//           .json({ error: `Input file not found at ${inputFilePath}` });
//       }

//       // Verify file is not empty
//       const fileStats = fs.statSync(inputFilePath);
//       if (fileStats.size === 0) {
//         return res.status(400).json({ error: "Input file is empty" });
//       }

//       // Read file into buffer
//       const pdfBuffer = fs.readFileSync(inputFilePath);

//       // Load input PDF
//       const pdfDoc = await PDFDocument.load(pdfBuffer);
//       const pageCount = pdfDoc.getPageCount();

//       // Embed a font for text rendering
//       const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

//       // Parse colorHex to RGB
//       const hex = colorHex.replace("#", "");
//       const r = parseInt(hex.substring(0, 2), 16) / 255;
//       const g = parseInt(hex.substring(2, 4), 16) / 255;
//       const b = parseInt(hex.substring(4, 6), 16) / 255;

//       // Add headers and footers to each page
//       const pages = pdfDoc.getPages();
//       for (let i = 0; i < pageCount; i++) {
//         const page = pages[i];

//         // Add header if provided
//         if (headerText) {
//           const headerWidth = font.widthOfTextAtSize(headerText, fontSize);
//           const headerHeight = font.heightAtSize(fontSize);
//           const { x: headerX, y: headerY } = getPositionCoordinates(
//             headerPosition,
//             page.getWidth(),
//             page.getHeight(),
//             headerWidth,
//             headerHeight
//           );

//           // Ensure header is within the page bounds
//           if (headerY + headerHeight <= page.getHeight()) {
//             page.drawText(headerText, {
//               x: headerX,
//               y: headerY,
//               size: fontSize,
//               font,
//               color: rgb(r, g, b),
//             });
//           }
//         }

//         // Add footer if provided
//         if (footerText) {
//           const footerWidth = font.widthOfTextAtSize(footerText, fontSize);
//           const footerHeight = font.heightAtSize(fontSize);
//           const { x: footerX, y: footerY } = getPositionCoordinates(
//             footerPosition,
//             page.getWidth(),
//             page.getHeight(),
//             footerWidth,
//             footerHeight
//           );

//           // Ensure footer is within the page bounds
//           if (footerY >= 0) {
//             page.drawText(footerText, {
//               x: footerX,
//               y: footerY,
//               size: fontSize,
//               font,
//               color: rgb(r, g, b),
//             });
//           }
//         }
//       }

//       // Save the modified PDF
//       const pdfBytes = await pdfDoc.save();
//       outputFilePath = createOutputFilePath("pdf");
//       fs.writeFileSync(outputFilePath, pdfBytes);

//       // Delete input file
//       await safeUnlink(inputFilePath, req.file.originalname);

//       // Generate download URL
//       const downloadUrl = `${req.protocol}://${req.get(
//         "host"
//       )}/${outputFilePath}`;

//       // Save to database
//       const pdfFileRecord = await fileModel.create({
//         fileType: "pdf",
//         fileUrl: downloadUrl,
//         userId: clientId,
//         action: `added headers and footers to PDF`,
//         fileName: `${req.file.originalname.replace(".pdf", "_modified.pdf")}`,
//         icon: "pdf_header_footer",
//         metadata: {
//           originalFileName: req.file.originalname,
//           modificationDate: new Date(),
//           headerText,
//           footerText,
//           headerPosition,
//           footerPosition,
//           fontSize,
//           color: colorHex,
//         },
//       });

//       res.status(200).json({
//         message:
//           "PDF headers and footers added successfully. Use the link to download the modified file.",
//         file: {
//           fileId: pdfFileRecord._id,
//           downloadUrl,
//           fileName: `${req.file.originalname.replace(".pdf", "_modified.pdf")}`,
//         },
//       });
//     } catch (err) {
//       console.error("Error adding headers and footers to PDF:", err.stack);
//       if (inputFilePath && fs.existsSync(inputFilePath)) {
//         await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
//       }
//       res.status(400).json({
//         error: `Failed to add headers and footers to PDF: ${err.message}`,
//       });
//     }
//   });
// };

// PDF Header & Footer endpoint
// exports.AddPageHeaderAndFooter = async (req, res) => {
//   const headerText = req.body.headerText || "test"; // Header text
//   const footerText = req.body.footerText || "test"; // Footer text
//   const fontSize = parseInt(req.body.fontSize) || 12; // Default font size
//   const colorHex = req.body.color || "#000000"; // Default black
//   const headerPosition = req.body.headerPosition || "top-center"; // Default header position
//   const footerPosition = req.body.footerPosition || "bottom-center"; // Default footer position

//   getClientIdAndProcess(req, res, async (clientId) => {
//     let outputFilePath = null;
//     const inputFilePath = req.file?.path;

//     try {
//       // Validate input file
//       if (!req.file || !inputFilePath) {
//         return res
//           .status(400)
//           .json({ error: "No file provided for processing" });
//       }
//       if (!fs.existsSync(inputFilePath)) {
//         return res
//           .status(404)
//           .json({ error: `Input file not found at ${inputFilePath}` });
//       }

//       const fileStats = fs.statSync(inputFilePath);
//       if (fileStats.size === 0) {
//         return res.status(400).json({ error: "Input file is empty" });
//       }

//       // Read file into buffer
//       const pdfBuffer = fs.readFileSync(inputFilePath);
//       const pdfDoc = await PDFDocument.load(pdfBuffer);
//       const pageCount = pdfDoc.getPageCount();

//       // Parse page ranges (optional)
//       const { pageNumbers, hasValidRanges, invalidRanges } = parsePageRanges(
//         req.body.pageRanges || "",
//         pageCount
//       );

//       if (!hasValidRanges && (req.body.pageRanges || "").trim() !== "") {
//         return res.status(400).json({
//           error: `No valid page ranges provided. Invalid ranges: ${invalidRanges.join(
//             ", "
//           )}`,
//         });
//       }

//       // Embed font
//       const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

//       // Parse color
//       const hex = colorHex.replace("#", "");
//       const r = parseInt(hex.substring(0, 2), 16) / 255;
//       const g = parseInt(hex.substring(2, 4), 16) / 255;
//       const b = parseInt(hex.substring(4, 6), 16) / 255;

//       // Add header and footer
//       const pages = pdfDoc.getPages();
//       for (let i = 0; i < pageCount; i++) {
//         if (pageNumbers.includes(i + 1)) {
//           const page = pages[i];

//           // Add Header
//           if (headerText) {
//             const textWidth = font.widthOfTextAtSize(headerText, fontSize);
//             const textHeight = font.heightAtSize(fontSize);
//             const { x, y } = getPositionCoordinates(
//               headerPosition,
//               page.getWidth(),
//               page.getHeight(),
//               textWidth,
//               textHeight
//             );
//             page.drawText(headerText, {
//               x,
//               y,
//               size: fontSize,
//               font,
//               color: rgb(r, g, b),
//             });
//           }

//           // Add Footer
//           if (footerText) {
//             const textWidth = font.widthOfTextAtSize(footerText, fontSize);
//             const textHeight = font.heightAtSize(fontSize);
//             const { x, y } = getPositionCoordinates(
//               footerPosition,
//               page.getWidth(),
//               page.getHeight(),
//               textWidth,
//               textHeight
//             );
//             page.drawText(footerText, {
//               x,
//               y,
//               size: fontSize,
//               font,
//               color: rgb(r, g, b),
//             });
//           }
//         }
//       }

//       // Save modified PDF
//       const pdfBytes = await pdfDoc.save();
//       outputFilePath = createOutputFilePath("pdf");
//       fs.writeFileSync(outputFilePath, pdfBytes);

//       // Delete input file
//       await safeUnlink(inputFilePath, req.file.originalname);

//       // Generate download URL
//       const downloadUrl = `${req.protocol}://${req.get(
//         "host"
//       )}/${outputFilePath}`;

//       // Save to DB
//       const pdfFileRecord = await fileModel.create({
//         fileType: "pdf",
//         fileUrl: downloadUrl,
//         userId: clientId,
//         action: `added header/footer to PDF (header: "${headerText}", footer: "${footerText}")`,
//         fileName: `${req.file.originalname.replace(
//           ".pdf",
//           "_header_footer.pdf"
//         )}`,
//         icon: "pdf_header_footer",
//         metadata: {
//           originalFileName: req.file.originalname,
//           modificationDate: new Date(),
//           headerText,
//           footerText,
//           fontSize,
//           color: colorHex,
//         },
//       });

//       res.status(200).json({
//         message: "PDF header and footer added successfully.",
//         options: { headerText, footerText, fontSize, color: colorHex },
//         fileId: pdfFileRecord._id,
//         file: {
//           downloadUrl,
//           fileName: `${req.file.originalname.replace(
//             ".pdf",
//             "_header_footer.pdf"
//           )}`,
//         },
//       });
//     } catch (err) {
//       console.error("Error adding header/footer to PDF:", err.stack);
//       if (inputFilePath && fs.existsSync(inputFilePath)) {
//         await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
//       }
//       res
//         .status(400)
//         .json({ error: `Failed to add header/footer: ${err.message}` });
//     }
//   });
// };

// PDF Header and Footer endpoint
exports.AddPageHeaderAndFooter = async (req, res) => {
  const headerOption = req.body.headerOption || "Custom Text"; // Header option
  const footerOption = req.body.footerOption || "Custom Text"; // Footer option
  const customHeaderText = req.body.customHeaderText || "Custom Text"; // Custom header text
  const customFooterText = req.body.customFooterText || "Custom Text"; // Custom footer text
  const headerPosition = req.body.headerPosition || "top-center"; // Default header position
  const footerPosition = req.body.footerPosition || "bottom-center"; // Default footer position
  const fontSize = parseInt(req.body.fontSize) || 12; // Default font size
  const colorHex = req.body.color || "#000000"; // Default black color

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

      // Read file into buffer
      const pdfBuffer = fs.readFileSync(inputFilePath);

      // Load input PDF
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();

      // Embed a font for text rendering
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Parse colorHex to RGB
      const hex = colorHex.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;

      // Function to get header text based on option
      const getHeaderText = (option, pageNum) => {
        switch (option) {
          case "Page 1,Page 2,Page 3":
            return `Page ${pageNum}`;
          case "Page I,Page II,Page III":
            return `Page ${["I", "II", "III"][pageNum - 1] || pageNum}`;
          case "Page 1 of 20,Page 2 of 20,Page 3,Page 20":
            return `Page ${pageNum} of ${pageCount}`;
          case "Filename on each page":
            return req.file.originalname;
          case "Custom Text":
            return customHeaderText || "Custom Header";
          default:
            return "";
        }
      };

      // Function to get footer text based on option
      const getFooterText = (option, pageNum) => {
        switch (option) {
          case "Page 1,Page 2,Page 3":
            return `Page ${pageNum}`;
          case "Page I,Page II,Page III":
            return `Page ${["I", "II", "III"][pageNum - 1] || pageNum}`;
          case "Page 1 of 20,Page 2 of 20,Page 3,Page 20":
            return `Page ${pageNum} of ${pageCount}`;
          case "Filename on each page":
            return req.file.originalname;
          case "Custom Text":
            return customFooterText || "Custom Footer";
          default:
            return "";
        }
      };

      // Add headers and footers to each page
      const pages = pdfDoc.getPages();
      for (let i = 0; i < pageCount; i++) {
        const page = pages[i];

        // Get header text for the current page
        const headerText = getHeaderText(headerOption, i + 1);
        if (headerText) {
          const headerWidth = font.widthOfTextAtSize(headerText, fontSize);
          const headerHeight = font.heightAtSize(fontSize);
          const { x: headerX, y: headerY } = getPositionCoordinates(
            headerPosition,
            page.getWidth(),
            page.getHeight(),
            headerWidth,
            headerHeight
          );

          // Ensure header is within the page bounds
          if (headerY + headerHeight <= page.getHeight()) {
            page.drawText(headerText, {
              x: headerX,
              y: headerY,
              size: fontSize,
              font,
              color: rgb(r, g, b),
            });
          }
        }

        // Get footer text for the current page
        const footerText = getFooterText(footerOption, i + 1);
        if (footerText) {
          const footerWidth = font.widthOfTextAtSize(footerText, fontSize);
          const footerHeight = font.heightAtSize(fontSize);
          const { x: footerX, y: footerY } = getPositionCoordinates(
            footerPosition,
            page.getWidth(),
            page.getHeight(),
            footerWidth,
            footerHeight
          );

          // Ensure footer is within the page bounds
          if (footerY >= 0) {
            page.drawText(footerText, {
              x: footerX,
              y: footerY,
              size: fontSize,
              font,
              color: rgb(r, g, b),
            });
          }
        }
      }

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      outputFilePath = createOutputFilePath("pdf");
      fs.writeFileSync(outputFilePath, pdfBytes);

      // Delete input file
      await safeUnlink(inputFilePath, req.file.originalname);

      // Generate download URL
      const downloadUrl = `${req.protocol}://${req.get(
        "host"
      )}/${outputFilePath}`;

      // Save to database
      const pdfFileRecord =  await fileModel.create({
        fileType: "pdf",
        fileUrl: downloadUrl,
        userId: clientId,
        action: `added headers and footers to PDF`,
        fileName: `${req.file.originalname.replace(".pdf", "_modified.pdf")}`,
        icon: "pdf_header_footer",
      })

      res.status(200).json({
        message:
          "PDF headers and footers added successfully. Use the link to download the modified file.",
          fileId: pdfFileRecord._id,
      });
    } catch (err) {
      console.error("Error adding headers and footers to PDF:", err.stack);
      if (inputFilePath && fs.existsSync(inputFilePath)) {
        await safeUnlink(inputFilePath, req.file?.originalname || "unknown");
      }
      res.status(400).json({
        error: `Failed to add headers and footers to PDF: ${err.message}`,
      });
    }
  });
};