import React, { useState } from 'react';
import { parseHDRFile, parseBSQFile } from '../utils/parseHyperspectral';

const FileUpload = ({ onUploadComplete }) => { // callback property
  const [uploadProgress, setUploadProgress] = useState(0); //progress 0-100
  const [processing, setProcessing] = useState(false); // currently processing files or not

  const processFiles = async (hdrFile, bsqFile) => {
    try {
      setProcessing(true);

      console.log('Processing HDR file:', hdrFile.name);
      const metadata = await parseHDRFile(hdrFile); // Process HDR file
      console.log('HDR metadata parsed:', metadata);

      // const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunk size just for progress bar (not functional now)
      // const totalChunks = Math.ceil(bsqFile.size / CHUNK_SIZE);

      console.log('Processing BSQ file:', bsqFile.name);
      const bsqBuffer = await bsqFile.arrayBuffer(); // read the entire BSQ file at once because processing client-side
      console.log('BSQ file loaded, size:', bsqBuffer.byteLength);

      const imageData = await parseBSQFile(new File([bsqBuffer], bsqFile.name), metadata); // Process BSQ file
      console.log('BSQ processing complete');

      setUploadProgress(100);
      setProcessing(false);

      // pass all processed data back to parent component
      onUploadComplete({
        fileName: bsqFile.name,
        metadata,
        imageData
      });

    } catch (error) { // error processing
      console.error('Error processing files:', error);
      setProcessing(false);
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
        disabled={processing}
      />
      {processing && (
        <div>
          <progress value={uploadProgress} max="100"></progress>
          <p>{Math.round(uploadProgress)}% processed</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;