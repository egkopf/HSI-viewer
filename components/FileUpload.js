import React, { useState } from 'react';
import { parseHDRFile, parseSpecificBands } from '../utils/parseHyperspectral';
import { parseGeoTIFF, parseGeoTIFFBands } from '../utils/parseGeoTIFF';

const FileUpload = ({ onDataReady }) => {
  const [processing, setProcessing] = useState(false);

  const processFiles = async (files) => {
    try {
      setProcessing(true);

      // Check for GeoTIFF files first
      const tiffFiles = [...files].filter(file => 
        file.name.toLowerCase().endsWith('.tif') || 
        file.name.toLowerCase().endsWith('.tiff'));

      console.log('Files uploaded:', [...files].map(f => f.name));
      console.log('TIFF files found:', tiffFiles.map(f => f.name));

      if (tiffFiles.length > 0) {
        // Process GeoTIFF
        console.log('Processing as GeoTIFF');
        await processGeoTIFF(tiffFiles[0]);
      } else {
        // Process ENVI format (existing logic)
        console.log('Processing as ENVI');
        await processENVI(files);
      }

    } catch (error) {
      console.error('Error processing files:', error);
      setProcessing(false);
      alert('File processing failed: ' + error.message);
    }
  };

  const processGeoTIFF = async (tiffFile) => {
    console.log(`Processing GeoTIFF: ${tiffFile.name}`);
    
    // Parse GeoTIFF metadata
    const metadata = await parseGeoTIFF(tiffFile);
    
    // Get default RGB bands
    const defaultBands = metadata.defaultBands;
    console.log('Loading RGB bands:', defaultBands);

    // Load RGB band data
    const rgbData = await parseGeoTIFFBands(tiffFile, metadata, defaultBands);

    setProcessing(false);

    // Send data to parent
    onDataReady({
      fileName: tiffFile.name,
      dataFile: tiffFile,
      metadata,
      bandData: rgbData,
      loadedBands: defaultBands,
      fileType: 'geotiff'
    });
  };

  const processENVI = async (files) => {
    // Find header file first
    const headerExtensions = ['.hdr', '.HDR'];
    const headerFile = [...files].find(file =>
      headerExtensions.some(ext => file.name.toLowerCase().endsWith(ext)));

    if (!headerFile) {
      throw new Error('Header file (.hdr) required for ENVI format');
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

    console.log(`Processing ENVI header: ${headerFile.name}`);
    console.log(`Processing ENVI data: ${dataFile.name}`);

    // Get default RGB bands
    const defaultBands = metadata.defaultBands;
    console.log('Loading RGB bands:', defaultBands);

    // Load only the RGB bands
    const rgbData = await parseSpecificBands(dataFile, metadata, defaultBands);

    setProcessing(false);

    // Send the data to parent - ADD fileType here
    onDataReady({
      fileName: dataFile.name,
      dataFile,
      metadata,
      bandData: rgbData,
      loadedBands: defaultBands,
      fileType: 'envi'  // Add this line
    });
  };

  return (
    <div className="my-4">
      <div className="flex flex-col gap-2">
        <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
          <input
            type="file"
            accept="*"
            multiple
            onChange={(e) => processFiles(e.target.files)}
            disabled={processing}
            className="w-full"
          />
          <p className="mt-2 text-sm text-gray-500">
            Upload ENVI files (.hdr + data file) or GeoTIFF files (.tif/.tiff)
          </p>
        </div>

        {processing && (
          <div className="mt-2">
            <p>Loading data...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;