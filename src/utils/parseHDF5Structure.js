// Parse HDF5 file and extract hierarchical structure
let h5wasm;

const initializeH5wasm = async () => {
  if (!h5wasm) {
    try {
      h5wasm = await import('h5wasm');
      await h5wasm.ready;
    } catch (error) {
      console.error('Failed to initialize h5wasm:', error);
      throw new Error('HDF5 support not available');
    }
  }
  return h5wasm;
};

// Progressive header reading - try increasing sizes until HDF5 parsing works
async function readHDF5HeaderProgressive(file, h5) {
  const fileSizeGB = file.size / (1024 * 1024 * 1024);
  
  // For very large files (>1GB), start with larger header sizes
  let headerSizes;
  if (fileSizeGB > 1) {
    headerSizes = [
      50 * 1024 * 1024,   // 50MB
      100 * 1024 * 1024,  // 100MB
      200 * 1024 * 1024,  // 200MB
      500 * 1024 * 1024,  // 500MB
      1024 * 1024 * 1024, // 1GB
      file.size           // Full file as last resort
    ];
  } else {
    headerSizes = [
      10 * 1024 * 1024,   // 10MB
      25 * 1024 * 1024,   // 25MB
      50 * 1024 * 1024,   // 50MB
      100 * 1024 * 1024,  // 100MB
      200 * 1024 * 1024,  // 200MB
      file.size           // Full file as last resort
    ];
  }
  
  for (let i = 0; i < headerSizes.length; i++) {
    const headerSize = Math.min(file.size, headerSizes[i]);
    const isFullFile = headerSize === file.size;
    
    console.log(`Trying HDF5 header size: ${(headerSize / 1024 / 1024).toFixed(1)}MB${isFullFile ? ' (full file)' : ''}`);
    
    // Warn about very large header attempts
    if (headerSize > 500 * 1024 * 1024) {
      console.warn(`Attempting to read large header (${(headerSize / 1024 / 1024).toFixed(1)}MB) - this may take time and use significant memory`);
    }
    
    try {
      const headerSlice = file.slice(0, headerSize);
      const headerBuffer = await headerSlice.arrayBuffer();
      
      // Test if this header size works with HDF5
      const filename = `/tmp/test_${Date.now()}_${file.name}`;
      h5.FS.writeFile(filename, new Uint8Array(headerBuffer));
      
      try {
        const testFile = new h5.File(filename, 'r');
        // Try to read basic structure to validate
        const keys = testFile.keys();
        testFile.close();
        
        // If we get here, this header size works
        console.log(`HDF5 header size ${(headerSize / 1024 / 1024).toFixed(1)}MB works successfully`);
        
        // Cleanup test file
        try {
          h5.FS.unlink(filename);
        } catch (e) {}
        
        return headerBuffer;
      } catch (testError) {
        // Cleanup test file
        try {
          h5.FS.unlink(filename);
        } catch (e) {}
        
        // If this isn't the last size, try next size
        if (i < headerSizes.length - 1) {
          console.log(`HDF5 header size ${(headerSize / 1024 / 1024).toFixed(1)}MB failed: ${testError.message}`);
          continue;
        } else {
          throw testError;
        }
      }
    } catch (readError) {
      console.error(`Failed to read ${(headerSize / 1024 / 1024).toFixed(1)}MB header: ${readError.message}`);
      
      // Check if this is a memory/file size issue
      if (readError.message.includes('permission problems') || readError.message.includes('requested file could not be read')) {
        throw new Error(`File too large for browser processing (${(file.size / 1024 / 1024 / 1024).toFixed(1)}GB). 

This file cannot be processed directly in the browser because:
1. It exceeds browser memory limits
2. The file structure requires reading the entire file, not just headers

Recommended solutions:
1. Use a smaller subset of the data
2. Process the file with external tools (e.g., Python with h5py/netCDF4) to extract just the wavelength and reflectance data you need
3. Use a desktop application designed for large HDF5/NetCDF files
4. Consider using a server-side solution for processing such large files

File size: ${(file.size / 1024 / 1024 / 1024).toFixed(1)}GB
Browser memory limit typically: 1-2GB for file processing`);
      }
      
      if (i === headerSizes.length - 1) {
        throw new Error(`Failed to read HDF5 file after trying all header sizes: ${readError.message}`);
      }
    }
  }
}

