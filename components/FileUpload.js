import React, { useState } from 'react';
import { parseHDRFile, parseRGBPreview, parseFullData } from '../utils/parseHyperspectral';

const FileUpload = ({ onPreviewReady, onFullDataReady, onProgressUpdate }) => {
  const [processing, setProcessing] = useState(false);
  const [processingFull, setProcessingFull] = useState(false);

  const processFiles = async (files) => {
    try {
      setProcessing(true);

      // Find header file first
      const headerExtensions = ['.hdr', '.HDR'];
      const headerFile = [...files].find(file =>
        headerExtensions.some(ext => file.name.toLowerCase().endsWith(ext)));

      if (!headerFile) {
        throw new Error('Header file (.hdr) required');
      }

      // Parse header file to determine the expected data filename
      const metadata = await parseHDRFile(headerFile);

      // Extract base filename (without extension) from header file
      const headerBaseName = headerFile.name.replace(/\.[^/.]+$/, "");

      // Try to find the data file
      let dataFile;

      // 1. Check if there's a file with the same base name as the header
      dataFile = [...files].find(file => {
        const fileBaseName = file.name.replace(/\.[^/.]+$/, "");
        return fileBaseName === headerBaseName && file !== headerFile;
      });

      // 2. If not found, check for files with known extensions
      if (!dataFile) {
        const dataExtensions = ['.bsq', '.BSQ', '.bil', '.BIL', '.bip', '.BIP'];
        dataFile = [...files].find(file =>
          dataExtensions.some(ext => file.name.toLowerCase().endsWith(ext)));
      }

      // 3. If still not found, use any non-header file
      if (!dataFile) {
        dataFile = [...files].find(file => !headerExtensions.some(ext =>
          file.name.toLowerCase().endsWith(ext)));
      }

      if (!dataFile) {
        throw new Error('Could not find data file. Upload both header and data files.');
      }

      console.log(`Processing header file: ${headerFile.name}`);
      console.log(`Processing data file: ${dataFile.name}`);

      // Get default RGB bands or use fallback values
      const defaultBands = metadata["default bands"]
        ? metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number)
        : [60, 40, 20]; // Fallback RGB bands if not specified

      // Quick parse of just the RGB bands
      console.log('Processing RGB preview...');
      const rgbData = await parseRGBPreview(dataFile, metadata, defaultBands);

      // Send the preview data to parent
      onPreviewReady({
        fileName: dataFile.name,
        metadata,
        imageData: rgbData
      });

      setProcessing(false);

      // Start processing the full dataset in the background
      setProcessingFull(true);
      console.log(`Processing full hyperspectral data (${metadata.interleave || 'bsq'} format)...`);

      const fullData = await parseFullData(dataFile, metadata, (progress) => {
        // Send every progress update directly to parent
        if (onProgressUpdate) {
          onProgressUpdate(progress);
        }
      });

      setProcessingFull(false);

      // Send the complete data to parent
      onFullDataReady({
        fileName: dataFile.name,
        metadata,
        imageData: fullData
      });

    } catch (error) {
      console.error('Error processing files:', error);
      setProcessing(false);
      setProcessingFull(false);
      alert('File processing failed: ' + error.message);
    }
  };

  return (
    <div className="my-4">
      <div className="flex flex-col gap-2">
        <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
          <input
            type="file"
            accept="*" // Accept all file types
            multiple
            onChange={(e) => processFiles(e.target.files)}
            disabled={processing || processingFull}
            className="w-full"
          />
          <p className="mt-2 text-sm text-gray-500">
            Upload header (.hdr) file and the corresponding data file (with or without extension)
          </p>
        </div>

        {processing && (
          <div className="mt-2">
            <p>Generating preview...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;