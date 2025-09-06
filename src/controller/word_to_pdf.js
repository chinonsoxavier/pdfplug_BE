const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  CreatePDFJob, // Add this
  CreatePDFResult, // Add this
  SDKError,
  ServiceUsageError,
  ServiceApiError,
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs");
const path = require("path");
const fileModel = require("../models/file_model");
const downloadDir = path.join("downloads");
const mongoose = require("mongoose");

exports.Wordtopdf = async (req, res) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;
  console.log("started");

  const getClientIdAndProcess = (callback) => {
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
        return res.status(500).json({ error: "Failed to save session" });
      }
      callback(newGuestId);
    });
  };

  getClientIdAndProcess(async (clientId) => {
    let readStream;
    const inputFilePath = req.file.path;

    try {
      const credentials = new ServicePrincipalCredentials({
        clientId: process.env.PDF_SERVICES_CLIENT_ID,
        clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
      });

      const pdfServices = new PDFServices({ credentials, timeout: 80000 });

      // Create an asset from the source DOCX file
      readStream = fs.createReadStream(inputFilePath);
      const inputAsset = await pdfServices.upload({
        readStream,
        mimeType: MimeType.DOCX, // Set the correct MIME type for DOCX
      });

      // Create a new job instance for converting DOCX to PDF
      const job = new CreatePDFJob({ inputAsset });

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
        resultType: CreatePDFResult, // Use the CreatePDFResult type
      });

      const resultAsset = pdfServicesResponse.result.asset;
      const streamAsset = await pdfServices.getContent({ asset: resultAsset });

      const outputFilePath = createOutputFilePath("pdf"); // Pass the extension
      const outputStream = fs.createWriteStream(outputFilePath);
      streamAsset.readStream.pipe(outputStream);
      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      const newFile = new fileModel({
        fileType: "word", // The original file type
        fileUrl: downloadUrl,
        userId: clientId,
        action: "converted Word to pdf", // New action
        fileName: req.file.originalname,
        icon: "word_to_pdf",
      }).save();
      
      res.status(200).json({
        message: "File converted successfully. Use the link to download.",
        fileId: newFile._id,
      });

    } catch (err) {
      res.status(400).json("failed to convert word to pdf");
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
      readStream?.destroy();
    }
  });
};

// Generates a string containing a directory structure and file name for the output file
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
  return `${filePath}/${dateString}.${ext}`; // Use the passed-in extension
}
