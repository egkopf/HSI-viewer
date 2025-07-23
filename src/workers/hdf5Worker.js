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

// Extract metadata from HDF5 file (adapted from parseHDF5.js)
async function extractHDF5MetadataInWorker(file) {
  const metadata = {};
  
  try {
    // Get root level keys first to check if file is valid
    let rootKeys;
    try {
      rootKeys = file.keys();
      console.log('HDF5 Root level keys:', rootKeys);
    } catch (error) {
      throw new Error('Unable to read HDF5 file structure - file may be corrupted or not a valid HDF5 file');
    }
    
    // Common HDF5 structures for hyperspectral data
    const commonPaths = [
      '/SJER/Reflectance/Reflectance_Data',      // NEON reflectance data
      '/Reflectance/Reflectance_Data',           // NEON alternative
      ...(rootKeys.length > 0 ? rootKeys.map(key => `/${key}/Reflectance/Reflectance_Data`) : []),
      '/reflectance',                            // Generic
      '/data',                                   // Generic
      '/image',                                  // Generic
      '/cube',                                   // Generic
      '/hyperspectral',                          // Generic
      '/radiance',                               // Radiance data
      '/dataset'                                 // Generic
    ];
    
    let mainDataset = null;
    let datasetPath = null;
    
    // Try to find the main hyperspectral dataset
    for (const path of commonPaths) {
      try {
        const pathParts = path.split('/').filter(p => p);
        let current = file;
        let exists = true;
        
        for (const part of pathParts) {
          try {
            current = current.get(part);
          } catch (e) {
            exists = false;
            break;
          }
        }
        
        if (exists && current.shape) {
          mainDataset = current;
          datasetPath = path;
          console.log(`Found main dataset at: ${path}`);
          break;
        }
      } catch (e) {
        // Path doesn't exist, continue
      }
    }
    
    // If no common path found, look for largest 3D dataset
    if (!mainDataset) {
      console.log('No common dataset path found, searching root keys:', rootKeys);
      for (const key of rootKeys) {
        try {
          const item = file.get(key);
          if (item.shape && item.shape.length === 3) {
            if (!mainDataset || item.size > mainDataset.size) {
              mainDataset = item;
              datasetPath = `/${key}`;
              console.log(`Selected dataset '${key}' with path: ${datasetPath}`);
            }
          }
        } catch (e) {
          console.log(`Failed to access root key '${key}':`, e.message);
        }
      }
    }
    
    if (!mainDataset) {
      throw new Error('No suitable hyperspectral dataset found in HDF5 file');
    }
    
    // Extract dimensions from dataset shape
    const shape = mainDataset.shape;
    let samples, lines, bands;
    
    if (shape.length === 3) {
      // Heuristic: assume the largest dimension is spatial
      const sortedIndices = shape.map((val, idx) => ({ val, idx }))
        .sort((a, b) => b.val - a.val);
      
      if (sortedIndices[0].val > sortedIndices[1].val * 2) {
        // Largest dimension is much larger, likely spatial
        if (sortedIndices[0].idx === 0) {
          [lines, samples, bands] = shape;
        } else if (sortedIndices[0].idx === 1) {
          [lines, samples, bands] = shape;
        } else {
          [bands, lines, samples] = shape;
        }
      } else {
        // Assume [lines, samples, bands] format (most common)
        [lines, samples, bands] = shape;
      }
    } else {
      throw new Error(`Unsupported dataset shape: ${shape}`);
    }
    
    // Extract additional metadata from attributes
    const attrs = mainDataset.attrs || {};
    
    // Look for wavelength information
    let wavelengthValues = null;
    const wavelengthKeys = ['wavelength', 'wavelengths', 'wl', 'bands'];
    
    for (const key of wavelengthKeys) {
      if (attrs[key]) {
        try {
          wavelengthValues = Array.from(attrs[key]);
          break;
        } catch (e) {
          // Continue looking
        }
      }
    }
    
    // Look for wavelength dataset
    if (!wavelengthValues) {
      const wavelengthPaths = [
        '/SJER/Reflectance/Metadata/Spectral_Data/Wavelength',
        '/Reflectance/Metadata/Spectral_Data/Wavelength',
        '/Metadata/Spectral_Data/Wavelength',
        '/wavelength',
        '/wavelengths',
        '/wl',
        '/bands'
      ];
      
      for (const path of wavelengthPaths) {
        try {
          const pathParts = path.split('/').filter(p => p);
          let current = file;
          let exists = true;
          
          for (const part of pathParts) {
            try {
              current = current.get(part);
            } catch (e) {
              exists = false;
              break;
            }
          }
          
          if (exists && current.value) {
            wavelengthValues = Array.from(current.value);
            console.log(`Found wavelengths at: ${path}`);
            break;
          }
        } catch (e) {
          // Path doesn't exist or can't be read
        }
      }
    }
    
    // Build metadata object
    metadata.samples = samples;
    metadata.lines = lines;
    metadata.bands = bands;
    metadata.dataType = 12; // Default to uint16
    metadata.interleave = 'bsq';
    metadata.byteOrder = 0;
    metadata.isBigEndian = false;
    metadata.headerOffset = 0;
    metadata.datasetPath = datasetPath;
    metadata.shape = shape;
    metadata.wavelengthValues = wavelengthValues;
    metadata.wavelengthUnits = attrs.units || attrs.wavelength_units || 'nm';
    metadata.dataIgnoreValue = attrs.data_ignore_value || attrs.nodata || attrs.missing_value || null;
    metadata.reflectanceScaleFactor = attrs.scale_factor || attrs.reflectance_scale_factor || null;
    metadata["data ignore value"] = metadata.dataIgnoreValue;
    
    console.log('Metadata extracted in worker:', {
      samples: metadata.samples,
      lines: metadata.lines,
      bands: metadata.bands,
      datasetPath: metadata.datasetPath,
      hasWavelengths: !!metadata.wavelengthValues
    });
    
    return metadata;
    
  } catch (error) {
    console.error('Error extracting HDF5 metadata in worker:', error);
    throw error;
  }
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