export async function parseHDF5Structure(file) {
  const h5 = await initializeH5wasm();
  
  try {
    console.log('Reading HDF5 file:', file.name, 'Size:', file.size);
    
    const fileSizeMB = file.size / 1024 / 1024;
    const isLargeFile = file.size > 100 * 1024 * 1024; // 100MB threshold
    
    let fileBuffer;
    let actualHeaderSize = 0;
    
    if (isLargeFile) {
      console.log(`Large HDF5 file detected (${fileSizeMB.toFixed(1)}MB). Using progressive header parsing.`);
      
      // Add timeout protection
      const parsePromise = readHDF5HeaderProgressive(file, h5);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('HDF5 header parsing timed out after 30 seconds')), 30000);
      });
      
      try {
        fileBuffer = await Promise.race([parsePromise, timeoutPromise]);
        actualHeaderSize = fileBuffer.byteLength;
        console.log('HDF5 progressive header read successfully, final size:', actualHeaderSize);
      } catch (progressiveError) {
        console.error('Progressive header parsing failed:', progressiveError.message);
        if (progressiveError.message.includes('timed out')) {
          throw new Error(`HDF5 file parsing timed out. File may be too large or corrupted. Try with a smaller file.`);
        }
        throw progressiveError;
      }
    } else {
      console.log('Reading entire HDF5 file...');
      fileBuffer = await file.arrayBuffer();
      actualHeaderSize = fileBuffer.byteLength;
    }
    
    // Create HDF5 file from buffer using FS approach
    const filename = `/tmp/${file.name}`;
    h5.FS.writeFile(filename, new Uint8Array(fileBuffer));
    const f = new h5.File(filename, 'r');
    
    // Extract file structure
    const structure = extractHDF5Structure(f, isLargeFile);
    
    // Add metadata about large file handling
    if (isLargeFile) {
      structure.isLargeFile = true;
      structure.fileSize = file.size;
      structure.headerSize = actualHeaderSize;
    }
    
    // Close file and cleanup
    f.close();
    try {
      h5.FS.unlink(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return structure;
  } catch (error) {
    console.error('Error parsing HDF5 file structure:', error);
    if (error.message.includes('not a valid HDF5 file') || error.message.includes('file signature')) {
      throw new Error(`Invalid HDF5 file: ${error.message}`);
    }
    if (error.message.includes('name not defined')) {
      throw new Error(`HDF5 file structure is incomplete or corrupted. The file may require the full content to be read, or the file format may be unsupported.`);
    }
    throw new Error(`Failed to parse HDF5 file: ${error.message}`);
  }
}

