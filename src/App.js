import { useState } from 'react';
import FileUpload from './components/FileUpload';
import ImageRenderer from './components/ImageRenderer';
import ResizableSplitter from './components/ResizableSplitter';
import { SharedSpectralProvider } from './utils/sharedSpectralContent';

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
      <div className="px-2.5 py-2 h-screen flex flex-col max-w-none">
        {/* Compact Header */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold">Hyperspectral Data Viewer</h1>
          <span className="text-xs text-gray-500">ENVI (.hdr + data), GeoTIFF (.tif/.tiff), or HDF5 (.h5/.hdf5)</span>
        </div>

        {/* Compact File Upload Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <div className="border rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">
                File 1 {fileName1 && <span className="text-xs text-gray-600">({fileName1})</span>}
              </span>
              {hasFile1 && (
                <button 
                  onClick={() => clearFile(1)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Clear
                </button>
              )}
            </div>
            <FileUpload onDataReady={(data) => handleDataReady(data, 1)} />
          </div>

          <div className="border rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">
                File 2 {fileName2 && <span className="text-xs text-gray-600">({fileName2})</span>}
              </span>
              {hasFile2 && (
                <button 
                  onClick={() => clearFile(2)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Clear
                </button>
              )}
            </div>
            <FileUpload onDataReady={(data) => handleDataReady(data, 2)} />
          </div>
        </div>

        {/* Main Content Area - Takes remaining height */}
        <div className="flex-1 min-h-0">
          {hasBothFiles ? (
            // Two-file layout with resizable splitter
            <ResizableSplitter defaultLeftWidth={50} minWidth={25}>
              <div className="flex flex-col min-h-0 h-full">
                {/* <h3 className="text-sm font-semibold mb-1">File 1: {fileName1}</h3> */}
                <div className="flex-1 min-h-0">
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
              </div>
              <div className="flex flex-col min-h-0 h-full">
                {/* <h3 className="text-sm font-semibold mb-1">File 2: {fileName2}</h3> */}
                <div className="flex-1 min-h-0">
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
            </ResizableSplitter>
          ) : hasFile1 ? (
            // Single file layout (File 1)
            <div className="h-full flex flex-col">
              {/* <h3 className="text-sm font-semibold mb-1">File: {fileName1}</h3> */}
              <div className="flex-1 min-h-0">
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
            </div>
          ) : hasFile2 ? (
            // Single file layout (File 2)
            <div className="h-full flex flex-col">
              <h3 className="text-sm font-semibold mb-1">File: {fileName2}</h3>
              <div className="flex-1 min-h-0">
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
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Upload hyperspectral files to begin analysis
            </div>
          )}
        </div>
      </div>
    </SharedSpectralProvider>
  );
}