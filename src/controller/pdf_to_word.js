const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  ExportPDFJob,
  ExportPDFParams,
  ExportPDFTargetFormat,
  ExportPDFResult,
  SDKError,
  ServiceUsageError,
  ServiceApiError,
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs");
const { promisify } = require("util");
const path = require("path");
const fileModel = require("../models/file_model");
const downloadDir = path.join("downloads");
const mongoose = require("mongoose");
const unlinkAsync = promisify(fs.unlink);

if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

exports.pdftoword = async (req, res) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;
  console.log(req.file);
  // Refactored getClientId to save session and then call a callback
  const getClientIdAndProcess = (callback) => {
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

    // Save the session before proceeding
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ error: "Failed to save session" });
      }
      callback(newGuestId);
    });
  };

  getClientIdAndProcess(async (clientId) => {
    let readStream;
    const inputFilePath = req.file.path;

    try {
      // Your existing code from here...
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

      const params = new ExportPDFParams({
        targetFormat: ExportPDFTargetFormat.DOCX,
      });

      const job = new ExportPDFJob({ inputAsset, params });

      async function submitJobWithRetry(job, retries = 3) {
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            const pollingURL = await pdfServices.submit({ job });
            return pollingURL;
          } catch (err) {
            if (attempt === retries - 1) throw err;
          }
        }
      }

      const pollingURL = await submitJobWithRetry(job);
      const pdfServicesResponse = await pdfServices.getJobResult({
        pollingURL,
        resultType: ExportPDFResult,
      });

      const resultAsset = pdfServicesResponse.result.asset;
      const streamAsset = await pdfServices.getContent({
        asset: resultAsset,
      });

      const outputFilePath = createOutputFilePath();
      console.log(`Saving asset at ${outputFilePath}`);

      const outputStream = fs.createWriteStream(outputFilePath);
      streamAsset.readStream.pipe(outputStream);
      // await safeUnlink(inputFilePath, req.file.originalname);

      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      const newFile = await fileModel.create({
        fileType: "docx",
        fileUrl: downloadUrl,
        userId: clientId, // Use the clientId from the callback
        action: "converted Pdf to word",
        fileName: `${
          req.file.originalname.split(".").slice(0, -1).join(".") + ".docx"
        }`,
        icon: "pdf_to_word",
      });
      res.status(200).json({
        message: "File converted successfully. Use the link to download.",
        fileId: newFile._id,
        fileUrl: downloadUrl,
      });
      console.log(newFile);
    } catch (err) {
      // Your error handling code...
      res.status(400).json("failed to convert pdf to docx");
      if (
        err instanceof SDKError ||
        err instanceof ServiceUsageError ||
        err instanceof ServiceApiError
      ) {
        console.log("Exception encountered while executing operation", err);
      } else {
        console.log("Exception encountered while executing operation", err);
      }
    } finally {
      await safeUnlink(inputFilePath, req.file.originalname);
      readStream?.destroy();
    }
  });
};
function createOutputFilePath() {
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
  return `${filePath}/${dateString}.docx`;
}

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
