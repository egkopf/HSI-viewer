import { NetCDFReader } from 'netcdfjs';
import { parseHDF5Structure, loadHDF5Dataset } from './parseHDF5Structure.js';

// Alternative file reading method using FileReader
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = function(event) {
      resolve(event.target.result);
    };
    
    reader.onerror = function(error) {
      reject(new Error(`FileReader error: ${error.message || 'Unknown error'}`));
    };
    
    reader.onabort = function() {
      reject(new Error('FileReader was aborted'));
    };
    
    try {
      reader.readAsArrayBuffer(file);
    } catch (error) {
      reject(new Error(`Failed to start FileReader: ${error.message}`));
    }
  });
}

// Read file in chunks for large files
async function readFileInChunks(file) {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const chunks = [];
  let offset = 0;
  
  console.log(`Reading ${file.size} bytes in ${chunkSize} byte chunks...`);
  
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    try {
      const chunkBuffer = await chunk.arrayBuffer();
      chunks.push(new Uint8Array(chunkBuffer));
      offset += chunkSize;
      
      // Log progress for large files
      if (file.size > 100 * 1024 * 1024) { // 100MB
        const progress = (offset / file.size * 100).toFixed(1);
        console.log(`Read progress: ${progress}%`);
      }
    } catch (error) {
      throw new Error(`Failed to read chunk at offset ${offset}: ${error.message}`);
    }
  }
  
  console.log('Combining chunks...');
  // Combine all chunks into a single ArrayBuffer
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalSize);
  let position = 0;
  
  for (const chunk of chunks) {
    combined.set(chunk, position);
    position += chunk.length;
  }
  
  console.log('File reading complete');
  return combined.buffer;
}


// Check if file is a valid NetCDF file by examining magic bytes
function isValidNetCDFFile(arrayBuffer) {
  const view = new Uint8Array(arrayBuffer);
  
  console.log('Analyzing file format...');
  
  if (view.length < 4) {
    console.log('File too small (less than 4 bytes)');
    return { isValid: false, format: 'unknown' };
  }
  
  // Debug: Show first 16 bytes in both hex and ASCII
  const first16 = view.slice(0, 16);
  const hexStr = Array.from(first16).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asciiStr = Array.from(first16).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(`First 16 bytes hex: ${hexStr}`);
  console.log(`First 16 bytes ASCII: "${asciiStr}"`);
  
  // Check for NetCDF3 format first (most common)
  // NetCDF3: "CDF\x01" or "CDF\x02"
  if (view[0] === 0x43 && view[1] === 0x44 && view[2] === 0x46 && 
      (view[3] === 0x01 || view[3] === 0x02)) {
    console.log(`Detected NetCDF3 format (classic NetCDF) - version ${view[3]}`);
    return { isValid: true, format: 'netcdf3' };
  }
  
  // Check for NetCDF4/HDF5 format
  // NetCDF4/HDF5: "\x89HDF\r\n\x1a\n"
  if (view.length >= 8 && 
      view[0] === 0x89 && view[1] === 0x48 && view[2] === 0x44 && view[3] === 0x46 &&
      view[4] === 0x0D && view[5] === 0x0A && view[6] === 0x1A && view[7] === 0x0A) {
    console.log('Detected NetCDF4/HDF5 format');
    return { isValid: true, format: 'netcdf4' };
  }
  
  // Check for variations of NetCDF format
  if (view.length >= 4) {
    // Look for "CDF" at the beginning with any version byte
    if (view[0] === 0x43 && view[1] === 0x44 && view[2] === 0x46) {
      console.log(`Detected NetCDF-like format with version byte: 0x${view[3].toString(16)}`);
      return { isValid: true, format: 'netcdf3' }; // Treat as NetCDF3 by default
    }
  }
  
  // Check for other common scientific data formats that might be confused with NetCDF
  if (view.length >= 8) {
    // Check for pure HDF5 (without NetCDF wrapper)
    if (view[0] === 0x89 && view[1] === 0x48 && view[2] === 0x44 && view[3] === 0x46) {
      console.log('This appears to be a pure HDF5 file (not NetCDF4)');
      return { isValid: false, format: 'hdf5' };
    }
    
    // Check for other formats
    if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
      console.log('This appears to be a PNG file');
      return { isValid: false, format: 'png' };
    }
  }
  
  console.log('No valid NetCDF format detected - this may not be a NetCDF file');
  console.log('First 4 bytes:', Array.from(view.slice(0, 4)).map(b => `0x${b.toString(16)}`).join(' '));
  
  return { isValid: false, format: 'unknown' };
}

// Read only header portion of file for structure parsing
async function readFileHeader(file, maxSize = 10 * 1024 * 1024) { // 10MB default
  const headerSize = Math.min(file.size, maxSize);
  const headerSlice = file.slice(0, headerSize);
  
  try {
    return await headerSlice.arrayBuffer();
  } catch (error) {
    console.warn('Header reading failed, trying FileReader approach');
    return await readFileAsArrayBuffer(headerSlice);
  }
}

// Parse NetCDF file and extract hierarchical structure
export async function parseNetCDFStructure(file) {
  try {
    // Validate file
    if (!file || !file.arrayBuffer) {
      throw new Error('Invalid file object provided');
    }

    console.log('Reading NetCDF file:', file.name, 'Size:', file.size);
    
    const fileSizeMB = file.size / 1024 / 1024;
    const isLargeFile = file.size > 100 * 1024 * 1024; // 100MB threshold
    
    if (isLargeFile) {
      console.log(`Large file detected (${fileSizeMB.toFixed(1)}MB). Using header-only parsing.`);
    }
    
    // Log file extension for debugging
    const fileExtension = file.name.toLowerCase().split('.').pop();
    console.log(`File extension: .${fileExtension}`);

    // For large files, read only header portion for structure analysis
    let fileBuffer;
    if (isLargeFile) {
      console.log('Reading file header for structure analysis...');
      fileBuffer = await readFileHeader(file, 50 * 1024 * 1024); // 50MB max header
      console.log('Header read successfully, size:', fileBuffer.byteLength);
    } else {
      // For smaller files, read the entire file
      try {
        console.log('Reading entire file...');
        fileBuffer = await file.arrayBuffer();
        console.log('File read successfully');
      } catch (bufferError) {
        console.warn('Direct read failed, trying FileReader:', bufferError.message);
        fileBuffer = await readFileAsArrayBuffer(file);
      }
    }
    
    if (fileBuffer.byteLength === 0) {
      throw new Error('File is empty');
    }

    // Validate NetCDF file format
    const formatCheck = isValidNetCDFFile(fileBuffer);
    if (!formatCheck.isValid) {
      if (formatCheck.format === 'hdf5') {
        throw new Error('This appears to be a pure HDF5 file, not a NetCDF file. Please use the HDF5 upload option instead.');
      } else if (formatCheck.format === 'png') {
        throw new Error('This appears to be a PNG image file, not a NetCDF file.');
      } else {
        throw new Error(`This does not appear to be a valid NetCDF file. Detected format: ${formatCheck.format}. Please check the file format.`);
      }
    }

    // Special handling: if file has .nc extension but appears to be NetCDF4/HDF5,
    // try NetCDF3 parser first since many .nc files are actually NetCDF3
    const preferNetCDF3 = fileExtension === 'nc' || fileExtension === 'netcdf';
    
    if (formatCheck.format === 'netcdf4' && preferNetCDF3) {
      console.log('NetCDF4/HDF5 format detected, but trying NetCDF3 parser first due to .nc extension');
      try {
        // Try NetCDF3 first
        const netcdfReader = new NetCDFReader(fileBuffer);
        const structure = extractNetCDFStructure(netcdfReader);
        
        structure.format = 'NetCDF3 (classic)';
        if (isLargeFile) {
          structure.isLargeFile = true;
          structure.fileSize = file.size;
        }
        
        console.log('NetCDF3 parsing succeeded');
        return structure;
      } catch (netcdf3Error) {
        console.log('NetCDF3 parsing failed, falling back to HDF5 parser:', netcdf3Error.message);
        // Fall through to HDF5 parsing
      }
    }
    
    // If this is NetCDF4 (which is actually HDF5), use HDF5 parser
    if (formatCheck.format === 'netcdf4') {
      console.log('Using HDF5 parser for NetCDF4 format');
      try {
        const hdf5Structure = await parseHDF5Structure(file);
        
        // Convert HDF5 structure to NetCDF-like structure
        const netcdfStructure = {
          type: 'netcdf4',
          name: 'root',
          path: '/',
          children: hdf5Structure.children,
          format: 'NetCDF4 (HDF5)',
          isLargeFile,
          fileSize: file.size
        };
        
        // Copy HDF5 metadata if present
        if (hdf5Structure.headerSize) {
          netcdfStructure.headerSize = hdf5Structure.headerSize;
        }
        
        return netcdfStructure;
      } catch (hdf5Error) {
        console.error('NetCDF4/HDF5 parsing failed:', hdf5Error.message);
        
        // If HDF5 parsing fails, try falling back to NetCDF3 parser
        console.log('HDF5 parsing failed, attempting fallback to NetCDF3 parser...');
        try {
          // Force NetCDF3 parsing as fallback
          const netcdfReader = new NetCDFReader(fileBuffer);
          const structure = extractNetCDFStructure(netcdfReader);
          
          // Add metadata about fallback
          structure.format = 'NetCDF (fallback from HDF5)';
          if (isLargeFile) {
            structure.isLargeFile = true;
            structure.fileSize = file.size;
          }
          
          console.log('NetCDF3 fallback parsing succeeded');
          return structure;
        } catch (netcdfFallbackError) {
          console.error('NetCDF3 fallback also failed:', netcdfFallbackError.message);
          throw new Error(`This file appears to have NetCDF4/HDF5 format signature but cannot be parsed by either HDF5 or NetCDF3 parsers. 
          
HDF5 parsing failed: ${hdf5Error.message}
NetCDF3 fallback failed: ${netcdfFallbackError.message}

This suggests the file may be:
1. A corrupted NetCDF/HDF5 file
2. An unsupported variant of NetCDF4/HDF5 format
3. A different file format with similar header bytes
4. Too large for browser-based parsing (${(file.size / 1024 / 1024 / 1024).toFixed(1)}GB)

For very large files (>2GB), consider:
- Using a smaller subset of the data
- Processing with external tools (Python with h5py/netCDF4) to extract specific datasets
- Using desktop applications designed for large scientific data files
- Server-side processing solutions

Please check the file integrity and format, or try using a smaller file.`);
        }
      }
    }

    // Create NetCDF reader with additional error handling
    let reader;
    try {
      reader = new NetCDFReader(fileBuffer);
    } catch (readerError) {
      console.error('Error creating NetCDF reader:', readerError);
      
      // If header-only parsing failed, provide clear error message
      if (isLargeFile) {
        throw new Error(`NetCDF header parsing failed for large file (${fileSizeMB.toFixed(1)}MB). The file header may be corrupted or use an unsupported NetCDF format. Try with a smaller file or check if the file is valid.`);
      }
      
      // Check if it's a NetCDF format issue
      if (readerError.message.includes('permission') || readerError.message.includes('read')) {
        throw new Error('File access error. This may be due to:\n1. Browser security restrictions\n2. File corruption\n3. Invalid NetCDF format\n\nTry:\n- Refreshing the page\n- Using a different browser\n- Checking if the file is a valid NetCDF file');
      } else if (readerError.message.includes('format') || readerError.message.includes('magic')) {
        throw new Error('Invalid NetCDF file format. Please ensure the file is a valid NetCDF file.');
      } else {
        throw new Error(`NetCDF reader error: ${readerError.message}`);
      }
    }
    
    // Extract file structure
    const structure = extractNetCDFStructure(reader);
    
    // Add metadata about large file handling
    if (isLargeFile) {
      structure.isLargeFile = true;
      structure.fileSize = file.size;
    }
    
    return structure;
  } catch (error) {
    console.error('Error parsing NetCDF file structure:', error);
    throw error; // Re-throw the error to preserve the more specific error message
  }
}

