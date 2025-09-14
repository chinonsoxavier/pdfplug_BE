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
const path = require("path");
const fileModel = require("../models/file_model");
const downloadDir = path.join("downloads");
const mongoose = require("mongoose");

if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

exports.pdftoword = async (req, res) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;

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
      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      const newFile = await fileModel
        .create({
          fileType: "pdf",
          fileUrl: downloadUrl,
          userId: clientId, // Use the clientId from the callback
          action: "converted Pdf to word",
          fileName: req.file.originalname,
          icon: "pdf_to_word",
        });
      res.status(200).json({
        message: "File converted successfully. Use the link to download.",
        fileId: newFile._id,
        fileUrl:downloadUrl
      });
      console.log(await newFile);
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
      readStream?.destroy();
    }
  });
};

// exports.pdftoword = async (req, res) => {
//   const guestId = req?.session?.guestId;
//   const userId = req.session?.passport?.user;

//   const getClientId = () => {
//     if (!userId) {
//       if (guestId) {
//         console.log(guestId, "oldguest");
//         return guestId;
//       }
//       const newGuestId = new mongoose.Types.ObjectId().toString();
//       req.session.guestId = newGuestId;
//       console.log(newGuestId, "newGuest");
//       return newGuestId;
//     }
//     return userId;
//   };

//   getClientId();
//   let readStream;
//   const inputFilePath = req.file.path;

//   try {
//     const credentials = new ServicePrincipalCredentials({
//       clientId: process.env.PDF_SERVICES_CLIENT_ID,
//       clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
//     });

//     const pdfServices = new PDFServices({
//       credentials,
//       timeout: 80000,
//     });

//     // Creates an asset(s) from source file(s) and upload
//     readStream = fs.createReadStream(inputFilePath);
//     const inputAsset = await pdfServices.upload({
//       readStream,
//       mimeType: MimeType.PDF,
//     });

//     // Create parameters for the job
//     const params = new ExportPDFParams({
//       targetFormat: ExportPDFTargetFormat.DOCX,
//     });

//     // Creates a new job instance
//     const job = new ExportPDFJob({ inputAsset, params });

//     // Submit the job and get the job result
//     async function submitJobWithRetry(job, retries = 3) {
//       for (let attempt = 0; attempt < retries; attempt++) {
//         try {
//           const pollingURL = await pdfServices.submit({ job });
//           return pollingURL;
//         } catch (err) {
//           if (attempt === retries - 1) throw err; // Rethrow if it's the last attempt
//         }
//       }
//     }
//     const pollingURL = await submitJobWithRetry(job);
//     const pdfServicesResponse = await pdfServices.getJobResult({
//       pollingURL,
//       resultType: ExportPDFResult,
//     });

//     // Get content from the resulting asset(s)
//     const resultAsset = pdfServicesResponse.result.asset;
//     const streamAsset = await pdfServices.getContent({ asset: resultAsset });

//     // Creates an output stream and copy stream asset's content to it
//     const outputFilePath = createOutputFilePath();
//     console.log(`Saving asset at ${outputFilePath}`);

//     const outputStream = fs.createWriteStream(outputFilePath);
//     streamAsset.readStream.pipe(outputStream);
//     const downloadUrl = `${req.protocol}s://${req.get(
//       "host"
//     )}/${outputFilePath}`;
//     const userId = req.session?.passport?.user;
//     const guestIdSession = req?.session?.guestId;

//     const newFile = await fileModel.create({
//       fileType: "pdf",
//       fileUrl: downloadUrl,
//       userId: getClientId(),
//       action: "converted Pdf to word",
//     });
//     res.status(200).json({
//       message: "File converted successfully. Use the link to download.",
//       fileId: newFile._id,
//     });
//   } catch (err) {
//     res.status(400).json("failed to convert pdf to docx");
//     if (
//       err instanceof SDKError ||
//       err instanceof ServiceUsageError ||
//       err instanceof ServiceApiError
//     ) {
//       console.log("Exception encountered while executing operation", err);
//     } else {
//       console.log("Exception encountered while executing operation", err);
//     }
//   } finally {
//     readStream?.destroy();
//   }
// };

// Generates a string containing a directory structure and file name for the output file
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
