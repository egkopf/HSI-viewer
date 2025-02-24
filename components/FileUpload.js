import React, { useState } from 'react';
import { parseHDRFile, parseRGBPreview, parseFullBSQ } from '../utils/parseHyperspectral';

const FileUpload = ({ onPreviewReady, onFullDataReady }) => {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processingFull, setProcessingFull] = useState(false);

  const processFiles = async (hdrFile, bsqFile) => {
    try {
      setProcessing(true);

      // Parse HDR file first
      console.log('Processing HDR file:', hdrFile.name);
      const metadata = await parseHDRFile(hdrFile);
      console.log('HDR metadata parsed:', metadata);

      // Get default RGB bands or use fallback values
      const defaultBands = metadata["default bands"]
        ? metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number)
        : [60, 40, 20]; // Fallback RGB bands if not specified

      // Quick parse of just the RGB bands
      console.log('Processing RGB preview...');
      const rgbData = await parseRGBPreview(bsqFile, metadata, defaultBands);

      // Send the preview data to parent
      onPreviewReady({
        fileName: bsqFile.name,
        metadata,
        imageData: rgbData
      });

      setProcessing(false);

      // Start processing the full dataset in the background
      setProcessingFull(true);
      console.log('Processing full hyperspectral data...');

      const fullData = await parseFullBSQ(bsqFile, metadata, (progress) => {
        setUploadProgress(progress);
      });

      setProcessingFull(false);
      setUploadProgress(100);

      // Send the complete data to parent
      onFullDataReady({
        fileName: bsqFile.name,
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

  const handleFileUpload = (files) => {
    const hdrFile = [...files].find(file => file.name.endsWith('.hdr'));
    const bsqFile = [...files].find(file => file.name.endsWith('.bsq'));

    if (!hdrFile || !bsqFile) {
      alert('Please upload both .hdr and .bsq files.');
      return;
    }

    processFiles(hdrFile, bsqFile);
  };

  return (
    <div>
      <input
        type="file"
        accept=".bsq,.hdr"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
        disabled={processing || processingFull}
      />
      {(processing || processingFull) && (
        <div>
          {processing ? (
            <p>Generating preview...</p>
          ) : (
            <>
              <progress value={uploadProgress} max="100" />
              <p>Processing full dataset: {Math.round(uploadProgress)}%</p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUpload;