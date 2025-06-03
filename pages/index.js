import { useState } from 'react';
import FileUpload from '../components/FileUpload';
import ImageRenderer from '../components/ImageRenderer';
import { SharedSpectralProvider } from '../utils/sharedSpectralContent';

export default function Home() {
  // Primary file state
  const [metadata1, setMetadata1] = useState(null);
  const [bandData1, setBandData1] = useState(null);
  const [loadedBands1, setLoadedBands1] = useState(null);
  const [dataFile1, setDataFile1] = useState(null);
  const [fileName1, setFileName1] = useState(null);
  const [fileType1, setFileType1] = useState(null);

  // Secondary file state
  const [metadata2, setMetadata2] = useState(null);
  const [bandData2, setBandData2] = useState(null);
  const [loadedBands2, setLoadedBands2] = useState(null);
  const [dataFile2, setDataFile2] = useState(null);
  const [fileName2, setFileName2] = useState(null);
  const [fileType2, setFileType2] = useState(null);

  const handleDataReady = (fileData, slot = 1) => {
    const { fileName, dataFile, metadata, bandData, loadedBands, fileType } = fileData;
    console.log(`Data ready for slot ${slot}:`, fileName);
    
    if (slot === 1) {
      setMetadata1(metadata);
      setBandData1(bandData);
      setLoadedBands1(loadedBands);
      setDataFile1(dataFile);
      setFileName1(fileName);
      setFileType1(fileType);
    } else {
      setMetadata2(metadata);
      setBandData2(bandData);
      setLoadedBands2(loadedBands);
      setDataFile2(dataFile);
      setFileName2(fileName);
      setFileType2(fileType);
    }
  };

  const clearFile = (slot) => {
    if (slot === 1) {
      setMetadata1(null);
      setBandData1(null);
      setLoadedBands1(null);
      setDataFile1(null);
      setFileName1(null);
      setFileType1(null);
    } else {
      setMetadata2(null);
      setBandData2(null);
      setLoadedBands2(null);
      setDataFile2(null);
      setFileName2(null);
      setFileType2(null);
    }
  };

  const hasFile1 = bandData1 && metadata1;
  const hasFile2 = bandData2 && metadata2;
  const hasBothFiles = hasFile1 && hasFile2;

  return (
    <SharedSpectralProvider>
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Hyperspectral Data Viewer</h1>

        {/* File Upload Section */}
        <div className="border rounded-lg p-4 mb-4">
          <h3 className="font-semibold mb-2">Upload Files</h3>
          <p className="text-sm text-gray-500 mb-4">
            Upload ENVI files (.hdr + data file) or GeoTIFF files (.tif/.tiff)
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-medium">File 1 {fileName1 && `(${fileName1})`}</h4>
                {hasFile1 && (
                  <button 
                    onClick={() => clearFile(1)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
              <FileUpload onDataReady={(data) => handleDataReady(data, 1)} />
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-medium">File 2 {fileName2 && `(${fileName2})`}</h4>
                {hasFile2 && (
                  <button 
                    onClick={() => clearFile(2)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
              <FileUpload onDataReady={(data) => handleDataReady(data, 2)} />
            </div>
          </div>
        </div>

        {/* Image Display Section */}
        {hasBothFiles ? (
          // Two-file layout
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">File 1: {fileName1}</h3>
              <ImageRenderer
                bandData={bandData1}
                metadata={metadata1}
                loadedBands={loadedBands1}
                dataFile={dataFile1}
                fileType={fileType1}
                enableSharedSpectral={true}
                isMainSpectralDisplay={true}
              />
            </div>
            <div>
              <h3 className="font-semibold mb-2">File 2: {fileName2}</h3>
              <ImageRenderer
                bandData={bandData2}
                metadata={metadata2}
                loadedBands={loadedBands2}
                dataFile={dataFile2}
                fileType={fileType2}
                enableSharedSpectral={true}
                isMainSpectralDisplay={false}
              />
            </div>
          </div>
        ) : hasFile1 ? (
          // Single file layout (File 1)
          <div className="mt-4">
            <h3 className="font-semibold mb-2">File: {fileName1}</h3>
            <ImageRenderer
              bandData={bandData1}
              metadata={metadata1}
              loadedBands={loadedBands1}
              dataFile={dataFile1}
              fileType={fileType1}
              enableSharedSpectral={false}
              isMainSpectralDisplay={true}
            />
          </div>
        ) : hasFile2 ? (
          // Single file layout (File 2)
          <div className="mt-4">
            <h3 className="font-semibold mb-2">File: {fileName2}</h3>
            <ImageRenderer
              bandData={bandData2}
              metadata={metadata2}
              loadedBands={loadedBands2}
              dataFile={dataFile2}
              fileType={fileType2}
              enableSharedSpectral={false}
              isMainSpectralDisplay={true}
            />
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            Upload hyperspectral files to begin analysis
          </div>
        )}
      </div>
    </SharedSpectralProvider>
  );
}