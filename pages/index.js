import { useState } from 'react';
import FileUpload from '../components/FileUpload';
import ImageRenderer from '../components/ImageRenderer';

export default function Home() {
  const [metadata, setMetadata] = useState(null);
  const [bandData, setBandData] = useState(null);
  const [loadedBands, setLoadedBands] = useState(null);
  const [dataFile, setDataFile] = useState(null);
  const [fileName, setFileName] = useState(null);

  const handleDataReady = ({ fileName, dataFile, metadata, bandData, loadedBands }) => {
    console.log('Data ready for:', fileName);
    setMetadata(metadata);
    setBandData(bandData);
    setLoadedBands(loadedBands);
    setDataFile(dataFile);
    setFileName(fileName);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Hyperspectral Data Viewer</h1>

      <FileUpload onDataReady={handleDataReady} />

      {/* When there is data ready, display the ImageRenderer */}
      {bandData && metadata && (
        <div className="mt-4">
          {/* <p className="mb-2 text-gray-600">
            Loaded: {fileName} (Bands: {loadedBands?.join(', ')})
          </p> */}
          <ImageRenderer
            bandData={bandData}
            metadata={metadata}
            loadedBands={loadedBands}
            dataFile={dataFile}
          />
        </div>
      )}
    </div>
  );
}