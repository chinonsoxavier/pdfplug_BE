const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  ExportPDFToImagesJob,
  ExportPDFToImagesTargetFormat,
  ExportPDFToImagesOutputType,
  ExportPDFToImagesParams,
  ExportPDFToImagesResult,
  SDKError,
  ServiceUsageError,
  ServiceApiError,
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs");
const path = require("path");
const fileModel = require("../models/file_model");
const downloadDir = path.join("downloads");
const mongoose = require("mongoose");
const archiver = require("archiver");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);

if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

exports.PdfToJpg = async (req, res) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;

  // Get quality setting from request body or query, default to 'medium'
  const qualitySetting = req.body.quality || req.query.quality || "medium";

  // Map quality setting to numeric value (Adobe uses 1-100 scale)
  const qualityMap = {
    low: 30,
    medium: 70,
    high: 100,
  };

  const qualityValue = qualityMap[qualitySetting] || qualityMap["medium"];

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
    let outputDir = null;
    let zipFilePath = null;

    try {
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

      // Create parameters for the job with quality setting
      const params = new ExportPDFToImagesParams({
        targetFormat: ExportPDFToImagesTargetFormat.JPEG,
        outputType: ExportPDFToImagesOutputType.LIST_OF_PAGE_IMAGES,
        // Add quality setting
        quality: qualityValue,
      });

      // Creates a new job instance
      const job = new ExportPDFToImagesJob({ inputAsset, params });

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
        resultType: ExportPDFToImagesResult,
      });

      // Get content from the resulting asset(s)
      const resultAssets = pdfServicesResponse.result.assets;
      const { outputDirPath, getOutputFilePathForIndex } =
        createOutputJpgPaths(qualitySetting);
      outputDir = outputDirPath;

      // Save all pages (without creating individual database records)
      for (let i = 0; i < resultAssets.length; i++) {
        const outputFilePath = getOutputFilePathForIndex(i);
        console.log(`Saving asset at ${outputFilePath}`);

        const streamAsset = await pdfServices.getContent({
          asset: resultAssets[i],
        });
        // Creates an output stream and copy stream asset's content to it
        const outputStream = fs.createWriteStream(outputFilePath);
        streamAsset.readStream.pipe(outputStream);
      }

      // Create zip file
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

      zipFilePath = path.join(
        downloadDir,
        `${dateString}_${qualitySetting}_quality.zip`
      );

      await createZip(outputDir, zipFilePath);

      const zipDownloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${zipFilePath}`;

      // Create only one record for the zip file
      const zipFileRecord = await fileModel.create({
        fileType: "zip",
        fileUrl: zipDownloadUrl,
        userId: clientId,
        action: `converted Pdf to jpg (${qualitySetting} quality)`,
        fileName: `${req.file.originalname.replace(
          ".pdf",
          ""
        )}_${qualitySetting}_quality.zip`,
        icon: "pdf_to_jpg",
      
      });

      // Delete the original uploaded file
      await unlinkAsync(inputFilePath);

      res.status(200).json({
        message:
          "File converted successfully. Use the link to download the zip file.",
        fileId: zipFileRecord?._id,
        fileUrl:zipDownloadUrl,
      });
    } catch (err) {
      console.error("Error:", err);
      res.status(400).json("failed to convert pdf to jpg");
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

      // Clean up: delete the output directory and its contents
      if (outputDir && fs.existsSync(outputDir)) {
        try {
          // Delete all files in the directory
          const files = fs.readdirSync(outputDir);
          for (const file of files) {
            fs.unlinkSync(path.join(outputDir, file));
          }
          // Delete the directory
          fs.rmdirSync(outputDir);
        } catch (cleanupErr) {
          console.error("Error cleaning up output directory:", cleanupErr);
        }
      }
    }
  });
};

// Creates a zip file from a directory
function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(
        `Zip file created: ${outputPath} (${archive.pointer()} total bytes)`
      );
      resolve();
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// Generates a function that creates output file paths for each page
function createOutputJpgPaths(qualitySetting) {
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

  // Create a directory for this conversion if it doesn't exist
  const outputDir = `${filePath}/${dateString}_${qualitySetting}_quality`;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Return a function that generates a path for a specific page index and the output directory path
  return {
    outputDirPath: outputDir,
    getOutputFilePathForIndex: (index) => `${outputDir}/page_${index + 1}.jpg`,
  };
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

