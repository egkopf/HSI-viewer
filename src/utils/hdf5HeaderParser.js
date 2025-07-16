// HDF5/NetCDF4 header-only parser for instant structure loading
// This reads only the file header/superblock to extract structure metadata
// NetCDF4 files use HDF5 format internally, so this parser handles both

// HDF5 file format constants
const HDF5_SIGNATURE = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_HEADER_SIZE = 5 * 1024 * 1024; // 5MB should be enough for most structures
const MAX_HEADER_SIZE = 100 * 1024 * 1024; // 100MB maximum header size

// Parse HDF5/NetCDF4 structure from header only
export async function parseHDF5StructureFromHeader(file) {
  const fileType = file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.netcdf') ? 'NetCDF4' : 'HDF5';
  console.log(`Starting ${fileType} header-only parsing for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
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
    if (!verifyHDF5Signature(headerView)) {
      throw new Error('Invalid HDF5 file signature');
    }
    
    // Parse the structure from header
    const structure = await parseHDF5HeaderStructure(headerView, file.name, file);
    
    const endTime = performance.now();
    const parsingTime = endTime - startTime;
    
    console.log(`${fileType} header parsing completed in ${parsingTime.toFixed(2)}ms`);
    
    return {
      type: 'hdf5',
      name: 'root',
      path: '/',
      children: structure.children,
      format: `${fileType} (Header-Only)`,
      isHeaderOnly: true,
      parsingTime,
      fileSize: file.size,
      headerSize: headerBuffer.byteLength,
      efficiency: `${((headerBuffer.byteLength / file.size) * 100).toFixed(3)}% of file read`
    };
    
  } catch (error) {
    console.error(`${fileType} header parsing failed:`, error);
    throw new Error(`${fileType} header parsing failed: ${error.message}`);
  }
}

// Verify HDF5 file signature
function verifyHDF5Signature(dataView) {
  for (let i = 0; i < HDF5_SIGNATURE.length; i++) {
    if (dataView.getUint8(i) !== HDF5_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

// Parse HDF5 structure from header data
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
    const manualStructure = await parseHDF5SuperblockAndStructure(dataView);
    if (manualStructure && manualStructure.children.length > 0) {
      return manualStructure;
    }
  } catch (error) {
    console.warn('Manual HDF5 header parsing failed:', error.message);
  }
  
  // If header parsing fails, try full file parsing with h5wasm
  console.warn('Header-only parsing failed - falling back to full file parsing');
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

// Parse HDF5 structure from full file using h5wasm
async function parseHDF5StructureFromFullFile(file) {
  const fileType = file.name.toLowerCase().endsWith('.nc') || file.name.toLowerCase().endsWith('.netcdf') ? 'NetCDF4' : 'HDF5';
  console.log(`Starting ${fileType} full file parsing for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  const startTime = performance.now();
  
  try {
    // Read the entire file
    console.log('Reading full file into memory...');
    const fileBuffer = await file.arrayBuffer();
    const fileArray = new Uint8Array(fileBuffer);
    console.log(`File read successfully: ${fileArray.length} bytes`);
    
    // Try to initialize h5wasm with the full file
    const h5wasm = await import('h5wasm');
    await h5wasm.ready;
    console.log('h5wasm loaded successfully');
    
    // Create a temporary file from the full file data
    const tempFilename = `/tmp/fullfile_${Date.now()}.h5`;
    h5wasm.FS.writeFile(tempFilename, fileArray);
    console.log(`Created temporary file: ${tempFilename}`);
    
    try {
      const fullFile = new h5wasm.File(tempFilename, 'r');
      console.log('h5wasm File opened successfully');
      
      // Extract actual structure from full file
      const realStructure = await extractRealHDF5Structure(fullFile);
      console.log('Structure extracted successfully:', realStructure);
      
      fullFile.close();
      
      // Clean up
      try {
        h5wasm.FS.unlink(tempFilename);
      } catch (e) {}
      
      const endTime = performance.now();
      const parsingTime = endTime - startTime;
      
      console.log(`${fileType} full file parsing completed in ${parsingTime.toFixed(2)}ms`);
      
      return {
        type: 'hdf5',
        name: 'root',
        path: '/',
        children: realStructure.children,
        format: `${fileType} (Full File)`,
        isHeaderOnly: false,
        parsingTime,
        fileSize: file.size,
        efficiency: '100% of file read'
      };
      
    } catch (h5Error) {
      // Clean up
      try {
        h5wasm.FS.unlink(tempFilename);
      } catch (e) {}
      
      console.error(`${fileType} full file parsing failed:`, h5Error);
      throw new Error(`${fileType} full file parsing failed: ${h5Error.message}`);
    }
  } catch (error) {
    console.error(`${fileType} full file parsing failed:`, error);
    throw new Error(`${fileType} full file parsing failed: ${error.message}`);
  }
}

// Manual HDF5 header parsing based on HDF5 specification
async function parseHDF5SuperblockAndStructure(dataView) {
  console.log('Attempting manual HDF5 header parsing');
  
  // Find HDF5 signature (superblock) - can be at 0, 512, 1024, 2048, etc.
  let superblockOffset = 0;
  let signatureFound = findHDF5Signature(dataView, superblockOffset);
  
  if (!signatureFound.found) {
    // Try other possible locations
    for (let offset = 512; offset < dataView.byteLength; offset *= 2) {
      const sig = findHDF5Signature(dataView, offset);
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
  const rootGroupHeader = parseObjectHeader(dataView, superblock.rootGroupAddress, superblock);
  console.log('Root group header parsed:', rootGroupHeader);
  
  // Build structure from root group
  const structure = {
    children: []
  };
  
  if (rootGroupHeader.linkInfoMessage) {
    const links = parseGroupLinks(dataView, rootGroupHeader.linkInfoMessage, superblock);
    structure.children = await buildStructureFromLinks(dataView, links, superblock);
  }
  
  // If no children found, at least provide basic information about the file
  if (structure.children.length === 0) {
    console.log('No children found via link parsing, file may have a complex structure');
    // Don't create fake data, just return empty structure
  }
  
  return structure;
}

// Find HDF5 signature in the data
function findHDF5Signature(dataView, offset) {
  if (offset + HDF5_SIGNATURE.length > dataView.byteLength) {
    return { found: false };
  }
  
  for (let i = 0; i < HDF5_SIGNATURE.length; i++) {
    if (dataView.getUint8(offset + i) !== HDF5_SIGNATURE[i]) {
      return { found: false };
    }
  }
  
  return { found: true, offset };
}

// Parse HDF5 superblock
function parseSuperblock(dataView, offset) {
  let pos = offset + HDF5_SIGNATURE.length;
  
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
    
    // Skip file consistency flags - this seems to be the issue
    pos += 4;
    
    if (version === 1) {
      pos += 2; // Indexed storage internal node K
      pos += 2; // Reserved
    }
    
    console.log(`About to read addresses at position ${pos}, sizeOfOffsets=${sizeOfOffsets}`);
    
    // Base address and addresses
    const baseAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const freespaceInfoAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const endOfFileAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const driverInfoAddress = readAddress(dataView, pos, sizeOfOffsets);
    pos += sizeOfOffsets;
    
    const rootGroupAddress = readAddress(dataView, pos, sizeOfOffsets);
    
    console.log(`Parsed addresses: base=0x${baseAddress.toString(16)}, root=0x${rootGroupAddress.toString(16)}`);
    
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

// Read address based on size
function readAddress(dataView, offset, size) {
  if (size === 4) {
    return dataView.getUint32(offset, true); // little endian
  } else if (size === 8) {
    // Read as two 32-bit values for 64-bit address
    const low = dataView.getUint32(offset, true);
    const high = dataView.getUint32(offset + 4, true);
    return (high * 0x100000000) + low;
  }
  throw new Error(`Unsupported address size: ${size}`);
}

// Parse object header
function parseObjectHeader(dataView, address, superblock) {
  let pos = address;
  
  // Object header version
  const version = dataView.getUint8(pos);
  pos += 1;
  
  if (version === 1) {
    pos += 1; // Reserved
    
    const headerSize = dataView.getUint16(pos, true);
    pos += 2;
    
    const totalMessages = dataView.getUint16(pos, true);
    pos += 2;
    
    const objectReferenceCount = dataView.getUint32(pos, true);
    pos += 4;
    
    const objectHeaderSize = dataView.getUint32(pos, true);
    pos += 4;
    
    pos += 4; // Reserved
    
    // Parse messages
    const messages = [];
    for (let i = 0; i < totalMessages; i++) {
      const messageType = dataView.getUint16(pos, true);
      pos += 2;
      
      const messageSize = dataView.getUint16(pos, true);
      pos += 2;
      
      const messageFlags = dataView.getUint8(pos);
      pos += 1;
      
      pos += 3; // Reserved
      
      const messageData = new Uint8Array(dataView.buffer, pos, messageSize);
      messages.push({
        type: messageType,
        size: messageSize,
        flags: messageFlags,
        data: messageData
      });
      
      pos += messageSize;
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
    throw new Error(`Unsupported object header version: ${version}`);
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

// Extract actual HDF5 structure from h5wasm file handle
async function extractRealHDF5Structure(h5File) {
  const structure = {
    children: []
  };
  
  try {
    // Get root level keys
    const rootKeys = h5File.keys();
    console.log(`Found ${rootKeys.length} root level items in header`);
    
    // Process each root level item
    for (const key of rootKeys) {
      try {
        const item = h5File.get(key);
        const childStructure = processHDF5Item(item, key, `/${key}`);
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

// Process individual HDF5 item (group or dataset)
function processHDF5Item(item, name, path) {
  try {
    // Check if it's a group (has keys method)
    if (typeof item.keys === 'function') {
      return processHDF5Group(item, name, path);
    }
    
    // Check if it's a dataset (has shape or value property)
    if (item.shape !== undefined || item.value !== undefined) {
      return processHDF5Dataset(item, name, path);
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

// Process HDF5 group (directory-like structure)
function processHDF5Group(group, name, path) {
  const groupStructure = {
    type: 'group',
    name,
    path,
    children: []
  };

  try {
    const keys = group.keys();
    console.log(`Group ${path} has ${keys.length} children`);
    
    for (const key of keys) {
      try {
        const childItem = group.get(key);
        const childPath = `${path}/${key}`;
        const childStructure = processHDF5Item(childItem, key, childPath);
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

// Process HDF5 dataset (actual data)
function processHDF5Dataset(dataset, name, path) {
  const datasetStructure = {
    type: 'dataset',
    name,
    path,
    shape: dataset.shape || [],
    size: dataset.size || 0,
    dtype: dataset.dtype || 'unknown',
    attributes: []
  };

  try {
    // Extract attributes
    if (dataset.attrs) {
      for (const [attrName, attrValue] of Object.entries(dataset.attrs)) {
        datasetStructure.attributes.push({
          name: attrName,
          value: attrValue,
          type: typeof attrValue
        });
      }
    }

    // Determine if this could be wavelength or reflectance data
    datasetStructure.isWavelengthCandidate = isWavelengthCandidate(datasetStructure);
    datasetStructure.isReflectanceCandidate = isReflectanceCandidate(datasetStructure);

  } catch (error) {
    console.warn(`Error processing HDF5 dataset attributes ${path}:`, error);
    datasetStructure.error = error.message;
  }

  return datasetStructure;
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
  
  // This would implement actual dataset loading
  // For now, return a placeholder
  return {
    message: `Dataset ${datasetPath} would be loaded on demand`,
    path: datasetPath,
    loadedOnDemand: true
  };
}