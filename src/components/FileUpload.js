import React, { useState } from 'react';
import { parseHDRFile, parseSpecificBands } from '../utils/parseHyperspectral';
import { parseGeoTIFF, parseGeoTIFFBands } from '../utils/parseGeoTIFF';
import { parseHDF5, parseHDF5Bands } from '../utils/parseHDF5';
import StructuredFileUpload from './StructuredFileUpload';

const FileUpload = ({ onDataReady }) => {
  const [processing, setProcessing] = useState(false);
  const [showWavelengthInput, setShowWavelengthInput] = useState(false);
  const [wavelengthInputValue, setWavelengthInputValue] = useState('');
  const [wavelengthUnit, setWavelengthUnit] = useState('nm');
  const [pendingFileData, setPendingFileData] = useState(null);
  const [structuredFile, setStructuredFile] = useState(null);

  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files);
    
    // Filter files to allow all supported formats
    const validFiles = files.filter(file => {
      const fileName = file.name.toLowerCase();
      
      // Allow structured formats
      if (fileName.endsWith('.h5') || fileName.endsWith('.hdf5') || 
          fileName.endsWith('.npy') ||
          fileName.endsWith('.tif') || fileName.endsWith('.tiff')) {
        return true;
      }
      
      // Allow ENVI files with proper extensions
      if (fileName.endsWith('.hdr') || fileName.endsWith('.bsq') || 
          fileName.endsWith('.bil') || fileName.endsWith('.bip')) {
        return true;
      }
      
      // Allow files without extensions (potential ENVI binary files)
      if (!fileName.includes('.')) {
        return true;
      }
      
      // Reject everything else (like .txt files)
      return false;
    });
    
    if (validFiles.length !== files.length) {
      const rejectedFiles = files.filter(file => !validFiles.includes(file));
      const rejectedNames = rejectedFiles.map(f => f.name).join(', ');
      alert(`Some files were not accepted: ${rejectedNames}\n\nAllowed files:\n- Structured: .h5, .hdf5, .npy\n- GeoTIFF: .tif, .tiff\n- ENVI: .hdr (header), .bsq/.bil/.bip (binary), or no extension (binary)`);
    }
    
    if (validFiles.length > 0) {
      processFiles(validFiles);
    }
  };

  const processFiles = async (files) => {
    try {
      setProcessing(true);

      // Check for file types in priority order
      const tiffFiles = [...files].filter(file => 
        file.name.toLowerCase().endsWith('.tif') || 
        file.name.toLowerCase().endsWith('.tiff'));
      
      const h5Files = [...files].filter(file => 
        file.name.toLowerCase().endsWith('.h5') || 
        file.name.toLowerCase().endsWith('.hdf5'));

      console.log('Files uploaded:', [...files].map(f => f.name));
      console.log('TIFF files found:', tiffFiles.map(f => f.name));
      console.log('HDF5 files found:', h5Files.map(f => f.name));

      // Check for structured files that need dataset selection
      
      const npyFiles = [...files].filter(file => 
        file.name.toLowerCase().endsWith('.npy'));

      // Route structured files automatically to StructuredFileUpload
      if (h5Files.length > 0 || npyFiles.length > 0) {
        console.log('Structured files detected - using structured upload mode');
        setStructuredFile(files[0]);
        setProcessing(false);
        return;
      }

      if (h5Files.length > 0) {
        // Process HDF5
        console.log('Processing as HDF5');
        await processHDF5(h5Files[0]);
      } else if (tiffFiles.length > 0) {
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

  const checkWavelengthsAndProceed = (fileData) => {
    const { metadata } = fileData;
    
    // Check if wavelengths are missing or invalid
    const hasValidWavelengths = metadata.wavelengthValues && 
                               metadata.wavelengthValues.length === metadata.bands &&
                               metadata.wavelengthValues.every(w => w > 0);

    if (!hasValidWavelengths) {
      // Show wavelength input dialog
      setPendingFileData(fileData);
      setShowWavelengthInput(true);
      setProcessing(false);
      
      // Generate placeholder wavelengths as suggestion
      const placeholderWavelengths = [];
      for (let i = 0; i < metadata.bands; i++) {
        placeholderWavelengths.push(400 + (i * (900 / (metadata.bands - 1))));
      }
      setWavelengthInputValue(placeholderWavelengths.map(w => w.toFixed(0)).join(', '));
      setWavelengthUnit('nm'); // Reset to nm as default
    } else {
      // Wavelengths are valid, proceed normally
      setProcessing(false);
      onDataReady(fileData);
    }
  };

  const handleWavelengthSubmit = () => {
    if (!pendingFileData) return;

    try {
      // Parse the input wavelengths
      const inputWavelengths = wavelengthInputValue
        .split(',')
        .map(w => parseFloat(w.trim()))
        .filter(w => !isNaN(w) && w > 0);

      // Validate count matches bands
      if (inputWavelengths.length !== pendingFileData.metadata.bands) {
        alert(`Please enter exactly ${pendingFileData.metadata.bands} wavelength values to match the number of bands in the file.`);
        return;
      }

      // Convert to consistent units (nanometers) if needed
      const wavelengthsInNm = wavelengthUnit === 'µm' 
        ? inputWavelengths.map(w => w * 1000) 
        : inputWavelengths;

      // Update metadata with user-provided wavelengths
      const updatedMetadata = {
        ...pendingFileData.metadata,
        wavelengthValues: wavelengthsInNm,
        hasRealWavelengths: true,
        wavelengthSource: `user input (${wavelengthUnit})`
      };

      const updatedFileData = {
        ...pendingFileData,
        metadata: updatedMetadata
      };

      // Clear the input state
      setShowWavelengthInput(false);
      setWavelengthInputValue('');
      setPendingFileData(null);

      // Proceed with the updated data
      onDataReady(updatedFileData);

    } catch (error) {
      console.error('Error processing wavelength input:', error);
      alert('Invalid wavelength format. Please enter numeric values separated by commas.');
    }
  };

  const handleSkipWavelengths = () => {
    // Proceed without wavelengths, mark metadata accordingly
    if (pendingFileData) {
      const updatedMetadata = {
        ...pendingFileData.metadata,
        wavelengthValues: null,
        hasRealWavelengths: false,
        wavelengthSource: 'none - user skipped wavelength input',
        usingBandNumbers: true
      };

      const updatedFileData = {
        ...pendingFileData,
        metadata: updatedMetadata
      };

      setShowWavelengthInput(false);
      setWavelengthInputValue('');
      setPendingFileData(null);
      
      onDataReady(updatedFileData);
    }
  };

  const processHDF5 = async (h5File) => {
    console.log(`Processing HDF5: ${h5File.name}`);
    const processingStartTime = performance.now();
    
    // Parse HDF5 metadata
    console.log('Parsing HDF5 metadata...');
    const metadataStartTime = performance.now();
    const metadata = await parseHDF5(h5File);
    const metadataTime = performance.now() - metadataStartTime;
    console.log(`HDF5 metadata parsed: ${metadataTime.toFixed(1)}ms`);
    
    // Get default RGB bands
    const defaultBands = metadata.defaultBands;
    console.log('Loading RGB bands:', defaultBands);

    // Load RGB band data
    const bandLoadStartTime = performance.now();
    const rgbData = await parseHDF5Bands(h5File, metadata, defaultBands);
    const bandLoadTime = performance.now() - bandLoadStartTime;
    console.log(`HDF5 bands loaded: ${bandLoadTime.toFixed(1)}ms`);
    
    const totalProcessingTime = performance.now() - processingStartTime;
    console.log(`HDF5 processing complete: ${totalProcessingTime.toFixed(1)}ms total`);

    const fileData = {
      fileName: h5File.name,
      dataFile: h5File,
      metadata,
      bandData: rgbData,
      loadedBands: defaultBands,
      fileType: 'hdf5'
    };

    // Check wavelengths and potentially show input dialog
    checkWavelengthsAndProceed(fileData);
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

    const fileData = {
      fileName: tiffFile.name,
      dataFile: tiffFile,
      metadata,
      bandData: rgbData,
      loadedBands: defaultBands,
      fileType: 'geotiff'
    };

    // Check wavelengths and potentially show input dialog
    checkWavelengthsAndProceed(fileData);
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

    const fileData = {
      fileName: dataFile.name,
      dataFile,
      metadata,
      bandData: rgbData,
      loadedBands: defaultBands,
      fileType: 'envi'
    };

    // Check wavelengths and potentially show input dialog
    checkWavelengthsAndProceed(fileData);
  };

  // Handler for structured file uploads
  const handleStructuredFileProcessed = (processedData) => {
    const { file, metadata, bandData, wavelengthData, reflectanceData } = processedData;
    
    // Create file data object compatible with existing pipeline
    const fileData = {
      fileName: file.name,
      dataFile: file,
      metadata,
      bandData,
      loadedBands: metadata.defaultBands,
      wavelengthData,
      reflectanceData,
      fileType: getFileType(file.name),
      isStructured: true
    };

    // Clear structured file state and proceed
    setStructuredFile(null);
    setProcessing(false);
    onDataReady(fileData);
  };

  // Helper function to determine file type
  const getFileType = (fileName) => {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.h5') || lowerName.endsWith('.hdf5')) return 'hdf5';
    if (lowerName.endsWith('.npy')) return 'numpy';
    return 'unknown';
  };

  // Handle canceling structured upload to go back to regular upload
  const handleStructuredCancel = () => {
    setStructuredFile(null);
  };

  return (
    <div className="space-y-4">
      {/* Show structured upload if structured file detected, otherwise show regular upload */}
      {structuredFile ? (
        <StructuredFileUpload 
          initialFile={structuredFile}
          onFileProcessed={handleStructuredFileProcessed}
          onCancel={handleStructuredCancel}
        />
      ) : (
        <div className="relative">
          <input
            type="file"
            multiple
            onChange={(e) => handleFileInputChange(e)}
            disabled={processing || showWavelengthInput}
            className="w-full text-xs"
          />
          
          {processing && (
            <div className="absolute inset-0 bg-blue-100 bg-opacity-90 flex items-center justify-center rounded">
              <div className="text-xs text-blue-800 font-medium">
                Loading data
                <span className="dot-1">.</span>
                <span className="dot-2">.</span>
                <span className="dot-3">.</span>
              </div>
              <style>{`
                .dot-1 {
                  animation: dot1 2s infinite;
                }
                .dot-2 {
                  animation: dot2 2s infinite;
                }
                .dot-3 {
                  animation: dot3 2s infinite;
                }
                @keyframes dot1 {
                  0%, 100% { opacity: 0; }
                  25%, 50%, 75% { opacity: 1; }
                }
                @keyframes dot2 {
                  0%, 25%, 100% { opacity: 0; }
                  50%, 75% { opacity: 1; }
                }
                @keyframes dot3 {
                  0%, 25%, 50%, 100% { opacity: 0; }
                  75% { opacity: 1; }
                }
              `}</style>
            </div>
          )}
        </div>
      )}

      {showWavelengthInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg border border-gray-300 shadow-xl max-w-md w-full mx-4">
            <div className="text-sm font-medium mb-3">
              No wavelength data detected. You can optionally provide wavelengths for {pendingFileData?.metadata?.bands} bands:
            </div>
            <textarea
              value={wavelengthInputValue}
              onChange={(e) => setWavelengthInputValue(e.target.value)}
              placeholder="Enter wavelengths separated by commas (e.g., 400, 450, 500, 550, 600)"
              className="w-full text-sm border rounded px-2 py-2 mb-3 h-20 resize-none"
            />
            <div className="mb-3">
              <div className="text-xs text-gray-600 mb-2">
                Expected: {pendingFileData?.metadata?.bands} values (optional)
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    value="nm"
                    checked={wavelengthUnit === 'nm'}
                    onChange={(e) => setWavelengthUnit(e.target.value)}
                    className="text-blue-500"
                  />
                  Nanometers (nm)
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    value="µm"
                    checked={wavelengthUnit === 'µm'}
                    onChange={(e) => setWavelengthUnit(e.target.value)}
                    className="text-blue-500"
                  />
                  Micrometers (µm)
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleWavelengthSubmit}
                className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm flex-1"
                disabled={!wavelengthInputValue.trim()}
              >
                Apply Wavelengths
              </button>
              <button
                onClick={handleSkipWavelengths}
                className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm flex-1"
              >
                Use Band Numbers
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload;