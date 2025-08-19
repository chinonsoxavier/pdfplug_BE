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

// Ensure the directory exists. This is crucial.
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

exports.pdftoword = async (req, res) => {
  let readStream;
  const inputFilePath = req.file.path;

  try {
    const credentials = new ServicePrincipalCredentials({
      clientId: process.env.PDF_SERVICES_CLIENT_ID,
      clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
    });

    const pdfServices = new PDFServices({
      credentials,
      timeout:60000
    });

    // Creates an asset(s) from source file(s) and upload
    readStream = fs.createReadStream(inputFilePath);
    const inputAsset = await pdfServices.upload({
      readStream,
      mimeType: MimeType.PDF,
    });

    // Create parameters for the job
    const params = new ExportPDFParams({
      targetFormat: ExportPDFTargetFormat.DOCX,
    });

    // Creates a new job instance
    const job = new ExportPDFJob({ inputAsset, params });

    // Submit the job and get the job result
    async function submitJobWithRetry(job, retries = 3) {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const pollingURL = await pdfServices.submit({ job });
          return pollingURL;
        } catch (err) {
          if (attempt === retries - 1) throw err; // Rethrow if it's the last attempt
        }
      }
    }
    const pollingURL = await submitJobWithRetry(job);
    const pdfServicesResponse = await pdfServices.getJobResult({
      pollingURL,
      resultType: ExportPDFResult,
    });

    // Get content from the resulting asset(s)
    const resultAsset = pdfServicesResponse.result.asset;
    const streamAsset = await pdfServices.getContent({ asset: resultAsset });

    // Creates an output stream and copy stream asset's content to it
    const outputFilePath = createOutputFilePath();
    console.log(`Saving asset at ${outputFilePath}`);

    const outputStream = fs.createWriteStream(outputFilePath);
    streamAsset.readStream.pipe(outputStream);
    const downloadUrl = `${req.protocol}://${req.get(
      "host"
    )}/${outputFilePath}`;

    const newFile = await fileModel.create({
      fileType: "pdf",
      fileUrl: downloadUrl,
    });
    res.status(200).json({
      message: "File converted successfully. Use the link to download.",
      fileId: newFile._id,
    });
  } catch (err) {
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
};

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
