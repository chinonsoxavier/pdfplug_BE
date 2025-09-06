const {
  CompressionLevel,
  CompressPDFParams,
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  CompressPDFJob,
  CompressPDFResult,
  PDFServicesResponse,
} = require("@adobe/pdfservices-node-sdk");
// const { getClientIdAndProcess } = require("./tools_controller");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const fileModel = require("../models/file_model");
const downloadDir = path.join("downloads");
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}
const getClientIdAndProcess = (req, res, callback) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;

  if (userId) {
    return callback(userId);
  }
  if (guestId) {
    return callback(guestId);
  }
  const newGuestId = new mongoose.Types.ObjectId().toString();
  req.session.guestId = newGuestId;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Failed to save session" });
    }
    callback(newGuestId);
  });
};

exports.compressPdf = async (req, res) => {
  // Ensure that files were uploaded
  if (!req.files || req.files.length === 0) {
    return res
      .status(400)
      .json({ error: "Please upload at least one PDF file to compress." });
  }

  // Use the getClientIdAndProcess function to ensure a client ID is available
  getClientIdAndProcess(req, res, async (clientId) => {
    const successfullyCompressed = [];
    const failedCompressions = [];

    // Determine compression level from request body, default to LOW
    const compressionLevelFromReq = req.body.compressionLevel
      ? req.body.compressionLevel.toUpperCase()
      : "LOW";

    let compressionLevel = CompressionLevel.LOW;
    if (CompressionLevel[compressionLevelFromReq]) {
      compressionLevel = CompressionLevel[compressionLevelFromReq];
    }

    // Set the compression parameters once for all files
    const params = new CompressPDFParams({ compressionLevel });

    // Creates PDF Services instance
    const credentials = new ServicePrincipalCredentials({
      clientId: process.env.PDF_SERVICES_CLIENT_ID,
      clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
    });
    const pdfServices = new PDFServices({ credentials, timeout: 80000 });

    // Loop through each file in the batch
    for (const file of req.files) {
      let readStream;
      try {
        if (file.mimetype !== "application/pdf") {
          failedCompressions.push({
            fileName: file.originalname,
            error: "File is not a PDF.",
          });
          continue; // Skip to the next file
        }

        readStream = fs.createReadStream(file.path);
        const inputAsset = await pdfServices.upload({
          readStream,
          mimeType: MimeType.PDF,
        });

        // Creates a new job instance
        const job = new CompressPDFJob({ inputAsset, params });

        // Submit the job and get the job result
        const pollingURL = await submitJobWithRetry(pdfServices, job);
        const pdfServicesResponse = await pdfServices.getJobResult({
          pollingURL,
          resultType: CompressPDFResult,
        });

        const resultAsset = pdfServicesResponse.result.asset;
        const streamAsset = await pdfServices.getContent({
          asset: resultAsset,
        });

        const outputFilePath = createOutputFilePath("pdf");
        const outputStream = fs.createWriteStream(outputFilePath);
        streamAsset.readStream.pipe(outputStream);

        const downloadUrl = `${req.protocol}s://${req.get(
          "host"
        )}/${outputFilePath}`;

        const newFile = await fileModel
          .create({
            fileType: "application/pdf",
            fileUrl: downloadUrl,
            userId: clientId,
            action: `compressed Pdf (${compressionLevel.toLowerCase()})`,
            fileName: `compressed_${file.originalname}`,
            icon: "compress_pdf",
          });
        successfullyCompressed.push({
          fileId: newFile._id,
          fileName: newFile.fileName,
          downloadUrl: downloadUrl,
        });
      } catch (err) {
        console.error(`Error compressing file ${file.originalname}:`, err);
        failedCompressions.push({
          fileName: file.originalname,
          error: "Compression failed.",
        });
      } finally {
        readStream?.destroy();
      }
    }

    // Respond with a summary of the batch process
    if (successfullyCompressed.length > 0) {
      res.status(200).json({
        message: `${successfullyCompressed.length} file(s) compressed successfully.`,
        successfullyCompressed,
        failedCompressions,
      });
    } else {
      res.status(400).json({
        error: "All files failed to compress.",
        failedCompressions,
      });
    }
  });
};

// Helper function to submit job with retry logic (reused from your previous code)
async function submitJobWithRetry(pdfServices, job, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const pollingURL = await pdfServices.submit({ job });
      return pollingURL;
    } catch (err) {
      if (attempt === retries - 1) throw err;
    }
  }
}

function createOutputFilePath(ext) {
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
  return `${filePath}/${dateString}.${ext}`;
}
