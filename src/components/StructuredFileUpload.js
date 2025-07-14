import React, { useState } from 'react';
import { parseNetCDFStructure, loadNetCDFVariable } from '../utils/parseNetCDF.js';
import { parseHDF5Structure, loadHDF5Dataset } from '../utils/parseHDF5Structure.js';
import { processStructuredData } from '../utils/processStructuredData.js';
import FileStructureTree from './FileStructureTree.js';

const StructuredFileUpload = ({ onFileProcessed }) => {
  const [fileStructure, setFileStructure] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedWavelength, setSelectedWavelength] = useState(null);
  const [selectedReflectance, setSelectedReflectance] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  const handleFileSelect = async (file) => {
    if (!file) return;

    setSelectedFile(file);
    setFileStructure(null);
    setSelectedWavelength(null);
    setSelectedReflectance(null);
    setError(null);
    setIsProcessing(true);

    // Check for large files and warn user
    const fileSizeMB = file.size / 1024 / 1024;
    const fileSizeGB = file.size / 1024 / 1024 / 1024;
    
    if (fileSizeMB > 500) {
      console.warn(`Large file detected: ${fileSizeMB.toFixed(1)}MB`);
    }
    
    // For very large files (>2GB), show warning but still attempt processing
    if (fileSizeGB > 2) {
      console.warn(`Very large file detected: ${fileSizeGB.toFixed(1)}GB - this may fail due to browser memory limits`);
    }

    try {
      let structure;
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.nc') || fileName.endsWith('.netcdf')) {
        console.log('Processing NetCDF file:', fileName);
        structure = await parseNetCDFStructure(file);
      } else if (fileName.endsWith('.h5') || fileName.endsWith('.hdf5')) {
        console.log('Processing HDF5 file:', fileName);
        structure = await parseHDF5Structure(file);
      } else {
        throw new Error('Unsupported file format. Please select a NetCDF (.nc) or HDF5 (.h5) file.');
      }

      setFileStructure(structure);
      
      // Auto-select obvious candidates
      autoSelectCandidates(structure);
      
    } catch (err) {
      let errorMessage = err.message;
      
      // Add helpful suggestions based on the error
      if (err.message.includes('This appears to be a pure HDF5 file')) {
        errorMessage += '\n\nTip: Try uploading this file using the HDF5 (.h5) option instead.';
      } else if (err.message.includes('NetCDF4/HDF5 format signature but cannot be parsed')) {
        errorMessage += '\n\nTip: If this is actually an HDF5 file, try uploading it using the HDF5 (.h5) option instead.';
      } else if (err.message.includes('File too large for browser processing')) {
        errorMessage += '\n\n📋 Python Example to Extract Data:\n\nimport h5py\nimport numpy as np\n\n# Open the large file\nwith h5py.File("your_file.nc", "r") as f:\n    # Explore structure\n    print(list(f.keys()))\n    \n    # Extract smaller subset\n    wavelengths = f["wavelength"][:]\n    reflectance = f["reflectance"][:100, :100, :]  # First 100x100 pixels\n    \n    # Save smaller file\n    with h5py.File("small_subset.h5", "w") as out:\n        out.create_dataset("wavelength", data=wavelengths)\n        out.create_dataset("reflectance", data=reflectance)';
      }
      
      setError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const autoSelectCandidates = (structure) => {
    const candidates = findCandidates(structure);
    
    // Auto-select if we have clear candidates
    if (candidates.wavelength.length === 1) {
      setSelectedWavelength(candidates.wavelength[0].path);
    }
    if (candidates.reflectance.length === 1) {
      setSelectedReflectance(candidates.reflectance[0].path);
    }
  };

  const findCandidates = (node, wavelengthCandidates = [], reflectanceCandidates = []) => {
    if (node.isWavelengthCandidate) {
      wavelengthCandidates.push(node);
    }
    if (node.isReflectanceCandidate) {
      reflectanceCandidates.push(node);
    }
    
    if (node.children) {
      node.children.forEach(child => 
        findCandidates(child, wavelengthCandidates, reflectanceCandidates)
      );
    }
    
    return { wavelength: wavelengthCandidates, reflectance: reflectanceCandidates };
  };

  const handleDatasetSelect = (path, dataType) => {
    if (dataType === 'wavelength') {
      setSelectedWavelength(path === selectedWavelength ? null : path);
    } else if (dataType === 'reflectance') {
      setSelectedReflectance(path === selectedReflectance ? null : path);
    }
  };

  const handleProcessFile = async () => {
    if (!selectedFile || !selectedWavelength || !selectedReflectance) {
      setError('Please select both wavelength and reflectance datasets');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const fileName = selectedFile.name.toLowerCase();
      let wavelengthData, reflectanceData;

      if (fileName.endsWith('.nc') || fileName.endsWith('.netcdf')) {
        // Load NetCDF datasets
        const wavelengthPath = selectedWavelength.replace('/variables/', '');
        const reflectancePath = selectedReflectance.replace('/variables/', '');
        
        const wavelengthResult = await loadNetCDFVariable(selectedFile, wavelengthPath);
        const reflectanceResult = await loadNetCDFVariable(selectedFile, reflectancePath);
        
        wavelengthData = {
          values: Array.from(wavelengthResult.data),
          attributes: wavelengthResult.attributes
        };
        
        reflectanceData = {
          data: reflectanceResult.data,
          shape: reflectanceResult.shape,
          dimensions: reflectanceResult.dimensions,
          attributes: reflectanceResult.attributes
        };
        
      } else if (fileName.endsWith('.h5') || fileName.endsWith('.hdf5')) {
        // Load HDF5 datasets
        const wavelengthResult = await loadHDF5Dataset(selectedFile, selectedWavelength);
        const reflectanceResult = await loadHDF5Dataset(selectedFile, selectedReflectance);
        
        wavelengthData = {
          values: Array.from(wavelengthResult.data),
          attributes: wavelengthResult.attributes
        };
        
        reflectanceData = {
          data: reflectanceResult.data,
          shape: reflectanceResult.shape,
          attributes: reflectanceResult.attributes
        };
      }

      // Create metadata object compatible with existing pipeline
      const metadata = createMetadataFromStructuredData(
        wavelengthData,
        reflectanceData,
        selectedFile.name
      );

      // Process the structured data for the existing pipeline
      const processedData = processStructuredData(wavelengthData, reflectanceData, metadata);

      // Call the callback with processed data
      onFileProcessed({
        file: selectedFile,
        metadata: processedData.metadata,
        bandData: processedData.bandData,
        wavelengthData,
        reflectanceData,
        isStructured: true
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const createMetadataFromStructuredData = (wavelengthData, reflectanceData, filename) => {
    const shape = reflectanceData.shape;
    
    // Try to determine the data layout from shape
    let samples, lines, bands;
    if (shape.length === 3) {
      // Common layouts: [lines, samples, bands] or [bands, lines, samples]
      if (shape[2] === wavelengthData.values.length) {
        // [lines, samples, bands] format
        [lines, samples, bands] = shape;
      } else if (shape[0] === wavelengthData.values.length) {
        // [bands, lines, samples] format
        [bands, lines, samples] = shape;
      } else {
        // Fallback: assume [lines, samples, bands]
        [lines, samples, bands] = shape;
      }
    } else {
      throw new Error(`Unsupported reflectance data shape: ${shape}`);
    }

    return {
      samples,
      lines,
      bands,
      wavelengthValues: wavelengthData.values,
      dataType: 12, // Default to uint16
      interleave: 'bsq',
      byteOrder: 0,
      isBigEndian: false,
      headerOffset: 0,
      filename,
      isStructured: true,
      originalShape: shape
    };
  };

  return (
    <div className="space-y-4">
      {/* File Upload */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
        <input
          type="file"
          accept=".nc,.netcdf,.h5,.hdf5"
          onChange={(e) => handleFileSelect(e.target.files[0])}
          className="hidden"
          id="structured-file-input"
        />
        <label
          htmlFor="structured-file-input"
          className="cursor-pointer flex flex-col items-center justify-center"
        >
          <div className="text-4xl mb-2">📁</div>
          <div className="text-lg font-medium">Select NetCDF or HDF5 file</div>
          <div className="text-sm text-gray-500">
            Supported formats: .nc, .netcdf, .h5, .hdf5
          </div>
        </label>
      </div>

      {/* Processing Status */}
      {isProcessing && (
        <div className="text-center py-4">
          <div className="text-lg">Processing file...</div>
          <div className="text-sm text-gray-500">
            {selectedFile && selectedFile.size > 1024 * 1024 * 1024 
              ? `Analyzing large file (${(selectedFile.size / 1024 / 1024 / 1024).toFixed(1)}GB) - trying progressively larger header sizes...`
              : 'Analyzing file structure'
            }
          </div>
          {selectedFile && selectedFile.size > 1024 * 1024 * 1024 && (
            <div className="text-xs text-yellow-600 mt-2">
              Large files may cause memory issues. Consider using a smaller subset of the data.
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-red-800 font-medium">Error:</div>
          <div className="text-red-700">{error}</div>
        </div>
      )}

      {/* File Structure Tree */}
      {fileStructure && (
        <FileStructureTree
          structure={fileStructure}
          onDatasetSelect={handleDatasetSelect}
          selectedWavelength={selectedWavelength}
          selectedReflectance={selectedReflectance}
        />
      )}

      {/* Selection Summary */}
      {fileStructure && (
        <div className="bg-gray-50 border rounded-lg p-4">
          <h4 className="font-medium mb-2">Selection Summary:</h4>
          <div className="space-y-1 text-sm">
            <div>
              <span className="font-medium">Wavelength data:</span>{' '}
              {selectedWavelength ? (
                <span className="text-blue-600">{selectedWavelength}</span>
              ) : (
                <span className="text-gray-500">Not selected</span>
              )}
            </div>
            <div>
              <span className="font-medium">Reflectance data:</span>{' '}
              {selectedReflectance ? (
                <span className="text-green-600">{selectedReflectance}</span>
              ) : (
                <span className="text-gray-500">Not selected</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Process Button */}
      {fileStructure && (
        <button
          onClick={handleProcessFile}
          disabled={!selectedWavelength || !selectedReflectance || isProcessing}
          className={`w-full py-3 px-4 rounded-lg font-medium ${
            selectedWavelength && selectedReflectance && !isProcessing
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isProcessing ? 'Processing...' : 'Process File'}
        </button>
      )}
    </div>
  );
};

export default StructuredFileUpload;