// Extract hierarchical structure from NetCDF file
function extractNetCDFStructure(reader) {
  const structure = {
    type: 'netcdf',
    name: 'root',
    path: '/',
    children: []
  };

  // Add global attributes
  if (reader.globalAttributes && reader.globalAttributes.length > 0) {
    structure.children.push({
      type: 'attributes',
      name: 'Global Attributes',
      path: '/attributes',
      children: reader.globalAttributes.map(attr => ({
        type: 'attribute',
        name: attr.name,
        path: `/attributes/${attr.name}`,
        value: attr.value,
        dataType: typeof attr.value
      }))
    });
  }

  // Add dimensions
  if (reader.dimensions && reader.dimensions.length > 0) {
    structure.children.push({
      type: 'dimensions',
      name: 'Dimensions',
      path: '/dimensions',
      children: reader.dimensions.map(dim => ({
        type: 'dimension',
        name: dim.name,
        path: `/dimensions/${dim.name}`,
        size: dim.size,
        unlimited: dim.unlimited
      }))
    });
  }

  // Add variables (datasets)
  if (reader.variables && reader.variables.length > 0) {
    structure.children.push({
      type: 'variables',
      name: 'Variables',
      path: '/variables',
      children: reader.variables.map(variable => ({
        type: 'variable',
        name: variable.name,
        path: `/variables/${variable.name}`,
        dimensions: variable.dimensions,
        shape: variable.shape,
        dataType: variable.type,
        attributes: variable.attributes || [],
        size: variable.size,
        // Check if this could be wavelength or reflectance data
        isWavelengthCandidate: isWavelengthCandidate(variable),
        isReflectanceCandidate: isReflectanceCandidate(variable)
      }))
    });
  }

  return structure;
}

