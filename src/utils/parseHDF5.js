import { selectDefaultRGBBands } from './bandSelection.js';
import { formatMetadataSummary } from './consoleInfo.js';
import { isValidPixelValue } from './dataValidation.js';

// Initialize h5wasm - must be called before using any HDF5 functions
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

// Parse HDF5 file metadata
export async function parseHDF5(file) {
  const h5 = await initializeH5wasm();
  
  try {
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    // Create HDF5 file from buffer using FS approach
    const filename = `/tmp/${file.name}`;
    h5.FS.writeFile(filename, new Uint8Array(fileBuffer));
    const f = new h5.File(filename, 'r');
    
    // Extract metadata from HDF5 file
    const metadata = await extractHDF5Metadata(f);
    
    // Close file and cleanup
    f.close();
    try {
      h5.FS.unlink(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return metadata;
  } catch (error) {
    console.error('Error parsing HDF5 file:', error);
    throw new Error(`Failed to parse HDF5 file: ${error.message}`);
  }
}

// Extract metadata from HDF5 file structure
async function extractHDF5Metadata(file) {
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
    // Look for common dataset paths (including NEON-specific paths)
    const commonPaths = [
      '/SJER/Reflectance/Reflectance_Data',      // NEON reflectance data (site-specific)
      '/Reflectance/Reflectance_Data',           // NEON alternative structure
      // Try dynamic site codes if we can detect them
      ...(rootKeys.length > 0 ? rootKeys.map(key => `/${key}/Reflectance/Reflectance_Data`) : []),
      '/reflectance',                            // Generic reflectance
      '/data',                                   // Generic data
      '/image',                                  // Generic image
      '/cube',                                   // Generic cube
      '/hyperspectral',                          // Generic hyperspectral
      '/radiance',                               // Radiance data
      '/dataset'                                 // Generic dataset
    ];
    
    let mainDataset = null;
    let datasetPath = null;
    
    // Try to find the main hyperspectral dataset
    for (const path of commonPaths) {
      try {
        const pathParts = path.split('/').filter(p => p);
        let current = file;
        let exists = true;
        
        // Navigate through the path hierarchy
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
      for (const key of rootKeys) {
        try {
          const item = file.get(key);
          if (item.shape && item.shape.length === 3) {
            // Check if this is larger than current candidate
            if (!mainDataset || item.size > mainDataset.size) {
              mainDataset = item;
              datasetPath = `/${key}`;
            }
          }
        } catch (e) {
          // Skip items that can't be accessed
        }
      }
    }
    
    if (!mainDataset) {
      throw new Error('No suitable hyperspectral dataset found in HDF5 file');
    }
    
    // Extract dimensions from dataset shape
    const shape = mainDataset.shape;
    let samples, lines, bands;
    
    // HDF5 hyperspectral data is commonly stored as:
    // - [bands, lines, samples] (spectral first)
    // - [lines, samples, bands] (spatial first)
    // Try to determine which format based on shape
    if (shape.length === 3) {
      // Heuristic: assume the largest dimension is spatial
      const sortedIndices = shape.map((val, idx) => ({ val, idx }))
        .sort((a, b) => b.val - a.val);
      
      if (sortedIndices[0].val > sortedIndices[1].val * 2) {
        // Largest dimension is much larger, likely spatial
        if (sortedIndices[0].idx === 0) {
          // [lines, samples, bands] format
          [lines, samples, bands] = shape;
        } else if (sortedIndices[0].idx === 1) {
          // [lines, samples, bands] format (permuted)
          [lines, samples, bands] = shape;
        } else {
          // [bands, lines, samples] format
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
    
    // Look for wavelength dataset (including NEON-specific paths)
    if (!wavelengthValues) {
      const wavelengthPaths = [
        '/SJER/Reflectance/Metadata/Spectral_Data/Wavelength',  // NEON wavelength
        '/Reflectance/Metadata/Spectral_Data/Wavelength',       // NEON alternative
        '/Metadata/Spectral_Data/Wavelength',                   // NEON simplified
        '/wavelength',                                           // Generic
        '/wavelengths',                                          // Generic
        '/wl',                                                   // Generic
        '/bands'                                                 // Generic
      ];
      
      for (const path of wavelengthPaths) {
        try {
          const pathParts = path.split('/').filter(p => p);
          let current = file;
          let exists = true;
          
          // Navigate through the path hierarchy
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
    
    // Extract other common attributes
    const dataIgnoreValue = attrs.data_ignore_value || attrs.nodata || attrs.missing_value || null;
    const reflectanceScaleFactor = attrs.scale_factor || attrs.reflectance_scale_factor || null;
    const units = attrs.units || attrs.wavelength_units || 'nm';
    
    // Build metadata object
    metadata.samples = samples;
    metadata.lines = lines;
    metadata.bands = bands;
    metadata.dataType = 12; // Default to uint16 (most common for hyperspectral)
    metadata.interleave = 'bsq'; // HDF5 is typically band sequential
    metadata.byteOrder = 0; // Little endian
    metadata.isBigEndian = false;
    metadata.headerOffset = 0;
    metadata.datasetPath = datasetPath;
    metadata.shape = shape;
    metadata.wavelengthValues = wavelengthValues;
    metadata.wavelengthUnits = units;
    metadata.dataIgnoreValue = dataIgnoreValue;
    metadata.reflectanceScaleFactor = reflectanceScaleFactor;
    
    // Select default RGB bands
    metadata.defaultBands = selectDefaultRGBBands({
      bands: metadata.bands,
      wavelengthValues: metadata.wavelengthValues
    });
    
    console.log(formatMetadataSummary(metadata));
    return metadata;
    
  } catch (error) {
    console.error('Error extracting HDF5 metadata:', error);
    throw error;
  }
}

// Load specific bands from HDF5 file
export async function parseHDF5Bands(file, metadata, bandNumbers) {
  const h5 = await initializeH5wasm();
  
  try {
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    // Create HDF5 file from buffer using FS approach
    const filename = `/tmp/${file.name}`;
    h5.FS.writeFile(filename, new Uint8Array(fileBuffer));
    const f = new h5.File(filename, 'r');
    
    // Get the main dataset
    const dataset = f.get(metadata.datasetPath);
    
    // Validate band numbers
    const validBandNumbers = bandNumbers.map(band =>
      Math.max(1, Math.min(metadata.bands, Math.floor(band) || 1))
    );
    
    // Read data based on shape format
    const bandData = await readHDF5Bands(dataset, metadata, validBandNumbers);
    
    f.close();
    try {
      h5.FS.unlink(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return bandData;
    
  } catch (error) {
    console.error('Error loading HDF5 bands:', error);
    throw error;
  }
}

// Read band data from HDF5 dataset with selective band loading
// Optimized for BSQ format to match ENVI performance by:
// 1. Reading only requested bands instead of full dataset
// 2. Using parallel band loading with Promise.all()
// 3. Leveraging HDF5 slicing when available for memory efficiency
async function readHDF5Bands(dataset, metadata, bandNumbers) {
  const { samples, lines, bands, shape } = metadata;
  const bandData = new Array(bandNumbers.length);
  
  try {
    // Determine data layout
    const isSpectralFirst = shape[0] === bands;
    
    // Pre-allocate output arrays
    for (let i = 0; i < bandNumbers.length; i++) {
      bandData[i] = new Array(lines);
      for (let line = 0; line < lines; line++) {
        bandData[i][line] = new Uint16Array(samples);
      }
    }
    
    if (isSpectralFirst) {
      // [bands, lines, samples] format - BSQ layout
      // Load bands in parallel like ENVI implementation
      const readPromises = bandNumbers.map(async (bandNumber, i) => {
        const bandIndex = bandNumber - 1; // Convert to 0-based
        
        try {
          // For BSQ format, read only the specific band slice
          // h5wasm allows selective reading via slice notation
          let bandSlice;
          
          try {
            // Try to use HDF5 slicing if available (more memory efficient)
            bandSlice = dataset.slice([bandIndex, 0, 0], [1, lines, samples]);
            // Flatten the result since we only want one band
            bandSlice = bandSlice.flat();
          } catch (sliceError) {
            // Fallback to reading full dataset and slicing
            const fullData = dataset.value;
            const bandStart = bandIndex * lines * samples;
            const bandEnd = bandStart + lines * samples;
            bandSlice = fullData.slice(bandStart, bandEnd);
          }
          
          // Process band data line by line using subarray views for efficiency
          for (let line = 0; line < lines; line++) {
            const lineStart = line * samples;
            const lineEnd = lineStart + samples;
            const lineData = bandSlice.subarray ? 
              bandSlice.subarray(lineStart, lineEnd) : 
              bandSlice.slice(lineStart, lineEnd);
            
            // Validate and copy line data efficiently
            for (let sample = 0; sample < samples; sample++) {
              let value = lineData[sample];
              if (!isValidPixelValue(value, metadata)) {
                value = 0;
              }
              bandData[i][line][sample] = value;
            }
          }
        } catch (error) {
          console.error(`Error reading band ${bandNumber}:`, error);
          // Fill with zeros on error
          for (let line = 0; line < lines; line++) {
            bandData[i][line].fill(0);
          }
        }
      });
      
      // Wait for all bands to load in parallel
      await Promise.all(readPromises);
      
    } else {
      // [lines, samples, bands] format - BIP/BIL layout
      // For non-BSQ layouts, we need to read more of the dataset
      // This is less efficient but necessary for the data layout
      const fullData = dataset.value;
      
      for (let i = 0; i < bandNumbers.length; i++) {
        const bandIndex = bandNumbers[i] - 1; // Convert to 0-based
        
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            // [lines, samples, bands] format
            const value = fullData[line * samples * bands + sample * bands + bandIndex];
            
            // Validate pixel value
            if (!isValidPixelValue(value, metadata)) {
              bandData[i][line][sample] = 0;
            } else {
              bandData[i][line][sample] = value;
            }
          }
        }
      }
    }
    
    return bandData;
    
  } catch (error) {
    console.error('Error reading HDF5 band data:', error);
    throw error;
  }
}

// Extract spectral profile for a single pixel from HDF5 file
export async function extractHDF5PixelSpectrum(file, metadata, x, y) {
  const h5 = await initializeH5wasm();
  
  try {
    // Bounds check
    if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) {
      throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
    }
    
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    // Create HDF5 file from buffer using FS approach
    const filename = `/tmp/${file.name}`;
    h5.FS.writeFile(filename, new Uint8Array(fileBuffer));
    const f = new h5.File(filename, 'r');
    
    // Get the main dataset
    const dataset = f.get(metadata.datasetPath);
    
    // Read pixel spectrum
    const spectrum = await readHDF5PixelSpectrum(dataset, metadata, x, y);
    
    f.close();
    try {
      h5.FS.unlink(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return spectrum;
    
  } catch (error) {
    console.error('Error extracting HDF5 pixel spectrum:', error);
    throw error;
  }
}

// Read spectral profile for a single pixel with optimized data access
async function readHDF5PixelSpectrum(dataset, metadata, x, y) {
  const { samples, lines, bands, shape, wavelengthValues } = metadata;
  const spectrum = [];
  
  try {
    // Determine data layout
    const isSpectralFirst = shape[0] === bands;
    
    if (isSpectralFirst) {
      // [bands, lines, samples] format - BSQ layout
      // Try to read only the required pixel column across all bands
      let pixelData;
      
      try {
        // Try to use HDF5 slicing to read just the pixel column
        pixelData = dataset.slice([0, y, x], [bands, 1, 1]);
        // Flatten to get 1D array of band values
        pixelData = pixelData.flat();
      } catch (sliceError) {
        // Fallback to full dataset read if slicing not available
        const fullData = dataset.value;
        pixelData = new Array(bands);
        
        for (let band = 0; band < bands; band++) {
          pixelData[band] = fullData[band * lines * samples + y * samples + x];
        }
      }
      
      // Build spectrum from pixel data
      for (let band = 0; band < bands; band++) {
        let value = pixelData[band];
        
        // Validate pixel value
        if (!isValidPixelValue(value, metadata)) {
          value = 0;
        }
        
        const wavelength = wavelengthValues ? wavelengthValues[band] : band + 1;
        
        spectrum.push({
          band: band + 1,
          wavelength,
          value
        });
      }
      
    } else {
      // [lines, samples, bands] format - BIP/BIL layout
      // For non-BSQ layouts, we need to read the specific line or full dataset
      let pixelData;
      
      try {
        // Try to read just the required pixel
        pixelData = dataset.slice([y, x, 0], [1, 1, bands]);
        pixelData = pixelData.flat();
      } catch (sliceError) {
        // Fallback to full dataset read
        const fullData = dataset.value;
        pixelData = new Array(bands);
        
        for (let band = 0; band < bands; band++) {
          pixelData[band] = fullData[y * samples * bands + x * bands + band];
        }
      }
      
      // Build spectrum from pixel data
      for (let band = 0; band < bands; band++) {
        let value = pixelData[band];
        
        // Validate pixel value
        if (!isValidPixelValue(value, metadata)) {
          value = 0;
        }
        
        const wavelength = wavelengthValues ? wavelengthValues[band] : band + 1;
        
        spectrum.push({
          band: band + 1,
          wavelength,
          value
        });
      }
    }
    
    return spectrum;
    
  } catch (error) {
    console.error('Error reading HDF5 pixel spectrum:', error);
    throw error;
  }
}