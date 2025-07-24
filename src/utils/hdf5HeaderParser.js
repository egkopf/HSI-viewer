// HDF5/NetCDF4 instant parser using web workers + WORKERFS
// Based on myhdf5.hdfgroup.org approach for true lazy loading without loading entire files
// This provides instant parsing like https://myhdf5.hdfgroup.org for any file size

import hdf5WorkerManager from './hdf5WorkerManager.js';

// Parse HDF5/NetCDF4 structure using web worker + WORKERFS approach
export async function parseHDF5StructureFromHeader(file) {
  const fileType = file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.netcdf') ? 'NetCDF4' : 'HDF5';
  console.log(`Starting ${fileType} lazy loading using WORKERFS in web worker for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  const startTime = performance.now();
  
  try {
    // Use worker manager for true lazy loading (like myhdf5.hdfgroup.org)
    const metadata = await hdf5WorkerManager.parseHDF5Structure(file);
    
    const endTime = performance.now();
    const parsingTime = endTime - startTime;
    
    console.log(`${fileType} lazy loading completed in ${parsingTime.toFixed(2)}ms using WORKERFS`);
    
    // Check if metadata is already in structure format (new worker approach)
    const structure = metadata.type === 'hdf5' ? metadata : convertMetadataToStructure(metadata, fileType);
    
    // If structure is already complete, use it directly with additional metadata
    if (structure.type === 'hdf5') {
      return {
        ...structure,
        format: `${fileType} (WORKERFS Lazy)`,
        isHeaderOnly: false, // WORKERFS provides full lazy access without loading into memory
        parsingTime,
        fileSize: file.size,
        efficiency: 'True lazy loading via WORKERFS - no data loaded into memory'
      };
    } else {
      // Legacy format conversion
      return {
        type: 'hdf5',
        name: 'root',
        path: '/',
        children: structure.children,
        format: `${fileType} (WORKERFS Lazy)`,
        isHeaderOnly: false, // WORKERFS provides full lazy access without loading into memory
        parsingTime,
        fileSize: file.size,
        efficiency: 'True lazy loading via WORKERFS - no data loaded into memory',
        metadata // Include the parsed metadata for use in data loading
      };
    }
    
  } catch (error) {
    console.error(`${fileType} instant parsing failed:`, error);
    
    // Fallback to legacy header parsing if worker approach fails
    console.log('Falling back to legacy header parsing...');
    return await parseHDF5StructureFromHeaderLegacy(file);
  }
}

// Convert h5wasm metadata to viewer structure format
function convertMetadataToStructure(metadata, fileType) {
  const structure = {
    children: []
  };
  
  // Create a dataset entry for the main hyperspectral data
  if (metadata.samples && metadata.lines && metadata.bands && metadata.datasetPath) {
    const mainDataset = {
      type: 'dataset',
      name: metadata.datasetPath.split('/').pop() || 'Reflectance_Data',
      path: metadata.datasetPath,
      shape: metadata.shape || [metadata.bands, metadata.lines, metadata.samples],
      size: metadata.samples * metadata.lines * metadata.bands,
      dtype: getDtypeFromDataType(metadata.dataType),
      estimatedSizeMB: (metadata.samples * metadata.lines * metadata.bands * getBytesFromDataType(metadata.dataType)) / (1024 * 1024),
      isReflectanceCandidate: true,
      attributes: [],
      metadata: metadata // Store full metadata for data loading
    };
    
    // Add attributes from metadata
    if (metadata.wavelengthValues) {
      mainDataset.attributes.push({
        name: 'wavelengths',
        value: `Array of ${metadata.wavelengthValues.length} wavelengths`,
        type: 'array'
      });
    }
    
    if (metadata.dataIgnoreValue !== null) {
      mainDataset.attributes.push({
        name: 'data_ignore_value',
        value: metadata.dataIgnoreValue,
        type: 'number'
      });
    }
    
    if (metadata.reflectanceScaleFactor !== null) {
      mainDataset.attributes.push({
        name: 'reflectance_scale_factor',
        value: metadata.reflectanceScaleFactor,
        type: 'number'
      });
    }
    
    // Create group structure based on dataset path
    const pathParts = metadata.datasetPath.split('/').filter(p => p);
    let currentLevel = structure;
    
    for (let i = 0; i < pathParts.length - 1; i++) {
      const partName = pathParts[i];
      let group = currentLevel.children.find(child => child.name === partName && child.type === 'group');
      
      if (!group) {
        group = {
          type: 'group',
          name: partName,
          path: '/' + pathParts.slice(0, i + 1).join('/'),
          children: []
        };
        currentLevel.children.push(group);
      }
      
      currentLevel = group;
    }
    
    // Add the main dataset to the appropriate group
    currentLevel.children.push(mainDataset);
    
    // Create wavelength dataset if available
    if (metadata.wavelengthValues) {
      const wavelengthDataset = {
        type: 'dataset',
        name: 'Wavelength',
        path: metadata.datasetPath.replace(/[^/]+$/, 'Wavelength'),
        shape: [metadata.wavelengthValues.length],
        size: metadata.wavelengthValues.length,
        dtype: 'float64',
        estimatedSizeMB: (metadata.wavelengthValues.length * 8) / (1024 * 1024),
        isWavelengthCandidate: true,
        attributes: [
          {
            name: 'units',
            value: metadata.wavelengthUnits || 'nm',
            type: 'string'
          }
        ]
      };
      
      // Add to the same parent as the main dataset
      currentLevel.children.push(wavelengthDataset);
    }
  }
  
  return structure;
}

// Get dtype string from HDF5 data type constant
function getDtypeFromDataType(dataType) {
  const typeMap = {
    12: 'uint16',
    11: 'uint32',
    10: 'uint8',
    8: 'int16',
    9: 'int32',
    7: 'int8',
    5: 'float32',
    6: 'float64'
  };
  return typeMap[dataType] || 'unknown';
}

// Get bytes per element from HDF5 data type constant
function getBytesFromDataType(dataType) {
  const bytesMap = {
    12: 2, // uint16
    11: 4, // uint32
    10: 1, // uint8
    8: 2,  // int16
    9: 4,  // int32
    7: 1,  // int8
    5: 4,  // float32
    6: 8   // float64
  };
  return bytesMap[dataType] || 4;
}

// Legacy header parsing as fallback
async function parseHDF5StructureFromHeaderLegacy(file) {
  const fileType = file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.netcdf') ? 'NetCDF4' : 'HDF5';
  console.log(`Starting ${fileType} legacy header parsing for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  
  // HDF5 file format constants
  const HDF5_SIGNATURE = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  const DEFAULT_HEADER_SIZE = 5 * 1024 * 1024; // 5MB should be enough for most structures
  const MAX_HEADER_SIZE = 100 * 1024 * 1024; // 100MB maximum header size
  
  const startTime = performance.now();
  
  try {
    // Determine header size based on file size - be more generous for structure parsing
    let headerSize = DEFAULT_HEADER_SIZE;
    const fileSizeMB = file.size / (1024 * 1024);
    
    if (fileSizeMB > 1000) {
      headerSize = Math.min(50 * 1024 * 1024, MAX_HEADER_SIZE); // 50MB for very large files
    } else if (fileSizeMB > 100) {
      headerSize = Math.min(25 * 1024 * 1024, MAX_HEADER_SIZE); // 25MB for large files
    } else if (fileSizeMB > 10) {
      headerSize = Math.min(10 * 1024 * 1024, MAX_HEADER_SIZE); // 10MB for medium files
    }
    
    headerSize = Math.min(headerSize, file.size);
    
    console.log(`Reading ${(headerSize / 1024 / 1024).toFixed(1)}MB header from ${fileSizeMB.toFixed(1)}MB file`);
    
    // Read only the header portion
    const headerSlice = file.slice(0, headerSize);
    const headerBuffer = await headerSlice.arrayBuffer();
    const headerView = new DataView(headerBuffer);
    
    // Verify HDF5 signature
    if (!verifyHDF5Signature(headerView, HDF5_SIGNATURE)) {
      throw new Error('Invalid HDF5 file signature');
    }
    
    // Parse the structure from header
    const structure = await parseHDF5HeaderStructure(headerView, file.name, file);
    
    const endTime = performance.now();
    const parsingTime = endTime - startTime;
    
    console.log(`${fileType} legacy header parsing completed in ${parsingTime.toFixed(2)}ms`);
    
    return {
      type: 'hdf5',
      name: 'root',
      path: '/',
      children: structure.children,
      format: `${fileType} (Legacy Header)`,
      isHeaderOnly: true,
      parsingTime,
      fileSize: file.size,
      headerSize: headerBuffer.byteLength,
      efficiency: `${((headerBuffer.byteLength / file.size) * 100).toFixed(3)}% of file read`
    };
    
  } catch (error) {
    console.error(`${fileType} legacy header parsing failed:`, error);
    throw new Error(`${fileType} legacy header parsing failed: ${error.message}`);
  }
}

// Verify HDF5 file signature
function verifyHDF5Signature(dataView, signature) {
  for (let i = 0; i < signature.length; i++) {
    if (dataView.getUint8(i) !== signature[i]) {
      return false;
    }
  }
  return true;
}

// Parse HDF5 structure from header data (kept for legacy fallback)
async function parseHDF5HeaderStructure(dataView, filename, file) {
  // Instead of creating mock data, let's try to read what's actually in the header
  // If that fails, we'll fall back to a more comprehensive approach
  
  const structure = {
    children: []
  };
  
  // Skip h5wasm header parsing since it doesn't work well with partial files
  // Instead, go straight to full file parsing when header parsing is needed
  console.log('Skipping h5wasm header parsing - will use full file parsing if needed');
  
  // If h5wasm parsing failed, try manual HDF5 header parsing
  try {
    console.log('Attempting manual HDF5 header parsing...');
    
    // Define HDF5_SIGNATURE for the manual parsing
    const HDF5_SIGNATURE = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    const manualStructure = await parseHDF5SuperblockAndStructure(dataView, HDF5_SIGNATURE);
    if (manualStructure && manualStructure.children.length > 0) {
      return manualStructure;
    }
  } catch (error) {
    console.warn('Manual HDF5 header parsing failed:', error.message);
    
    // Provide more context for common issues
    if (error.message.includes('Unsupported object header version')) {
      console.warn('This file may use a newer HDF5 format that requires full file parsing with h5wasm');
    } else if (error.message.includes('address') && error.message.includes('bounds')) {
      console.warn('The header size may be too small to contain the complete structure metadata');
    }
  }
  
  // If header parsing fails, try h5wasm with the header data we already have
  console.warn('Header-only parsing failed - trying h5wasm with header data');
  try {
    const headerStructure = await parseHDF5StructureFromHeaderData(dataView, filename, file);
    if (headerStructure && headerStructure.children && headerStructure.children.length > 0) {
      return headerStructure;
    }
  } catch (headerError) {
    console.warn('h5wasm header parsing failed:', headerError.message);
  }
  
  // If header parsing fails, try full file parsing with h5wasm as last resort
  console.warn('Falling back to full file parsing');
  try {
    const fullFileStructure = await parseHDF5StructureFromFullFile(file);
    if (fullFileStructure && fullFileStructure.children && fullFileStructure.children.length > 0) {
      return fullFileStructure;
    }
  } catch (fullFileError) {
    console.error('Full file parsing also failed:', fullFileError.message);
  }
  
  // If all parsing attempts fail, return empty structure with error
  console.error('Both header-only and full file parsing failed');
  throw new Error('Unable to parse HDF5 file structure - file may be corrupted or unsupported');
  
  return structure;
}


// Parse HDF5 structure from header data using h5wasm
async function parseHDF5StructureFromHeaderData(dataView, filename, file) {
  const fileType = file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.netcdf') ? 'NetCDF4' : 'HDF5';
  console.log(`Starting ${fileType} h5wasm header parsing using existing ${(dataView.byteLength / 1024 / 1024).toFixed(1)}MB header data`);
  const startTime = performance.now();
  
  try {
    // Convert the header DataView to Uint8Array
    const headerArray = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    console.log(`Using header data: ${headerArray.length} bytes`);
    
    // Initialize h5wasm
    const h5wasm = await import('h5wasm');
    await h5wasm.ready;
    console.log('h5wasm loaded successfully for header parsing');
    
    // Create a temporary file from the header data
    const tempFilename = `/tmp/header_${Date.now()}.h5`;
    h5wasm.FS.writeFile(tempFilename, headerArray);
    console.log(`Created temporary header file: ${tempFilename}`);
    
    try {
      const headerFile = new h5wasm.File(tempFilename, 'r');
      console.log('h5wasm File opened successfully from header data');
      
      // Extract structure from header file
      const headerStructure = await extractRealHDF5Structure(headerFile);
      console.log('Structure extracted from header data:', headerStructure);
      
      headerFile.close();
      
      // Clean up
      try {
        h5wasm.FS.unlink(tempFilename);
      } catch (e) {}
      
      const endTime = performance.now();
      const parsingTime = endTime - startTime;
      
      console.log(`${fileType} h5wasm header parsing completed in ${parsingTime.toFixed(2)}ms`);
      
      return {
        type: 'hdf5',
        name: 'root',
        path: '/',
        children: headerStructure.children,
        format: `${fileType} (h5wasm Header)`,
        isHeaderOnly: true,
        parsingTime,
        fileSize: file.size,
        headerSize: dataView.byteLength,
        efficiency: `${((dataView.byteLength / file.size) * 100).toFixed(3)}% of file read`
      };
      
    } catch (h5Error) {
      // Clean up
      try {
        h5wasm.FS.unlink(tempFilename);
      } catch (e) {}
      
      console.error(`${fileType} h5wasm header parsing failed:`, h5Error);
      throw new Error(`${fileType} h5wasm header parsing failed: ${h5Error.message}`);
    }
  } catch (error) {
    console.error(`${fileType} h5wasm header parsing failed:`, error);
    throw new Error(`${fileType} h5wasm header parsing failed: ${error.message}`);
  }
}

// Parse HDF5 structure from full file using h5wasm
async function parseHDF5StructureFromFullFile(file) {
  const fileType = file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.netcdf') ? 'NetCDF4' : 'HDF5';
  console.log(`Starting ${fileType} full file parsing for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  const startTime = performance.now();
  
  try {
    // Try @h5web/h5wasm first for optimal browser performance
    let useH5Web = true;
    let h5File;
    
    try {
      console.log('Trying @h5web/h5wasm H5WasmLocalFileProvider for efficient access...');
      const { H5WasmApi } = await import('@h5web/h5wasm');
      
      // Create H5WasmApi instance
      const api = new H5WasmApi();
      
      // Use the browser-optimized file opening
      const fileId = await api.openLocalFile(file);
      h5File = { api, fileId, isH5Web: true };
      
      console.log('H5WasmLocalFileProvider opened file successfully');
      
    } catch (h5webError) {
      console.warn('@h5web/h5wasm failed, trying traditional h5wasm:', h5webError.message);
      useH5Web = false;
      
      // Fallback to traditional h5wasm approach
      const h5wasm = await import('h5wasm');
      await h5wasm.ready;
      console.log('h5wasm loaded successfully for fallback');
      
      // Read the entire file into memory as last resort
      console.log('Reading full file into memory as fallback...');
      const fileBuffer = await file.arrayBuffer();
      const fileArray = new Uint8Array(fileBuffer);
      console.log(`File read successfully: ${fileArray.length} bytes`);
      
      // Create a temporary file from the full file data
      const tempFilename = `/tmp/fallback_${Date.now()}.h5`;
      h5wasm.FS.writeFile(tempFilename, fileArray);
      console.log(`Created temporary fallback file: ${tempFilename}`);
      
      h5File = new h5wasm.File(tempFilename, 'r');
      h5File.tempPath = tempFilename;
      h5File.h5wasm = h5wasm;
      h5File.isH5Web = false;
    }
    
    try {
      let realStructure;
      
      if (useH5Web) {
        // Use H5Web API for structure extraction
        console.log('Extracting structure using H5WasmApi...');
        realStructure = await extractH5WebStructure(h5File.api, h5File.fileId);
      } else {
        // Use traditional h5wasm structure extraction
        console.log('Extracting structure using traditional h5wasm...');
        realStructure = await extractRealHDF5Structure(h5File);
      }
      
      console.log('Structure extracted successfully:', realStructure);
      
      // Clean up
      if (useH5Web) {
        try {
          await h5File.api.closeFile(h5File.fileId);
          console.log('H5WasmApi file closed successfully');
        } catch (e) {
          console.warn('Failed to close H5WasmApi file:', e.message);
        }
      } else {
        h5File.close();
        if (h5File.tempPath) {
          try {
            h5File.h5wasm.FS.unlink(h5File.tempPath);
          } catch (e) {}
        }
      }
      
      const endTime = performance.now();
      const parsingTime = endTime - startTime;
      
      console.log(`${fileType} parsing completed in ${parsingTime.toFixed(2)}ms using ${useH5Web ? 'H5WasmApi' : 'fallback'}`);
      
      return {
        type: 'hdf5',
        name: 'root',
        path: '/',
        children: realStructure.children,
        format: `${fileType} (${useH5Web ? 'H5WasmApi' : 'Full File'})`,
        isHeaderOnly: useH5Web, // H5WasmApi provides efficient access
        parsingTime,
        fileSize: file.size,
        efficiency: useH5Web ? 'Efficient access via H5WasmApi' : '100% of file read'
      };
      
    } catch (h5Error) {
      // Clean up
      if (useH5Web && h5File?.fileId) {
        try {
          await h5File.api.closeFile(h5File.fileId);
        } catch (e) {}
      } else if (!useH5Web && h5File) {
        h5File.close();
        if (h5File.tempPath) {
          try {
            h5File.h5wasm.FS.unlink(h5File.tempPath);
          } catch (e) {}
        }
      }
      
      console.error(`${fileType} parsing failed:`, h5Error);
      throw new Error(`${fileType} parsing failed: ${h5Error.message}`);
    }
  } catch (error) {
    console.error(`${fileType} full file parsing failed:`, error);
    throw new Error(`${fileType} full file parsing failed: ${error.message}`);
  }
}

// Manual HDF5 header parsing based on HDF5 specification
async function parseHDF5SuperblockAndStructure(dataView, HDF5_SIGNATURE) {
  console.log('Attempting manual HDF5 header parsing');
  
  // Find HDF5 signature (superblock) - can be at 0, 512, 1024, 2048, etc.
  let superblockOffset = 0;
  let signatureFound = findHDF5Signature(dataView, superblockOffset, HDF5_SIGNATURE);
  
  if (!signatureFound.found) {
    // Try other possible locations
    for (let offset = 512; offset < dataView.byteLength; offset *= 2) {
      const sig = findHDF5Signature(dataView, offset, HDF5_SIGNATURE);
      if (sig.found) {
        superblockOffset = offset;
        signatureFound = sig;
        break;
      }
    }
    if (!signatureFound.found) {
      throw new Error('HDF5 signature not found in header');
    }
  }
  
  // Parse superblock
  const superblock = parseSuperblock(dataView, superblockOffset);
  console.log('Superblock parsed:', superblock);
  
  // Parse root group object header
  let rootGroupHeader;
  try {
    // Check if root group address is valid
    if (superblock.rootGroupAddress === 0) {
      console.warn('Root group address is 0, trying to find actual root group address...');
      
      // The root group address might be at a slightly different offset
      // Let's scan the nearby bytes for a reasonable address
      const originalPos = superblockOffset + calculateSuperblockSize(superblock) - superblock.sizeOfOffsets;
      
      for (let searchOffset = originalPos; searchOffset < originalPos + 32; searchOffset += superblock.sizeOfOffsets) {
        if (searchOffset + superblock.sizeOfOffsets <= dataView.byteLength) {
          const candidateAddress = readAddress(dataView, searchOffset, superblock.sizeOfOffsets);
          if (candidateAddress && candidateAddress !== 0 && candidateAddress !== null && candidateAddress < dataView.byteLength) {
            console.log(`Found potential root group address 0x${candidateAddress.toString(16)} at offset ${searchOffset}`);
            superblock.rootGroupAddress = candidateAddress;
            break;
          }
        }
      }
      
      if (superblock.rootGroupAddress === 0) {
        throw new Error('Root group address is 0, which points to the file signature. This indicates a superblock parsing error.');
      }
    }
    
    if (superblock.rootGroupAddress === null) {
      console.warn('Root group address is undefined, trying to locate root group after superblock...');
      
      // Try to find the root group by scanning after the superblock
      const superblockEnd = superblockOffset + calculateSuperblockSize(superblock);
      const candidateAddress = findNextObjectHeader(dataView, superblockEnd);
      
      if (candidateAddress !== null) {
        console.log(`Found potential root group at address 0x${candidateAddress.toString(16)}`);
        superblock.rootGroupAddress = candidateAddress;
      } else {
        throw new Error('Root group address is undefined and could not locate root group. This indicates the file structure is not as expected.');
      }
    }
    
    if (superblock.rootGroupAddress >= dataView.byteLength) {
      throw new Error(`Root group address (0x${superblock.rootGroupAddress.toString(16)}) is beyond the available data (${dataView.byteLength} bytes).`);
    }
    
    rootGroupHeader = parseObjectHeader(dataView, superblock.rootGroupAddress, superblock);
    console.log('Root group header parsed:', rootGroupHeader);
  } catch (headerError) {
    console.warn('Failed to parse root group object header:', headerError.message);
    console.warn(`Root group address: 0x${superblock.rootGroupAddress.toString(16)}, data view length: ${dataView.byteLength}`);
    
    // If we can't parse the root group header, we can't build the structure
    // But let's still try to return some basic information about the file
    throw new Error(`Cannot parse HDF5 root group header: ${headerError.message}. The file may use a newer HDF5 format or have structural issues.`);
  }
  
  // Build structure from root group
  const structure = {
    children: []
  };
  
  if (rootGroupHeader.linkInfoMessage) {
    const links = parseGroupLinks(dataView, rootGroupHeader.linkInfoMessage, superblock);
    structure.children = await buildStructureFromLinks(dataView, links, superblock);
  }
  
  // If no children found from root group, try scanning for more object headers
  if (structure.children.length === 0) {
    console.log('No children found via link parsing, scanning for additional object headers...');
    
    // Scan for more object headers in the header data
    const additionalHeaders = scanForObjectHeaders(dataView, 122, Math.min(dataView.byteLength, 2048));
    console.log(`Found ${additionalHeaders.length} additional object headers`);
    
    for (const headerInfo of additionalHeaders) {
      try {
        const objectHeader = parseObjectHeader(dataView, headerInfo.address, superblock);
        console.log(`Additional object header at 0x${headerInfo.address.toString(16)}:`, objectHeader);
        
        // Look for link info or symbol table messages
        const linkInfoMsg = objectHeader.messages.find(m => m.type === 0x02); // Link info
        const symbolTableMsg = objectHeader.messages.find(m => m.type === 0x11); // Symbol table
        
        if (linkInfoMsg || symbolTableMsg) {
          console.log('Found object header with link/symbol table info');
          // This might contain the actual structure - for now, create a basic entry
          structure.children.push({
            type: 'group',
            name: `group_at_0x${headerInfo.address.toString(16)}`,
            path: `/group_at_0x${headerInfo.address.toString(16)}`,
            children: []
          });
        }
      } catch (error) {
        console.warn(`Failed to parse object header at 0x${headerInfo.address.toString(16)}:`, error.message);
      }
    }
  }
  
  return structure;
}

// Find HDF5 signature in the data
function findHDF5Signature(dataView, offset, signature) {
  if (offset + signature.length > dataView.byteLength) {
    return { found: false };
  }
  
  for (let i = 0; i < signature.length; i++) {
    if (dataView.getUint8(offset + i) !== signature[i]) {
      return { found: false };
    }
  }
  
  return { found: true, offset };
}

// Parse HDF5 superblock
function parseSuperblock(dataView, offset) {
  const HDF5_SIGNATURE_LENGTH = 8; // Standard HDF5 signature is 8 bytes
  let pos = offset + HDF5_SIGNATURE_LENGTH;
  
  // Version of superblock
  const version = dataView.getUint8(pos);
  pos += 1;
  
  console.log(`Parsing superblock version ${version} at offset ${offset}`);
  
  if (version === 0 || version === 1) {
    // Version 0/1 superblock
    const freeSpaceVersion = dataView.getUint8(pos);
    pos += 1;
    const rootGroupVersion = dataView.getUint8(pos);
    pos += 1;
    pos += 1; // Reserved
    const sharedHeaderVersion = dataView.getUint8(pos);
    pos += 1;
    
    const sizeOfOffsets = dataView.getUint8(pos);
    pos += 1;
    const sizeOfLengths = dataView.getUint8(pos);
    pos += 1;
    
    pos += 1; // Reserved
    
    const groupLeafNodeK = dataView.getUint16(pos, true);
    pos += 2;
    const groupInternalNodeK = dataView.getUint16(pos, true);
    pos += 2;
    
    // File consistency flags (4 bytes)  
    const fileConsistencyFlags = dataView.getUint32(pos, true);
    pos += 4;
    console.log(`File consistency flags: 0x${fileConsistencyFlags.toString(16)} at position ${pos-4}`);
    
    if (version === 1) {
      pos += 2; // Indexed storage internal node K
      pos += 2; // Reserved
    }
    
    console.log(`About to read addresses at position ${pos}, sizeOfOffsets=${sizeOfOffsets}`);
    
    // Base address and addresses
    const baseAddress = readAddress(dataView, pos, sizeOfOffsets);
    console.log(`Base address: ${baseAddress === null ? 'null (undefined)' : '0x' + baseAddress.toString(16)} read from position ${pos}`);
    pos += sizeOfOffsets;
    
    const freespaceInfoAddress = readAddress(dataView, pos, sizeOfOffsets);
    console.log(`Freespace info address: ${freespaceInfoAddress === null ? 'null (undefined)' : '0x' + freespaceInfoAddress.toString(16)} read from position ${pos}`);
    pos += sizeOfOffsets;
    
    const endOfFileAddress = readAddress(dataView, pos, sizeOfOffsets);
    console.log(`End of file address: ${endOfFileAddress === null ? 'null (undefined)' : '0x' + endOfFileAddress.toString(16)} read from position ${pos}`);
    pos += sizeOfOffsets;
    
    const driverInfoAddress = readAddress(dataView, pos, sizeOfOffsets);
    console.log(`Driver info address: ${driverInfoAddress === null ? 'null (undefined)' : '0x' + driverInfoAddress.toString(16)} read from position ${pos}`);
    pos += sizeOfOffsets;
    
    const rootGroupAddress = readAddress(dataView, pos, sizeOfOffsets);
    console.log(`Root group address: ${rootGroupAddress === null ? 'null (undefined)' : '0x' + rootGroupAddress.toString(16)} read from position ${pos}`);
    
    console.log(`Parsed addresses: base=${baseAddress === null ? 'null' : '0x' + baseAddress.toString(16)}, root=${rootGroupAddress === null ? 'null' : '0x' + rootGroupAddress.toString(16)}`);
    
    // Validate that root group address is reasonable
    if (rootGroupAddress === 0 || rootGroupAddress === null) {
      console.warn(`Root group address is ${rootGroupAddress === null ? 'null (undefined)' : '0'}, which ${rootGroupAddress === 0 ? 'points to the file signature' : 'is undefined'}. This suggests a parsing error.`);
      console.warn(`Superblock parsing details: version=${version}, pos=${pos}, sizeOfOffsets=${sizeOfOffsets}`);
      
      // Let's examine what we're actually reading
      const debugBytes = [];
      for (let i = Math.max(0, pos - 10); i < Math.min(dataView.byteLength, pos + 10); i++) {
        debugBytes.push(`[${i}]: 0x${dataView.getUint8(i).toString(16).padStart(2, '0')}`);
      }
      console.warn('Bytes around root group address position:', debugBytes);
    }
    
    return {
      version,
      sizeOfOffsets,
      sizeOfLengths,
      baseAddress,
      freespaceInfoAddress,
      endOfFileAddress,
      driverInfoAddress,
      rootGroupAddress
    };
  } else if (version === 2 || version === 3) {
    // Version 2/3 superblock
    const sizeOfOffsets = dataView.getUint8(pos);
    pos += 1;
    const sizeOfLengths = dataView.getUint8(pos);
    pos += 1;
    
    pos += 1; // File consistency flags
    
    const baseAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const superblockExtAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const endOfFileAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const rootGroupAddress = readAddress(dataView, pos, sizeOfOffsets);
    
    return {
      version,
      sizeOfOffsets,
      sizeOfLengths,
      baseAddress,
      superblockExtAddress,
      endOfFileAddress,
      rootGroupAddress
    };
  } else {
    throw new Error(`Unsupported superblock version: ${version}`);
  }
}

// Calculate the size of a superblock
function calculateSuperblockSize(superblock) {
  // HDF5 superblock sizes vary by version
  if (superblock.version === 0 || superblock.version === 1) {
    // Version 0/1: signature(8) + version(1) + free_space_version(1) + root_group_version(1) + reserved(1) + 
    // shared_header_version(1) + size_of_offsets(1) + size_of_lengths(1) + reserved(1) + 
    // group_leaf_node_k(2) + group_internal_node_k(2) + file_consistency_flags(4) + 
    // [indexed_storage_internal_node_k(2) + reserved(2) for version 1] +
    // base_address + freespace_info_address + end_of_file_address + driver_info_address + root_group_address
    let size = 8 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 2 + 2 + 4;
    if (superblock.version === 1) {
      size += 2 + 2; // indexed storage internal node K + reserved
    }
    size += 5 * superblock.sizeOfOffsets; // 5 addresses
    return size;
  } else if (superblock.version === 2 || superblock.version === 3) {
    // Version 2/3: signature(8) + version(1) + size_of_offsets(1) + size_of_lengths(1) + 
    // file_consistency_flags(1) + base_address + superblock_extension_address + 
    // end_of_file_address + root_group_address + checksum(4)
    return 8 + 1 + 1 + 1 + 1 + 4 * superblock.sizeOfOffsets + 4;
  }
  return 64; // Default fallback
}

// Scan for multiple object headers in a range
function scanForObjectHeaders(dataView, startOffset, endOffset) {
  const headers = [];
  
  // Look for valid object header version bytes (1 or 2) followed by reasonable data
  for (let offset = startOffset; offset < Math.min(endOffset, dataView.byteLength - 16); offset += 8) {
    const version = dataView.getUint8(offset);
    if (version === 1 || version === 2) {
      // For version 1, check if the next bytes look reasonable
      if (version === 1 && offset + 16 < dataView.byteLength) {
        const reserved = dataView.getUint8(offset + 1);
        const headerSize = dataView.getUint16(offset + 2, true);
        const totalMessages = dataView.getUint16(offset + 4, true);
        
        // Basic sanity checks
        if (reserved === 0 && headerSize > 0 && headerSize < 65536 && totalMessages > 0 && totalMessages < 1000) {
          headers.push({
            address: offset,
            version: version,
            headerSize: headerSize,
            totalMessages: totalMessages
          });
        }
      }
    }
  }
  
  return headers;
}

// Find the next object header by scanning for valid version bytes
function findNextObjectHeader(dataView, startOffset) {
  // Look for valid object header version bytes (1 or 2) followed by reasonable data
  for (let offset = startOffset; offset < Math.min(startOffset + 1024, dataView.byteLength - 16); offset += 8) {
    const version = dataView.getUint8(offset);
    if (version === 1 || version === 2) {
      // For version 1, check if the next bytes look reasonable
      if (version === 1 && offset + 16 < dataView.byteLength) {
        const reserved = dataView.getUint8(offset + 1);
        const headerSize = dataView.getUint16(offset + 2, true);
        const totalMessages = dataView.getUint16(offset + 4, true);
        
        // Basic sanity checks
        if (reserved === 0 && headerSize > 0 && headerSize < 65536 && totalMessages > 0 && totalMessages < 1000) {
          return offset;
        }
      }
    }
  }
  return null;
}

// Read address based on size
function readAddress(dataView, offset, size) {
  if (size === 4) {
    const addr = dataView.getUint32(offset, true); // little endian
    // Check for undefined address (all 1s)
    if (addr === 0xFFFFFFFF) {
      return null; // Undefined address
    }
    return addr;
  } else if (size === 8) {
    // Read as two 32-bit values for 64-bit address
    const low = dataView.getUint32(offset, true);
    const high = dataView.getUint32(offset + 4, true);
    
    // Check for undefined address (all 1s)
    if (low === 0xFFFFFFFF && high === 0xFFFFFFFF) {
      return null; // Undefined address
    }
    
    return (high * 0x100000000) + low;
  }
  throw new Error(`Unsupported address size: ${size}`);
}

// Parse object header
function parseObjectHeader(dataView, address, superblock) {
  let pos = address;
  
  // Check if we have enough bytes to read
  if (pos >= dataView.byteLength) {
    throw new Error(`Object header address ${address} is beyond data view bounds`);
  }
  
  // Object header version
  const version = dataView.getUint8(pos);
  pos += 1;
  
  // Check for valid object header versions
  // Valid versions are typically 1 and 2, but let's be more permissive with error handling
  if (version === 1) {
    console.log(`Parsing object header version 1 at address ${address}`);
    
    const reserved = dataView.getUint8(pos);
    pos += 1; // Reserved
    console.log(`Reserved byte: ${reserved}`);
    
    const headerSize = dataView.getUint16(pos, true);
    pos += 2;
    console.log(`Header size: ${headerSize}`);
    
    const totalMessages = dataView.getUint16(pos, true);
    pos += 2;
    console.log(`Total messages: ${totalMessages}`);
    
    const objectReferenceCount = dataView.getUint32(pos, true);
    pos += 4;
    console.log(`Object reference count: ${objectReferenceCount}`);
    
    const objectHeaderSize = dataView.getUint32(pos, true);
    pos += 4;
    console.log(`Object header size: ${objectHeaderSize}`);
    
    const reserved2 = dataView.getUint32(pos, true);
    pos += 4; // Reserved
    console.log(`Reserved2: ${reserved2}`);
    
    // Sanity check the values
    if (headerSize > 65536 || totalMessages > 100 || objectReferenceCount > 1000000) {
      console.warn(`Suspicious object header values - this might not be a valid object header`);
      console.warn(`headerSize=${headerSize}, totalMessages=${totalMessages}, objectReferenceCount=${objectReferenceCount}`);
    }
    
    console.log(`Parsing ${totalMessages} messages starting at position ${pos}`);
    
    // Parse messages
    const messages = [];
    for (let i = 0; i < totalMessages; i++) {
      console.log(`Parsing message ${i + 1}/${totalMessages} at position ${pos}`);
      
      if (pos + 8 > dataView.byteLength) {
        console.warn(`Not enough bytes to read message ${i + 1} header at position ${pos}`);
        break;
      }
      
      const messageType = dataView.getUint16(pos, true);
      pos += 2;
      
      const messageSize = dataView.getUint16(pos, true);
      pos += 2;
      
      const messageFlags = dataView.getUint8(pos);
      pos += 1;
      
      pos += 3; // Reserved
      
      console.log(`Message ${i + 1}: type=${messageType}, size=${messageSize}, flags=${messageFlags}`);
      
      if (pos + messageSize > dataView.byteLength) {
        console.warn(`Not enough bytes to read message ${i + 1} data at position ${pos}, size=${messageSize}`);
        break;
      }
      
      const messageData = new Uint8Array(dataView.buffer, pos, messageSize);
      messages.push({
        type: messageType,
        size: messageSize,
        flags: messageFlags,
        data: messageData
      });
      
      pos += messageSize;
      console.log(`Message ${i + 1} parsed, next position: ${pos}`);
    }
    
    return {
      version,
      headerSize,
      totalMessages,
      objectReferenceCount,
      objectHeaderSize,
      messages,
      linkInfoMessage: messages.find(m => m.type === 0x02) // Link info message
    };
  } else if (version === 2) {
    // Version 2 object header - more complex, implement if needed
    throw new Error('Object header version 2 not yet implemented');
  } else {
    // For unsupported versions, provide more context and fail gracefully
    console.warn(`Encountered unsupported object header version: ${version} (0x${version.toString(16)}) at address ${address}`);
    
    // Check if this might be a false positive by looking at surrounding bytes
    const context = [];
    for (let i = Math.max(0, pos - 5); i < Math.min(dataView.byteLength, pos + 10); i++) {
      context.push(`0x${dataView.getUint8(i).toString(16).padStart(2, '0')}`);
    }
    console.warn(`Context bytes around position ${pos}:`, context.join(' '));
    
    throw new Error(`Unsupported object header version: ${version} (0x${version.toString(16)}) at address ${address}. This may indicate a parsing error or file corruption.`);
  }
}

// Parse group links from symbol table or fractal heap
function parseGroupLinks(dataView, linkInfoMessage, superblock) {
  const links = [];
  
  if (!linkInfoMessage || !linkInfoMessage.data) {
    return links;
  }
  
  // This is a simplified parsing of link info message
  // In reality, this would need to parse the fractal heap or symbol table
  // For now, we'll return empty array but log that we found the message
  console.log('Found link info message, but detailed parsing not yet implemented');
  
  return links;
}

// Build structure from parsed links
async function buildStructureFromLinks(dataView, links, superblock) {
  const children = [];
  
  for (const link of links) {
    try {
      // Parse the object header at the link's address to determine type
      const objectHeader = parseObjectHeader(dataView, link.address, superblock);
      
      // Determine if it's a group or dataset based on messages
      const isGroup = objectHeader.messages.some(m => m.type === 0x02); // Link info message
      const isDataset = objectHeader.messages.some(m => m.type === 0x03); // Dataspace message
      
      const child = {
        type: isGroup ? 'group' : (isDataset ? 'dataset' : 'unknown'),
        name: link.name,
        path: link.path,
        children: []
      };
      
      // If it's a dataset, try to extract shape and type info
      if (isDataset) {
        const dataspaceMsg = objectHeader.messages.find(m => m.type === 0x03);
        const datatypeMsg = objectHeader.messages.find(m => m.type === 0x04);
        
        if (dataspaceMsg) {
          // Parse dataspace message for shape
          const shape = parseDataspaceMessage(dataspaceMsg.data);
          child.shape = shape;
          child.size = shape.reduce((a, b) => a * b, 1);
        }
        
        if (datatypeMsg) {
          // Parse datatype message for dtype
          const dtype = parseDatatypeMessage(datatypeMsg.data);
          child.dtype = dtype;
        }
      }
      
      // If it's a group, recursively parse its children
      if (isGroup && objectHeader.linkInfoMessage) {
        const childLinks = parseGroupLinks(dataView, objectHeader.linkInfoMessage, superblock);
        child.children = await buildStructureFromLinks(dataView, childLinks, superblock);
      }
      
      children.push(child);
    } catch (error) {
      console.warn(`Failed to parse link ${link.name}:`, error);
    }
  }
  
  return children;
}

// Parse dataspace message to extract shape
function parseDataspaceMessage(data) {
  if (data.length < 2) return [1];
  
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = dataView.getUint8(0);
  const dimensionality = dataView.getUint8(1);
  
  if (dimensionality === 0) return [1]; // scalar
  
  const shape = [];
  let pos = 4; // Skip version, dimensionality, and flags
  
  for (let i = 0; i < dimensionality; i++) {
    // Read dimension size (assuming 8 bytes each)
    const size = dataView.getUint32(pos, true) + (dataView.getUint32(pos + 4, true) * 0x100000000);
    shape.push(size);
    pos += 8;
  }
  
  return shape;
}

// Parse datatype message to extract dtype
function parseDatatypeMessage(data) {
  if (data.length < 4) return 'unknown';
  
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const classAndVersion = dataView.getUint8(0);
  const typeClass = classAndVersion & 0x0F;
  
  // Map HDF5 type classes to common names
  const typeMap = {
    0: 'int8',
    1: 'float32',
    2: 'time',
    3: 'string',
    4: 'bitfield',
    5: 'opaque',
    6: 'compound',
    7: 'reference',
    8: 'enum',
    9: 'variable_length',
    10: 'array'
  };
  
  return typeMap[typeClass] || 'unknown';
}

// Extract HDF5 structure using H5WasmApi (browser-optimized)
async function extractH5WebStructure(api, fileId) {
  const structure = {
    children: []
  };
  
  try {
    // Get root level entities
    const rootEntities = await api.getChildrenNames(fileId, '/');
    console.log(`Found ${rootEntities.length} root level items using H5WasmApi`);
    
    // Process each root level entity
    for (const entityName of rootEntities) {
      try {
        const entityPath = `/${entityName}`;
        const entityType = await api.getEntityType(fileId, entityPath);
        
        let childStructure;
        if (entityType === 'Group') {
          childStructure = await processH5WebGroup(api, fileId, entityName, entityPath);
        } else if (entityType === 'Dataset') {
          childStructure = await processH5WebDataset(api, fileId, entityName, entityPath);
        } else {
          childStructure = {
            type: 'unknown',
            name: entityName,
            path: entityPath,
            entityType: entityType
          };
        }
        
        structure.children.push(childStructure);
      } catch (error) {
        console.warn(`Could not process H5Web entity ${entityName}:`, error);
        structure.children.push({
          type: 'error',
          name: entityName,
          path: `/${entityName}`,
          error: error.message
        });
      }
    }
  } catch (error) {
    console.error('Error extracting H5Web structure:', error);
    throw error;
  }
  
  return structure;
}

// Process H5Web group
async function processH5WebGroup(api, fileId, name, path) {
  const groupStructure = {
    type: 'group',
    name,
    path,
    children: []
  };

  try {
    const childNames = await api.getChildrenNames(fileId, path);
    console.log(`Group ${path} has ${childNames.length} children (H5WasmApi)`);
    
    for (const childName of childNames) {
      try {
        const childPath = `${path}/${childName}`;
        const childType = await api.getEntityType(fileId, childPath);
        
        let childStructure;
        if (childType === 'Group') {
          childStructure = await processH5WebGroup(api, fileId, childName, childPath);
        } else if (childType === 'Dataset') {
          childStructure = await processH5WebDataset(api, fileId, childName, childPath);
        } else {
          childStructure = {
            type: 'unknown',
            name: childName,
            path: childPath,
            entityType: childType
          };
        }
        
        groupStructure.children.push(childStructure);
      } catch (error) {
        console.warn(`Could not process H5Web child ${childName} in ${path}:`, error);
        groupStructure.children.push({
          type: 'error',
          name: childName,
          path: `${path}/${childName}`,
          error: error.message
        });
      }
    }
  } catch (error) {
    console.error(`Error processing H5Web group ${path}:`, error);
    groupStructure.error = error.message;
  }

  return groupStructure;
}

// Process H5Web dataset
async function processH5WebDataset(api, fileId, name, path) {
  const datasetStructure = {
    type: 'dataset',
    name,
    path,
    shape: [],
    size: 0,
    dtype: 'unknown',
    attributes: [],
    compressed: false,
    metadata: {}
  };

  try {
    // Get dataset metadata
    const metadata = await api.getDatasetMetadata(fileId, path);
    
    if (metadata.shape) {
      datasetStructure.shape = metadata.shape;
      datasetStructure.size = metadata.shape.reduce((a, b) => a * b, 1);
    }
    
    if (metadata.dtype) {
      datasetStructure.dtype = metadata.dtype;
    }
    
    // Calculate estimated memory usage
    if (datasetStructure.shape.length > 0) {
      const totalElements = datasetStructure.shape.reduce((a, b) => a * b, 1);
      datasetStructure.estimatedSizeMB = (totalElements * getBytesPerElement(datasetStructure.dtype)) / (1024 * 1024);
    }

    // Determine data type candidates
    datasetStructure.isWavelengthCandidate = isWavelengthCandidate(datasetStructure);
    datasetStructure.isReflectanceCandidate = isReflectanceCandidate(datasetStructure);

    console.log(`Dataset ${path}: ${datasetStructure.shape} ${datasetStructure.dtype} (${datasetStructure.estimatedSizeMB?.toFixed(1)}MB estimated) - H5WasmApi`);

  } catch (error) {
    console.warn(`Error processing H5Web dataset metadata ${path}:`, error);
    datasetStructure.error = error.message;
  }

  return datasetStructure;
}

// Extract actual HDF5 structure from h5wasm file handle using metadata-only approach
async function extractRealHDF5Structure(h5File) {
  const structure = {
    children: []
  };
  
  try {
    // Get root level keys - this reads structure without loading data
    const rootKeys = h5File.keys();
    console.log(`Found ${rootKeys.length} root level items using metadata-only parsing`);
    
    // Process each root level item using metadata-only approach
    for (const key of rootKeys) {
      try {
        const item = h5File.get(key);
        // Use efficient metadata-only processing
        const childStructure = processHDF5ItemMetadataOnly(item, key, `/${key}`);
        structure.children.push(childStructure);
      } catch (error) {
        console.warn(`Could not process HDF5 item ${key}:`, error);
        // Add as unknown item
        structure.children.push({
          type: 'unknown',
          name: key,
          path: `/${key}`,
          error: error.message
        });
      }
    }
  } catch (error) {
    console.error('Error extracting real HDF5 structure:', error);
    throw error;
  }
  
  return structure;
}

// Process individual HDF5 item using metadata-only approach (NEVER calls .value)
function processHDF5ItemMetadataOnly(item, name, path) {
  try {
    // Check if it's a group (has keys method)
    if (typeof item.keys === 'function') {
      return processHDF5GroupMetadataOnly(item, name, path);
    }
    
    // Check if it's a dataset (has shape, dtype, or metadata property - but NOT .value)
    if (item.shape !== undefined || item.dtype !== undefined || item.metadata !== undefined) {
      return processHDF5DatasetMetadataOnly(item, name, path);
    }
    
    // Unknown item type
    return {
      type: 'unknown',
      name,
      path,
      info: 'Unknown HDF5 item type'
    };
  } catch (error) {
    console.warn(`Error processing HDF5 item ${path}:`, error);
    return {
      type: 'error',
      name,
      path,
      error: error.message
    };
  }
}

// Legacy function for backward compatibility
function processHDF5Item(item, name, path) {
  return processHDF5ItemMetadataOnly(item, name, path);
}

// Process HDF5 group using metadata-only approach (directory-like structure)
function processHDF5GroupMetadataOnly(group, name, path) {
  const groupStructure = {
    type: 'group',
    name,
    path,
    children: []
  };

  try {
    // Use group.keys() to get structure without loading any data
    const keys = group.keys();
    console.log(`Group ${path} has ${keys.length} children (metadata-only)`);
    
    for (const key of keys) {
      try {
        const childItem = group.get(key);
        const childPath = `${path}/${key}`;
        // Recursively process children with metadata-only approach
        const childStructure = processHDF5ItemMetadataOnly(childItem, key, childPath);
        groupStructure.children.push(childStructure);
      } catch (error) {
        console.warn(`Could not process HDF5 child ${key} in ${path}:`, error);
        groupStructure.children.push({
          type: 'error',
          name: key,
          path: `${path}/${key}`,
          error: error.message
        });
      }
    }
  } catch (error) {
    console.error(`Error processing HDF5 group ${path}:`, error);
    groupStructure.error = error.message;
  }

  return groupStructure;
}

// Legacy function for backward compatibility
function processHDF5Group(group, name, path) {
  return processHDF5GroupMetadataOnly(group, name, path);
}

// Process HDF5 dataset using metadata-only approach (NEVER loads actual data)
function processHDF5DatasetMetadataOnly(dataset, name, path) {
  const datasetStructure = {
    type: 'dataset',
    name,
    path,
    shape: dataset.shape || [],
    size: dataset.size || (dataset.metadata?.total_size || 0),
    dtype: dataset.dtype || 'unknown',
    attributes: [],
    compressed: false,
    metadata: {} // Store additional metadata without loading data
  };

  try {
    // Extract comprehensive metadata without accessing .value
    if (dataset.metadata) {
      datasetStructure.metadata = {
        total_size: dataset.metadata.total_size,
        compression: dataset.metadata.compression,
        chunks: dataset.metadata.chunks,
        layout: dataset.metadata.layout
      };
      
      // Check if dataset is compressed
      datasetStructure.compressed = !!(dataset.metadata.compression && dataset.metadata.compression !== 'none');
    }

    // Extract attributes without loading dataset values
    if (dataset.attrs) {
      for (const [attrName, attrValue] of Object.entries(dataset.attrs)) {
        datasetStructure.attributes.push({
          name: attrName,
          value: attrValue,
          type: typeof attrValue
        });
      }
    }

    // Calculate estimated memory usage (for user awareness)
    if (datasetStructure.shape.length > 0) {
      const totalElements = datasetStructure.shape.reduce((a, b) => a * b, 1);
      datasetStructure.estimatedSizeMB = (totalElements * getBytesPerElement(datasetStructure.dtype)) / (1024 * 1024);
    }

    // Determine if this could be wavelength or reflectance data
    datasetStructure.isWavelengthCandidate = isWavelengthCandidate(datasetStructure);
    datasetStructure.isReflectanceCandidate = isReflectanceCandidate(datasetStructure);

    console.log(`Dataset ${path}: ${datasetStructure.shape} ${datasetStructure.dtype} (${datasetStructure.estimatedSizeMB?.toFixed(1)}MB estimated) - NO DATA LOADED`);

  } catch (error) {
    console.warn(`Error processing HDF5 dataset metadata ${path}:`, error);
    datasetStructure.error = error.message;
  }

  return datasetStructure;
}

// Legacy function for backward compatibility
function processHDF5Dataset(dataset, name, path) {
  return processHDF5DatasetMetadataOnly(dataset, name, path);
}

// Helper function to estimate bytes per element based on dtype
function getBytesPerElement(dtype) {
  if (!dtype || dtype === 'unknown') return 4; // Default estimate
  
  const dtypeString = dtype.toString().toLowerCase();
  
  if (dtypeString.includes('float64') || dtypeString.includes('f8')) return 8;
  if (dtypeString.includes('float32') || dtypeString.includes('f4')) return 4;
  if (dtypeString.includes('int64') || dtypeString.includes('i8')) return 8;
  if (dtypeString.includes('int32') || dtypeString.includes('i4')) return 4;
  if (dtypeString.includes('int16') || dtypeString.includes('i2')) return 2;
  if (dtypeString.includes('int8') || dtypeString.includes('i1')) return 1;
  if (dtypeString.includes('uint64') || dtypeString.includes('u8')) return 8;
  if (dtypeString.includes('uint32') || dtypeString.includes('u4')) return 4;
  if (dtypeString.includes('uint16') || dtypeString.includes('u2')) return 2;
  if (dtypeString.includes('uint8') || dtypeString.includes('u1')) return 1;
  
  return 4; // Default estimate for unknown types
}

// Check if a dataset could contain wavelength data
function isWavelengthCandidate(dataset) {
  const name = dataset.name.toLowerCase();
  const path = dataset.path.toLowerCase();
  const wavelengthKeywords = ['wavelength', 'wavelengths', 'wl', 'lambda', 'frequency', 'wavenumber', 'spectral'];
  
  // Check name and path
  if (wavelengthKeywords.some(keyword => name.includes(keyword) || path.includes(keyword))) {
    return true;
  }
  
  // Check attributes
  if (dataset.attributes) {
    const hasWavelengthAttribute = dataset.attributes.some(attr => 
      wavelengthKeywords.some(keyword => 
        attr.name.toLowerCase().includes(keyword) || 
        (typeof attr.value === 'string' && attr.value.toLowerCase().includes(keyword))
      )
    );
    if (hasWavelengthAttribute) return true;
  }
  
  // Check if it's 1D and has reasonable size for wavelength data
  if (dataset.shape && dataset.shape.length === 1 && dataset.size > 10 && dataset.size < 10000) {
    return true;
  }
  
  return false;
}

// Check if a dataset could contain reflectance/radiance data
function isReflectanceCandidate(dataset) {
  const name = dataset.name.toLowerCase();
  const path = dataset.path.toLowerCase();
  const reflectanceKeywords = ['reflectance', 'radiance', 'data', 'cube', 'image', 'spectral', 'hyperspectral'];
  
  // Check name and path
  if (reflectanceKeywords.some(keyword => name.includes(keyword) || path.includes(keyword))) {
    return true;
  }
  
  // Check attributes
  if (dataset.attributes) {
    const hasReflectanceAttribute = dataset.attributes.some(attr => 
      reflectanceKeywords.some(keyword => 
        attr.name.toLowerCase().includes(keyword) || 
        (typeof attr.value === 'string' && attr.value.toLowerCase().includes(keyword))
      )
    );
    if (hasReflectanceAttribute) return true;
  }
  
  // Check if it's 3D (likely hyperspectral cube)
  if (dataset.shape && dataset.shape.length === 3 && dataset.size > 1000) {
    return true;
  }
  
  return false;
}

// Enhanced header parser that could be extended to read actual HDF5 metadata
export async function parseHDF5HeaderWithFallback(file) {
  try {
    // First try header-only parsing
    return await parseHDF5StructureFromHeader(file);
  } catch (headerError) {
    console.warn('Header-only parsing failed, trying progressive approach:', headerError.message);
    
    // Fallback to progressive header reading with larger chunks
    const progressiveSizes = [
      5 * 1024 * 1024,   // 5MB
      10 * 1024 * 1024,  // 10MB
      25 * 1024 * 1024,  // 25MB
      50 * 1024 * 1024,  // 50MB
      100 * 1024 * 1024, // 100MB
    ];
    
    for (const size of progressiveSizes) {
      if (size >= file.size) break;
      
      try {
        console.log(`Trying ${(size / 1024 / 1024).toFixed(1)}MB header size...`);
        
        const headerSlice = file.slice(0, size);
        const headerBuffer = await headerSlice.arrayBuffer();
        const headerView = new DataView(headerBuffer);
        
        if (verifyHDF5Signature(headerView)) {
          const structure = await parseHDF5HeaderStructure(headerView, file.name);
          
          return {
            type: 'hdf5',
            name: 'root',
            path: '/',
            children: structure.children,
            format: 'HDF5 (Progressive Header)',
            isHeaderOnly: true,
            headerSize: size,
            fileSize: file.size,
            efficiency: `${((size / file.size) * 100).toFixed(3)}% of file read`
          };
        }
      } catch (error) {
        console.warn(`${(size / 1024 / 1024).toFixed(1)}MB header failed:`, error.message);
        continue;
      }
    }
    
    throw new Error('All header parsing attempts failed');
  }
}

// Load specific dataset data on demand (for when user actually needs the data)
export async function loadHDF5DatasetOnDemand(file, datasetPath) {
  console.log(`Loading dataset on demand: ${datasetPath}`);
  const startTime = performance.now();
  
  try {
    // Read the entire file (could be optimized to read only needed chunks)
    console.log(`Reading file for on-demand dataset loading: ${datasetPath}`);
    const fileBuffer = await file.arrayBuffer();
    const fileArray = new Uint8Array(fileBuffer);
    
    // Initialize h5wasm
    const h5wasm = await import('h5wasm');
    await h5wasm.ready;
    
    // Create temporary file
    const tempFilename = `/tmp/ondemand_${Date.now()}.h5`;
    h5wasm.FS.writeFile(tempFilename, fileArray);
    
    try {
      const h5File = new h5wasm.File(tempFilename, 'r');
      
      // Navigate to the specific dataset
      const dataset = h5File.get(datasetPath);
      if (!dataset) {
        throw new Error(`Dataset not found: ${datasetPath}`);
      }
      
      // Now safely access .value to load the actual data
      const data = dataset.value;
      const metadata = {
        path: datasetPath,
        shape: dataset.shape,
        dtype: dataset.dtype,
        size: dataset.size,
        attributes: dataset.attrs || {},
        loadedOnDemand: true,
        loadTime: performance.now() - startTime
      };
      
      h5File.close();
      
      // Clean up
      try {
        h5wasm.FS.unlink(tempFilename);
      } catch (e) {}
      
      console.log(`On-demand loading completed for ${datasetPath} in ${metadata.loadTime.toFixed(2)}ms`);
      
      return {
        data,
        metadata
      };
      
    } catch (loadError) {
      // Clean up
      try {
        h5wasm.FS.unlink(tempFilename);
      } catch (e) {}
      
      throw new Error(`Failed to load dataset ${datasetPath}: ${loadError.message}`);
    }
  } catch (error) {
    console.error(`On-demand dataset loading failed for ${datasetPath}:`, error);
    throw new Error(`On-demand loading failed: ${error.message}`);
  }
}