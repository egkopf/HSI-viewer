import React, { useState } from 'react';
import { parseNetCDFStructure, loadNetCDFVariable } from '../utils/parseNetCDF.js';
import { parseHDF5Structure, loadHDF5Dataset } from '../utils/parseHDF5Structure.js';
import { parseHDF5StructureFromHeader, loadHDF5DatasetOnDemand, parseHDF5Bands, extractHDF5PixelSpectrum } from '../utils/hdf5HeaderParser.js';
import { parseMatStructure, loadMatVariable } from '../utils/parseMAT.js';
import { processStructuredData } from '../utils/processStructuredData.js';
import FileStructureTree from './FileStructureTree.js';


const StructuredFileUpload = ({ onFileProcessed }) => {
  const [fileStructure, setFileStructure] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedWavelength, setSelectedWavelength] = useState(null);
  const [selectedReflectance, setSelectedReflectance] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [useSelectiveReading] = useState(true);
  const [useHeaderOnly] = useState(true);

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

      if (fileName.endsWith('.nc') || fileName.endsWith('.netcdf') || fileName.endsWith('.h5') || fileName.endsWith('.hdf5') || fileName.endsWith('.mat')) {
        console.log('Processing structured file:', fileName);
        
        if (fileName.endsWith('.mat')) {
          console.log('Processing MATLAB file');
          structure = await parseMatStructure(file);
        } else if (useHeaderOnly) {
          console.log('Using header-only parsing (instant for any file size)');
          structure = await parseHDF5StructureFromHeader(file);
        } else if (fileName.endsWith('.nc') || fileName.endsWith('.netcdf')) {
          // For NetCDF files without header-only, use NetCDF parser for NetCDF3 support
          structure = await parseNetCDFStructure(file);
        } else {
          structure = await parseHDF5Structure(file);
        }
      } else {
        throw new Error('Unsupported file format. Please select a NetCDF (.nc), HDF5 (.h5), or MATLAB (.mat) file.');
      }

      setFileStructure(structure);
      
      // Log performance metrics
      if (structure.isHeaderOnly && structure.parsingTime) {
        console.log(`Header-only parsing took ${structure.parsingTime.toFixed(2)}ms - ${structure.efficiency} - truly instant!`);
      } else if (structure.parsingTime) {
        console.log(`Full file parsing took ${structure.parsingTime.toFixed(2)}ms - ${structure.efficiency}`);
      }
      
      // Auto-select obvious candidates
      autoSelectCandidates(structure);
      
    } catch (err) {
      setError(err.message);
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

      if (fileName.endsWith('.mat')) {
        // Load MATLAB variables
        console.log('Loading MATLAB datasets');
        
        const wavelengthResult = await loadMatVariable(selectedFile, selectedWavelength);
        const reflectanceResult = await loadMatVariable(selectedFile, selectedReflectance);
        
        wavelengthData = {
          values: Array.from(wavelengthResult.data),
          attributes: wavelengthResult.attributes
        };
        
        reflectanceData = {
          data: reflectanceResult.data,
          shape: reflectanceResult.shape,
          attributes: reflectanceResult.attributes
        };
        
      } else if (fileName.endsWith('.nc') || fileName.endsWith('.netcdf')) {
        // Load NetCDF datasets (only for files parsed with NetCDF parser)
        if (!fileStructure.isHeaderOnly) {
          const wavelengthPath = selectedWavelength.replace('/variables/', '');
          const reflectancePath = selectedReflectance.replace('/variables/', '');
          
          const fileSizeGB = selectedFile.size / (1024 * 1024 * 1024);
          const enableSelectiveReading = fileSizeGB > 1 && useSelectiveReading;
          
          console.log(`Loading NetCDF datasets from ${fileSizeGB.toFixed(1)}GB file, selective reading: ${enableSelectiveReading}`);
          
          const wavelengthResult = await loadNetCDFVariable(selectedFile, wavelengthPath, { useSelectiveReading: enableSelectiveReading });
          const reflectanceResult = await loadNetCDFVariable(selectedFile, reflectancePath, { useSelectiveReading: enableSelectiveReading });
          
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
        } else {
          // For header-only parsed files, use persistent HDF5 dataset loading
          const fileSizeGB = selectedFile.size / (1024 * 1024 * 1024);
          const enableSelectiveReading = fileSizeGB > 0.1 && useSelectiveReading; // Lower threshold to 100MB
          
          console.log(`Loading HDF5/NetCDF4 datasets from ${fileSizeGB.toFixed(1)}GB file, persistent handles: ${enableSelectiveReading}`);
          
          let wavelengthResult, reflectanceResult;
          if (enableSelectiveReading) {
            // Use new persistent file handle approach (no file reloading!)
            console.log('Using persistent file handles for HDF5/NetCDF4 loading...');
            wavelengthResult = await loadHDF5DatasetOnDemand(selectedFile, selectedWavelength);
            reflectanceResult = await loadHDF5DatasetOnDemand(selectedFile, selectedReflectance);
          } else {
            // Fallback to old approach for smaller files
            wavelengthResult = await loadHDF5Dataset(selectedFile, selectedWavelength, { useSelectiveReading: false });
            reflectanceResult = await loadHDF5Dataset(selectedFile, selectedReflectance, { useSelectiveReading: false });
          }
          
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
        
      } else if (fileName.endsWith('.h5') || fileName.endsWith('.hdf5')) {
        // Load HDF5 datasets with H5Web or selective reading for large files
        const fileSizeGB = selectedFile.size / (1024 * 1024 * 1024);
        
        // Use persistent file handles for efficient loading
        const enableSelectiveReading = fileSizeGB > 0.1 && useSelectiveReading; // Lower threshold to 100MB
        
        console.log(`Loading HDF5 datasets from ${fileSizeGB.toFixed(1)}GB file, persistent handles: ${enableSelectiveReading}`);
        
        let wavelengthResult, reflectanceResult;
        if (enableSelectiveReading) {
          // Use new persistent file handle approach (no file reloading!)
          console.log('Using persistent file handles for HDF5 loading...');
          wavelengthResult = await loadHDF5DatasetOnDemand(selectedFile, selectedWavelength);
          reflectanceResult = await loadHDF5DatasetOnDemand(selectedFile, selectedReflectance);
        } else {
          // Fallback to old approach for smaller files
          wavelengthResult = await loadHDF5Dataset(selectedFile, selectedWavelength, { useSelectiveReading: false });
          reflectanceResult = await loadHDF5Dataset(selectedFile, selectedReflectance, { useSelectiveReading: false });
        }
        
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
          accept=".nc,.netcdf,.h5,.hdf5,.mat"
          onChange={(e) => handleFileSelect(e.target.files[0])}
          className="hidden"
          id="structured-file-input"
        />
        <label
          htmlFor="structured-file-input"
          className="cursor-pointer flex flex-col items-center justify-center"
        >
          <div className="text-4xl mb-2">📁</div>
          <div className="text-lg font-medium">Select structured data file</div>
          <div className="text-sm text-gray-500">
            Supported formats: .nc, .netcdf, .h5, .hdf5, .mat
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