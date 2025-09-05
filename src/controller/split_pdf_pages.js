const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  SplitPDFJob,
  SplitPDFParams,
  SplitPDFResult,
  PageRanges,
  SDKError,
  ServiceUsageError,
  ServiceApiError,
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const fileModel = require("../models/file_model");
const archiver = require("archiver");
const stream = require("stream");
const { pipeline } = stream;
const streamPipeline = promisify(pipeline);

// Ensure directories exist
const downloadDir = path.join("downloads");
const uploadDir = path.join("uploads");
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Function to generate output file path for multiple files
function createOutputFilePath(ext, index) {
  const filePath = downloadDir;
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
  // Add a unique index to the filename for multiple outputs
  return `${filePath}/split_${dateString}_${index}.${ext}`;
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

const parsePageRanges = (rangesStr) => {
  const pageRanges = new PageRanges();
  const rangeParts = rangesStr
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  for (const part of rangeParts) {
    try {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
          pageRanges.addRange(start, end);
        } else {
          console.warn(`Invalid page range format: ${part}`);
        }
      } else {
        const pageNum = Number(part);
        if (!isNaN(pageNum) && pageNum > 0) {
          pageRanges.addSinglePage(pageNum);
        } else {
          console.warn(`Invalid single page number: ${part}`);
        }
      }
    } catch (err) {
      console.warn(`Error parsing range part ${part}: ${err.message}`);
    }
  }
  return pageRanges;
};

exports.SplitPDF = async (req, res) => {
  const getClientIdAndProcessWrapper = (callback) =>
    getClientIdAndProcess(req, res, callback);

  getClientIdAndProcessWrapper(async (clientId) => {
    let readStream;
    const inputFilePath = req.file?.path;
    const pageRangesInput = req.body.pageRanges ||
      req.query.pageRanges || ["1","1-2"];

    if (!inputFilePath || !fs.existsSync(inputFilePath)) {
      return res.status(400).json({
        error: "No file provided or file not found.",
      });
    }

    let pageRanges;
    // Handle array or string input for page ranges
    if (Array.isArray(pageRangesInput)) {
      pageRanges = new PageRanges();
      pageRangesInput.forEach((rangeStr) => {
        const [start, end] = String(rangeStr).split("-").map(Number);
        if (end) {
          pageRanges.addRange(start, end);
        } else {
          pageRanges.addSinglePage(start);
        }
      });
    } else if (typeof pageRangesInput === "string") {
      pageRanges = parsePageRanges(pageRangesInput);
    } else {
      return res.status(400).json({
        error: "Page ranges are required and must be a string or array.",
      });
    }

    let tempDir = path.join(downloadDir, `temp_${Date.now()}`);
    let zipFilePath = path.join(downloadDir, `split_pdf_${Date.now()}.zip`);

    try {
      fs.mkdirSync(tempDir);

      const credentials = new ServicePrincipalCredentials({
        clientId: process.env.PDF_SERVICES_CLIENT_ID,
        clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
      });

      const pdfServices = new PDFServices({
        credentials,
        timeout: 80000,
      });

      readStream = fs.createReadStream(inputFilePath);
      const inputAsset = await pdfServices.upload({
        readStream,
        mimeType: MimeType.PDF,
      });

      const params = new SplitPDFParams({
        pageRanges,
      });
      const job = new SplitPDFJob({
        inputAsset,
        params,
      });

      const pollingURL = await pdfServices.submit({
        job,
      });
      const pdfServicesResponse = await pdfServices.getJobResult({
        pollingURL,
        resultType: SplitPDFResult,
      });

      const resultAssets = pdfServicesResponse.result.assets;

      // Save each split PDF to a temporary directory
      for (let i = 0; i < resultAssets.length; i++) {
        const streamAsset = await pdfServices.getContent({
          asset: resultAssets[i],
        });
        const tempFilePath = path.join(tempDir, `part_${i + 1}.pdf`);
        await streamPipeline(
          streamAsset.readStream,
          fs.createWriteStream(tempFilePath)
        );
      }

      // Create a zip file from the temporary directory
      const zipOutputStream = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", {
        zlib: {
          level: 9,
        },
      });
      archive.directory(tempDir, false);
      archive.finalize();

      await streamPipeline(archive, zipOutputStream);

      // Clean up the temporary directory and its contents
      fs.rmSync(tempDir, { recursive: true, force: true });
      await safeUnlink(inputFilePath, req.file.originalname);

      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${zipFilePath}`;

      // Save a single record for the zipped file
      const newFileRecord = await fileModel.create({
        fileType: "zip",
        fileUrl: downloadUrl,
        userId: clientId,
        action: `split PDF into ${resultAssets.length} files and compressed`,
        fileName: `${req.file.originalname.split(".")[0]}_split.zip`,
        icon: "zip_file",
        metadata: {
          pageRanges: JSON.stringify(pageRangesInput),
          outputFileCount: resultAssets.length,
        },
      });

      res.status(200).json({
        message:
          "PDF split and compressed successfully. Use the link to download the zip file.",
        fileId: newFileRecord._id,
        downloadUrl: downloadUrl,
      });
    } catch (err) {
      console.error("Error splitting PDF:", err.stack);
      // Clean up on error
      if (fs.existsSync(tempDir))
        fs.rmSync(tempDir, { recursive: true, force: true });
      await safeUnlink(inputFilePath, req.file?.originalname || "unknown");

      res.status(400).json({
        error: `Failed to split PDF: ${err.message}`,
      });
    } finally {
      readStream?.destroy();
    }
  });
};
