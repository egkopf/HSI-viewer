import { useState } from 'react';
import FileUpload from '../components/FileUpload';
import ImageRenderer from '../components/ImageRenderer';

export default function Home() {
  const [hdrMetadata, setHdrMetadata] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [fullData, setFullData] = useState(null);
  const [isPreview, setIsPreview] = useState(true);

  const handlePreviewReady = ({ fileName, metadata, imageData }) => {
    console.log('Preview ready for:', fileName);
    setHdrMetadata(metadata);
    setPreviewData(imageData);
    setIsPreview(true);
  };

  const handleFullDataReady = ({ fileName, metadata, imageData }) => {
    console.log('Full data ready for:', fileName);
    setFullData(imageData);
    setIsPreview(false);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Hyperspectral Data Viewer</h1>

      <FileUpload
        onPreviewReady={handlePreviewReady}
        onFullDataReady={handleFullDataReady}
      />

      {previewData && hdrMetadata && (
        <div className="mt-4">
          {isPreview && (
            <p className="mb-2 text-blue-600">
              Quick preview (processing full dataset...)
            </p>
          )}
          <ImageRenderer
            data={isPreview ? previewData : fullData}
            metadata={hdrMetadata}
            isPreview={isPreview}
          />
        </div>
      )}
    </div>
  );
}