// Check if a variable could contain wavelength data
function isWavelengthCandidate(variable) {
  const name = variable.name.toLowerCase();
  const wavelengthKeywords = ['wavelength', 'wavelengths', 'wl', 'lambda', 'frequency', 'wavenumber'];
  
  // Check name
  if (wavelengthKeywords.some(keyword => name.includes(keyword))) {
    return true;
  }
  
  // Check attributes
  if (variable.attributes) {
    const hasWavelengthAttribute = variable.attributes.some(attr => 
      wavelengthKeywords.some(keyword => 
        attr.name.toLowerCase().includes(keyword) || 
        (typeof attr.value === 'string' && attr.value.toLowerCase().includes(keyword))
      )
    );
    if (hasWavelengthAttribute) return true;
  }
  
  // Check if it's 1D and has reasonable size for wavelength data
  if (variable.dimensions.length === 1 && variable.size > 10 && variable.size < 10000) {
    return true;
  }
  
  return false;
}

// Check if a variable could contain reflectance/radiance data
function isReflectanceCandidate(variable) {
  const name = variable.name.toLowerCase();
  const reflectanceKeywords = ['reflectance', 'radiance', 'data', 'cube', 'image', 'spectral', 'hyperspectral'];
  
  // Check name
  if (reflectanceKeywords.some(keyword => name.includes(keyword))) {
    return true;
  }
  
  // Check attributes
  if (variable.attributes) {
    const hasReflectanceAttribute = variable.attributes.some(attr => 
      reflectanceKeywords.some(keyword => 
        attr.name.toLowerCase().includes(keyword) || 
        (typeof attr.value === 'string' && attr.value.toLowerCase().includes(keyword))
      )
    );
    if (hasReflectanceAttribute) return true;
  }
  
  // Check if it's 3D (likely hyperspectral cube)
  if (variable.dimensions.length === 3 && variable.size > 1000) {
    return true;
  }
  
  return false;
}

// Load data from a specific NetCDF variable
export async function loadNetCDFVariable(file, variableName, options = {}) {
  try {
    // Validate inputs
    if (!file || !variableName) {
      throw new Error('File and variable name are required');
    }

    console.log(`Loading NetCDF variable: ${variableName} from ${file.name}`);
    
    const fileSizeMB = file.size / 1024 / 1024;
    const isLargeFile = file.size > 100 * 1024 * 1024; // 100MB threshold
    
    if (isLargeFile) {
      console.log(`Large file detected (${fileSizeMB.toFixed(1)}MB). Note: Variable data loading requires full file access.`);
    }

    // For variable loading, we need the full file (unlike structure parsing)
    let fileBuffer;
    try {
      if (isLargeFile) {
        console.log('Reading large file for variable data...');
        // Try chunked reading for large files
        fileBuffer = await readFileInChunks(file);
      } else {
        fileBuffer = await file.arrayBuffer();
      }
    } catch (bufferError) {
      console.warn('Direct read failed, trying FileReader:', bufferError.message);
      try {
        fileBuffer = await readFileAsArrayBuffer(file);
      } catch (readerError) {
        console.error('FileReader also failed:', readerError.message);
        if (isLargeFile) {
          throw new Error(`Cannot load variable from large file (${fileSizeMB.toFixed(1)}MB): ${bufferError.message}. Try using a smaller file or consider processing the data in external tools first.`);
        } else {
          throw new Error(`Cannot read file for variable loading: ${bufferError.message}`);
        }
      }
    }
    
    const formatCheck = isValidNetCDFFile(fileBuffer);
    
    // If this is NetCDF4, use HDF5 loader
    if (formatCheck.format === 'netcdf4') {
      console.log('Loading NetCDF4 variable using HDF5 loader');
      try {
        const hdf5Data = await loadHDF5Dataset(file, variableName, options);
        return {
          data: hdf5Data.data,
          variable: {
            name: variableName.split('/').pop(),
            shape: hdf5Data.shape,
            attributes: Object.entries(hdf5Data.attributes || {}).map(([key, value]) => ({
              name: key,
              value: value
            }))
          },
          shape: hdf5Data.shape,
          dimensions: hdf5Data.shape.map((size, idx) => `dim_${idx}`),
          attributes: Object.entries(hdf5Data.attributes || {}).map(([key, value]) => ({
            name: key,
            value: value
          }))
        };
      } catch (hdf5Error) {
        throw new Error(`NetCDF4 variable loading failed: ${hdf5Error.message}`);
      }
    }
    
    // For NetCDF3, use standard NetCDF reader
    const reader = new NetCDFReader(fileBuffer);
    
    // Check if variable exists
    const variable = reader.variables.find(v => v.name === variableName);
    if (!variable) {
      throw new Error(`Variable "${variableName}" not found in NetCDF file`);
    }
    
    const data = reader.getDataVariable(variableName);
    
    return {
      data,
      variable,
      shape: variable.shape,
      dimensions: variable.dimensions,
      attributes: variable.attributes || []
    };
  } catch (error) {
    console.error(`Error loading NetCDF variable ${variableName}:`, error);
    throw error;
  }
}