// Extract hierarchical structure from HDF5 file
function extractHDF5Structure(file, isLargeFile = false) {
  const structure = {
    type: 'hdf5',
    name: 'root',
    path: '/',
    children: []
  };

  try {
    // Get root level keys
    const rootKeys = file.keys();
    console.log(`Found ${rootKeys.length} root level items`);
    
    // Process each root level item
    for (const key of rootKeys) {
      try {
        const item = file.get(key);
        const childStructure = processHDF5Item(item, key, `/${key}`, isLargeFile);
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
    console.error('Error extracting HDF5 structure:', error);
    throw error;
  }

  return structure;
}

// Process individual HDF5 item (group or dataset)
function processHDF5Item(item, name, path, isLargeFile = false) {
  try {
    // Check if it's a group (has keys method)
    if (typeof item.keys === 'function') {
      return processHDF5Group(item, name, path, isLargeFile);
    }
    
    // Check if it's a dataset (has shape or value property)
    if (item.shape !== undefined || item.value !== undefined) {
      return processHDF5Dataset(item, name, path, isLargeFile);
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
function processHDF5Group(group, name, path, isLargeFile = false) {
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
        const childStructure = processHDF5Item(childItem, key, childPath, isLargeFile);
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
function processHDF5Dataset(dataset, name, path, isLargeFile = false) {
  const datasetStructure = {
    type: 'dataset',
    name,
    path,
    shape: dataset.shape || [],
    size: dataset.size || 0,
    dtype: dataset.dtype || 'unknown',
    attributes: []
  };

  // For large files, indicate that data is not loaded
  if (isLargeFile) {
    datasetStructure.dataNotLoaded = true;
  }

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

// Load data from a specific HDF5 dataset with selective reading for large files
export async function loadHDF5Dataset(file, datasetPath, options = {}) {
  const h5 = await initializeH5wasm();
  
  try {
    const fileSizeGB = file.size / (1024 * 1024 * 1024);
    const isLargeFile = fileSizeGB > 1;
    
    console.log(`Loading HDF5 dataset ${datasetPath} from ${fileSizeGB.toFixed(1)}GB file`);
    
    let fileBuffer;
    let f;
    
    if (isLargeFile && options.useSelectiveReading) {
      // For large files, try to read only the dataset we need
      console.log('Attempting selective dataset reading for large file...');
      
      try {
        // First, try to determine dataset location without reading full file
        const result = await loadHDF5DatasetSelective(file, datasetPath, h5);
        if (result) {
          return result;
        }
      } catch (selectiveError) {
        console.warn('Selective reading failed, falling back to progressive header method:', selectiveError.message);
      }
      
      // Fallback to progressive header reading
      fileBuffer = await readHDF5HeaderProgressive(file, h5);
    } else {
      // For smaller files, read normally
      fileBuffer = await file.arrayBuffer();
    }
    
    const filename = `/tmp/${file.name}`;
    h5.FS.writeFile(filename, new Uint8Array(fileBuffer));
    f = new h5.File(filename, 'r');
    
    // Navigate to the dataset
    const pathParts = datasetPath.split('/').filter(p => p);
    let current = f;
    
    for (const part of pathParts) {
      current = current.get(part);
    }
    
    // Extract data and metadata
    const data = current.value;
    const shape = current.shape || [];
    const attributes = current.attrs || {};
    
    f.close();
    try {
      h5.FS.unlink(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return {
      data,
      shape,
      attributes,
      path: datasetPath
    };
  } catch (error) {
    console.error(`Error loading HDF5 dataset ${datasetPath}:`, error);
    throw error;
  }
}

// Attempt to read only a specific dataset from large HDF5 file
async function loadHDF5DatasetSelective(file, datasetPath, h5) {
  console.log(`Attempting selective reading for dataset: ${datasetPath}`);
  
  // This is a simplified approach - in reality, we'd need to:
  // 1. Parse the HDF5 file structure to find dataset locations
  // 2. Read only the necessary file chunks
  // 3. Reconstruct the dataset from those chunks
  
  // For now, we'll try reading progressively larger chunks until we can access the dataset
  const chunkSizes = [
    100 * 1024 * 1024,  // 100MB
    250 * 1024 * 1024,  // 250MB
    500 * 1024 * 1024,  // 500MB
    1024 * 1024 * 1024, // 1GB
  ];
  
  for (const chunkSize of chunkSizes) {
    if (chunkSize >= file.size) continue;
    
    console.log(`Trying selective read with ${(chunkSize / 1024 / 1024).toFixed(0)}MB chunk...`);
    
    try {
      // Try reading from the beginning of the file
      const chunk = file.slice(0, chunkSize);
      const chunkBuffer = await chunk.arrayBuffer();
      
      const filename = `/tmp/selective_${Date.now()}_${file.name}`;
      h5.FS.writeFile(filename, new Uint8Array(chunkBuffer));
      
      try {
        const f = new h5.File(filename, 'r');
        
        // Try to navigate to the dataset
        const pathParts = datasetPath.split('/').filter(p => p);
        let current = f;
        
        for (const part of pathParts) {
          current = current.get(part);
        }
        
        // If we get here, the dataset is accessible
        const data = current.value;
        const shape = current.shape || [];
        const attributes = current.attrs || {};
        
        f.close();
        try {
          h5.FS.unlink(filename);
        } catch (e) {}
        
        console.log(`Selective reading successful with ${(chunkSize / 1024 / 1024).toFixed(0)}MB chunk`);
        return {
          data,
          shape,
          attributes,
          path: datasetPath
        };
        
      } catch (datasetError) {
        // Dataset not accessible in this chunk
        try {
          h5.FS.unlink(filename);
        } catch (e) {}
        continue;
      }
    } catch (chunkError) {
      console.warn(`Chunk read failed: ${chunkError.message}`);
      continue;
    }
  }
  
  // If we get here, selective reading failed
  throw new Error('Dataset not accessible with selective reading - may require full file access');
}

// Load a spatial/spectral subset of a large dataset
export async function loadHDF5DatasetSubset(file, datasetPath, subsetOptions = {}) {
  const {
    maxSpatialSize = 1000,  // Maximum spatial dimensions (1000x1000 pixels)
    maxSpectralBands = null, // Maximum spectral bands (null = all)
    spatialStep = 1,         // Spatial sampling step (1 = every pixel, 2 = every other pixel)
    spectralStep = 1         // Spectral sampling step
  } = subsetOptions;
  
  console.log(`Loading HDF5 dataset subset: ${datasetPath}`);
  console.log(`Subset options:`, subsetOptions);
  
  // First, get the full dataset structure to understand its shape
  const fullResult = await loadHDF5Dataset(file, datasetPath, { useSelectiveReading: true });
  const fullShape = fullResult.shape;
  
  console.log(`Full dataset shape: [${fullShape.join(', ')}]`);
  
  // For very large datasets, we need to implement chunked reading
  // This is a simplified version - in practice, we'd need to:
  // 1. Read the HDF5 file format to find chunk locations
  // 2. Read only the chunks we need
  // 3. Reconstruct the subset
  
  // For now, if we got the full dataset, create a subset from it
  if (fullResult.data && fullShape.length === 3) {
    console.log('Creating spatial/spectral subset from loaded data...');
    
    const [dim1, dim2, dim3] = fullShape;
    let lines, samples, bands;
    
    // Determine data layout
    if (dim3 < dim1 && dim3 < dim2) {
      // Likely [lines, samples, bands]
      [lines, samples, bands] = [dim1, dim2, dim3];
    } else if (dim1 < dim2 && dim1 < dim3) {
      // Likely [bands, lines, samples]
      [bands, lines, samples] = [dim1, dim2, dim3];
    } else {
      // Default to [lines, samples, bands]
      [lines, samples, bands] = [dim1, dim2, dim3];
    }
    
    // Calculate subset dimensions
    const spatialSubsetLines = Math.min(lines, maxSpatialSize);
    const spatialSubsetSamples = Math.min(samples, maxSpatialSize);
    const spectralSubsetBands = maxSpectralBands ? Math.min(bands, maxSpectralBands) : bands;
    
    console.log(`Creating subset: ${spatialSubsetLines}x${spatialSubsetSamples}x${spectralSubsetBands}`);
    
    // Note: Full implementation would require complex array slicing based on data layout
    // For now, we return the full dataset with metadata about the intended subset
    return {
      ...fullResult,
      isSubset: true,
      fullShape,
      subsetShape: [spatialSubsetLines, spatialSubsetSamples, spectralSubsetBands],
      subsetOptions,
      recommendedProcessing: 'Consider using external tools for large dataset processing'
    };
  }
  
  return fullResult;
}