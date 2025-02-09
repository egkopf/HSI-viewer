// pages/index.js
import { useState } from 'react';
import FileUpload from '../components/FileUpload';
import ImageRenderer from '../components/ImageRenderer';
import { parseHDRFile, parseBSQFile } from '../utils/parseHyperspectral';

export default function Home() {
  const [hdrMetadata, setHdrMetadata] = useState(null);
  const [imageData, setImageData] = useState(null);

  const handleUploadComplete = async (fileName) => {
    console.log('Starting post-upload processing for:', fileName);

    try {
      const hdrResponse = await fetch(`/uploads/${fileName.replace('.bsq', '.hdr')}`);
      console.log('HDR response status:', hdrResponse.status);
      const hdrText = await hdrResponse.text();
      console.log('HDR text received, length:', hdrText.length);

      const hdrFile = new File([hdrText], `${fileName}.hdr`, { type: 'text/plain' });
      const metadata = await parseHDRFile(hdrFile);
      console.log('Parsed metadata:', metadata);

      const bsqResponse = await fetch(`/uploads/${fileName}`);
      console.log('BSQ response status:', bsqResponse.status);
      const bsqBuffer = await bsqResponse.arrayBuffer();
      console.log('BSQ buffer received, length:', bsqBuffer.byteLength);

      const bsqFile = new File([bsqBuffer], fileName, { type: 'application/octet-stream' });
      const data = await parseBSQFile(bsqFile, metadata);
      console.log('BSQ data parsed, number of bands:', data.length);

      setHdrMetadata(metadata);
      setImageData(data);
      console.log('State updated with parsed data');
    } catch (error) {
      console.error('Error in handleUploadComplete:', error);
    }
  };

  return (
    <div>
      <h1>Hyperspectral Data Viewer</h1>
      <FileUpload onUploadComplete={handleUploadComplete} />
      {imageData && hdrMetadata && <ImageRenderer data={imageData} metadata={hdrMetadata} />}
    </div>
  );
}
