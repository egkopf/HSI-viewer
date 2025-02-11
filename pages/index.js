// pages/index.js
import { useState } from 'react';
import FileUpload from '../components/FileUpload';
import ImageRenderer from '../components/ImageRenderer';
import { parseHDRFile, parseBSQFile } from '../utils/parseHyperspectral';

export default function Home() {
  const [hdrMetadata, setHdrMetadata] = useState(null);
  const [imageData, setImageData] = useState(null);

  const handleUploadComplete = ({ fileName, metadata, imageData }) => {
    console.log('File processing complete for:', fileName);
    setHdrMetadata(metadata);
    setImageData(imageData);
  };

  return (
    <div>
      <h1>Hyperspectral Data Viewer</h1>
      <FileUpload onUploadComplete={handleUploadComplete} />
      {imageData && hdrMetadata && <ImageRenderer data={imageData} metadata={hdrMetadata} />}
    </div>
  );
}
