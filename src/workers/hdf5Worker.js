// HDF5 Web Worker for parsing HDF5 files in a separate thread
// Uses the same h5wasm approach as parseHDF5.js but in a worker to avoid blocking UI

let h5wasm = null;

// Initialize h5wasm in worker context
async function initializeH5wasm() {
  if (!h5wasm) {
    try {
      // Import h5wasm in worker context using dynamic import
      const h5wasmModule = await import('h5wasm');
      await h5wasmModule.ready;
      h5wasm = h5wasmModule;
      console.log('h5wasm initialized in worker');
    } catch (error) {
      console.error('Failed to initialize h5wasm in worker:', error);
      throw new Error('HDF5 support not available in worker');
    }
  }
  return h5wasm;
}

// Parse HDF5 file using true WORKERFS lazy loading like myhdf5.hdfgroup.org
async function parseHDF5InWorker(file) {
  const h5 = await initializeH5wasm();
  
  try {
    console.log(`Starting true lazy loading for ${(file.size / 1024 / 1024).toFixed(1)}MB file using WORKERFS...`);
    
    // Create mount directory
    try {
      h5.FS.mkdir('/work');
    } catch (e) {
      // Directory might already exist
    }
    
    // Mount file using WORKERFS for true lazy access (like myhdf5)
    // This provides direct access to File object without loading into memory
    console.log('Mounting file with WORKERFS...');
    
    // Check if WORKERFS is available
    if (!h5.FS.filesystems.WORKERFS) {
      throw new Error('WORKERFS filesystem not available in this h5wasm build');
    }
    
    h5.FS.mount(h5.FS.filesystems.WORKERFS, {
      files: [file]
    }, '/work');
    
    const filePath = `/work/${file.name}`;
    console.log(`File mounted at: ${filePath}`);
    
    // Open HDF5 file handle for lazy access
    const f = new h5.File(filePath, 'r');
    console.log('HDF5 file opened successfully with lazy access');
    
    // Extract metadata using lazy access (only reads metadata, not datasets)
    const metadata = await extractHDF5MetadataInWorker(f);
    
    // Keep file handle open for future lazy data access
    // Note: In a full implementation, we'd store this handle for later use
    // For now, we'll close it since we're only doing structure parsing
    f.close();
    
    // Unmount the filesystem
    try {
      h5.FS.unmount('/work');
    } catch (e) {
      console.warn('Unmount warning (non-fatal):', e);
    }
    
    console.log('WORKERFS lazy loading completed successfully');
    return metadata;
    
  } catch (error) {
    console.error('WORKERFS approach failed:', error);
    
    // If WORKERFS fails (browser compatibility), fall back to buffer approach
    console.log('Falling back to buffer approach...');
    try {
      const fileBuffer = await file.arrayBuffer();
      return await parseWithBuffer(h5, fileBuffer, file.name);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      throw new Error(`Both WORKERFS and fallback failed: ${error.message} | ${fallbackError.message}`);
    }
  }
}

// Parse HDF5 buffer using h5wasm (fallback when WORKERFS fails)
async function parseWithBuffer(h5, buffer, fileName) {
  try {
    console.log(`Fallback: Reading ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB into memory...`);
    
    // Create HDF5 file from buffer
    const filename = `/tmp/${fileName}_${Date.now()}`;
    h5.FS.writeFile(filename, new Uint8Array(buffer));
    
    const f = new h5.File(filename, 'r');
    
    // Extract metadata from HDF5 file
    const metadata = await extractHDF5MetadataInWorker(f);
    
    // Close file and cleanup
    f.close();
    try {
      h5.FS.unlink(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return metadata;
    
  } catch (error) {
    console.error('Error parsing with buffer:', error);
    throw error;
  }
}

// Extract complete file structure from HDF5 file (adapted from parseHDF5Structure.js)
async function extractHDF5MetadataInWorker(file) {
  try {
    // Get root level keys first to check if file is valid
    let rootKeys;
    try {
      rootKeys = file.keys();
      console.log('HDF5 Root level keys:', rootKeys);
    } catch (error) {
      throw new Error('Unable to read HDF5 file structure - file may be corrupted or not a valid HDF5 file');
    }
    
    // Extract complete file structure
    const structure = {
      type: 'hdf5',
      name: 'root',
      path: '/',
      children: []
    };
    
    console.log(`Found ${rootKeys.length} root level items`);
    
    // Process each root level item
    for (const key of rootKeys) {
      try {
        const item = file.get(key);
        const childStructure = processHDF5ItemInWorker(item, key, `/${key}`);
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
    
    console.log('Complete HDF5 structure extracted in worker');
    return structure;
    
  } catch (error) {
    console.error('Error extracting HDF5 structure in worker:', error);
    throw error;
  }
}

// Process individual HDF5 item (group or dataset) in worker
function processHDF5ItemInWorker(item, name, path) {
  try {
    // Check if it's a group (has keys method)
    if (typeof item.keys === 'function') {
      return processHDF5GroupInWorker(item, name, path);
    }
    
    // Check if it's a dataset (has shape or value property)
    if (item.shape !== undefined || item.value !== undefined) {
      return processHDF5DatasetInWorker(item, name, path);
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

// Process HDF5 group (directory-like structure) in worker
function processHDF5GroupInWorker(group, name, path) {
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
        const childStructure = processHDF5ItemInWorker(childItem, key, childPath);
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

// Process HDF5 dataset (actual data) in worker
function processHDF5DatasetInWorker(dataset, name, path) {
  const datasetStructure = {
    type: 'dataset',
    name,
    path,
    shape: dataset.shape || [],
    size: dataset.size || 0,
    dtype: dataset.dtype || 'unknown',
    attributes: []
  };

  // Indicate that data is not loaded in worker context
  datasetStructure.dataNotLoaded = true;

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
    datasetStructure.isWavelengthCandidate = isWavelengthCandidateInWorker(datasetStructure);
    datasetStructure.isReflectanceCandidate = isReflectanceCandidateInWorker(datasetStructure);

  } catch (error) {
    console.warn(`Error processing HDF5 dataset attributes ${path}:`, error);
    datasetStructure.error = error.message;
  }

  return datasetStructure;
}

// Check if a dataset could contain wavelength data (worker version)
function isWavelengthCandidateInWorker(dataset) {
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

// Check if a dataset could contain reflectance/radiance data (worker version)
function isReflectanceCandidateInWorker(dataset) {
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

// Handle messages from main thread
self.onmessage = async function(e) {
  const { type, fileId, file } = e.data;
  
  try {
    switch (type) {
      case 'PARSE_STRUCTURE':
        console.log('Worker: Parsing HDF5 structure for file:', file.name);
        
        // Parse HDF5 file in worker
        const metadata = await parseHDF5InWorker(file);
        
        // Send success response
        self.postMessage({
          type: 'STRUCTURE_PARSED',
          fileId,
          success: true,
          metadata
        });
        break;
        
      case 'CLEANUP':
        console.log('Worker: Cleanup requested for:', fileId);
        
        // No persistent resources to cleanup in this simplified approach
        self.postMessage({
          type: 'CLEANUP_COMPLETE',
          fileId,
          success: true
        });
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({
      type: 'ERROR',
      fileId,
      success: false,
      error: error.message
    });
  }
};

console.log('HDF5 Worker initialized and ready');