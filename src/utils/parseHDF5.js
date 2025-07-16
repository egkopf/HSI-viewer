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
      console.log('No common dataset path found, searching root keys:', rootKeys);
      for (const key of rootKeys) {
        try {
          const item = file.get(key);
          console.log(`Checking root key '${key}':`, { hasShape: !!item.shape, shape: item.shape, size: item.size });
          if (item.shape && item.shape.length === 3) {
            // Check if this is larger than current candidate
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
    
    // Debug: Log the final dataset path
    console.log('Final dataset path selected:', datasetPath);
    console.log('Main dataset shape:', mainDataset.shape);
    
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
    
    // Debug: Log metadata construction
    console.log('Metadata constructed with datasetPath:', metadata.datasetPath);
    console.log('Metadata shape:', metadata.shape);
    metadata.wavelengthValues = wavelengthValues;
    metadata.wavelengthUnits = units;
    metadata.dataIgnoreValue = dataIgnoreValue;
    metadata["data ignore value"] = dataIgnoreValue; // For compatibility with ENVI parser
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
    
    // Debug: Log metadata structure
    console.log('parseHDF5Bands called with metadata:', metadata);
    console.log('Metadata shape:', metadata.shape);
    console.log('Metadata dimensions:', { samples: metadata.samples, lines: metadata.lines, bands: metadata.bands });
    
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
// Optimized to match ENVI streaming performance by:
// 1. Using h5wasm dataset slicing for memory efficiency
// 2. Reading only requested bands instead of full dataset
// 3. Using parallel band loading with Promise.all()
// 4. Avoiding full dataset loading for large files
async function readHDF5Bands(dataset, metadata, bandNumbers) {
  const { samples, lines, bands, shape } = metadata;
  const bandData = new Array(bandNumbers.length);
  
  // Validate metadata structure and reconstruct shape if missing
  let reconstructedShape = shape;
  
  if (!samples || !lines || !bands) {
    console.error('Invalid metadata structure - missing dimensions:', { samples, lines, bands });
    throw new Error('Invalid metadata: missing samples, lines, or bands dimensions');
  }
  
  if (!reconstructedShape || !Array.isArray(reconstructedShape) || reconstructedShape.length < 3) {
    console.warn('Shape missing from metadata, reconstructing from dimensions');
    // For HDF5 hyperspectral data, the typical format is [bands, lines, samples] (BSQ)
    reconstructedShape = [bands, lines, samples];
    console.log('Reconstructed shape:', reconstructedShape);
  }
  
  try {
    // Determine data layout
    const isSpectralFirst = reconstructedShape[0] === bands;
    
    // Pre-allocate output arrays
    for (let i = 0; i < bandNumbers.length; i++) {
      bandData[i] = new Array(lines);
      for (let line = 0; line < lines; line++) {
        bandData[i][line] = new Uint16Array(samples);
      }
    }
    
    if (isSpectralFirst) {
      // [bands, lines, samples] format - BSQ layout
      // Use HDF5 slicing for efficient band reading (similar to ENVI BSQ approach)
      console.log(`Reading ${bandNumbers.length} bands in BSQ format using HDF5 slicing`);
      
      const readPromises = bandNumbers.map(async (bandNumber, i) => {
        const bandIndex = bandNumber - 1; // Convert to 0-based
        
        try {
          // Use HDF5 slicing to read only the specific band
          // This is memory efficient and doesn't require loading the full dataset
          const bandSlice = dataset.slice([bandIndex, 0, 0], [1, lines, samples]);
          
          // Process the band slice data line by line
          for (let line = 0; line < lines; line++) {
            for (let sample = 0; sample < samples; sample++) {
              // For BSQ format with shape [1, lines, samples], index is [0, line, sample]
              let value = bandSlice[line * samples + sample];
              
              // Validate and filter pixel values
              if (!isValidPixelValue(value, metadata)) {
                value = 0;
              }
              
              bandData[i][line][sample] = value;
            }
          }
          
        } catch (error) {
          console.error(`Error reading band ${bandNumber} with slicing:`, error);
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
      // For non-BSQ layouts, we need to read line by line to avoid full dataset loading
      console.log(`Reading ${bandNumbers.length} bands in BIP/BIL format using line-by-line slicing`);
      
      const bandIndices = bandNumbers.map(b => b - 1);
      
      // Process one line at a time to avoid memory issues
      for (let line = 0; line < lines; line++) {
        try {
          // Read entire line: [line, 0, 0] to [line+1, samples, bands]
          const lineSlice = dataset.slice([line, 0, 0], [1, samples, bands]);
          
          // Extract requested bands from this line
          for (let sample = 0; sample < samples; sample++) {
            for (let i = 0; i < bandNumbers.length; i++) {
              const bandIndex = bandIndices[i];
              
              // For BIP format: [line, sample, band]
              let value = lineSlice[sample * bands + bandIndex];
              
              // Validate pixel value
              if (!isValidPixelValue(value, metadata)) {
                value = 0;
              }
              
              bandData[i][line][sample] = value;
            }
          }
          
        } catch (error) {
          console.error(`Error reading line ${line}:`, error);
          // Fill line with zeros on error
          for (let i = 0; i < bandNumbers.length; i++) {
            bandData[i][line].fill(0);
          }
        }
        
        // Yield to browser every 100 lines to prevent blocking
        if (line % 100 === 0 && line > 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
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
    // Debug: Log metadata structure
    console.log('extractHDF5PixelSpectrum called with metadata:', metadata);
    console.log('Metadata shape:', metadata.shape);
    console.log('Metadata dimensions:', { samples: metadata.samples, lines: metadata.lines, bands: metadata.bands });
    
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
    
    // Validate dataset path
    if (!metadata.datasetPath) {
      throw new Error('Dataset path is undefined in metadata - file may not have been parsed correctly');
    }
    
    // Get the main dataset
    const dataset = f.get(metadata.datasetPath);
    
    // Validate dataset
    if (!dataset) {
      throw new Error(`Dataset not found at path: ${metadata.datasetPath}`);
    }
    
    console.log('Dataset loaded:', dataset);
    console.log('Dataset shape:', dataset.shape);
    console.log('Dataset dtype:', dataset.dtype);
    console.log('Dataset value available:', dataset.value !== null);
    
    // For large datasets, we might need to force loading or use a different approach
    if (!dataset.value) {
      console.warn('Dataset value is null, trying to force load dataset...');
      try {
        // Try to access the dataset to trigger loading
        const testSlice = dataset.slice([0, 0, 0], [1, 1, 1]);
        console.log('Dataset slice test successful:', testSlice);
      } catch (sliceError) {
        console.error('Dataset slice test failed:', sliceError);
        throw new Error('Dataset cannot be accessed - may be too large or corrupted');
      }
    }
    
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

// Read spectral profile for a single pixel using targeted HDF5 slicing
// Optimized to match ENVI targeted reading approach:
// 1. Uses minimal slicing to read only the required pixel data
// 2. Avoids loading entire dataset into memory
// 3. Handles both BSQ and BIP/BIL layouts efficiently
async function readHDF5PixelSpectrum(dataset, metadata, x, y) {
  const { samples, lines, bands, shape, wavelengthValues } = metadata;
  const spectrum = [];
  
  // Validate metadata structure and reconstruct shape if missing
  let reconstructedShape = shape;
  
  if (!samples || !lines || !bands) {
    console.error('Invalid metadata structure in readHDF5PixelSpectrum - missing dimensions:', { samples, lines, bands });
    throw new Error('Invalid metadata: missing samples, lines, or bands dimensions');
  }
  
  if (!reconstructedShape || !Array.isArray(reconstructedShape) || reconstructedShape.length < 3) {
    console.warn('Shape missing from metadata, reconstructing from dimensions');
    // For HDF5 hyperspectral data, the typical format is [bands, lines, samples] (BSQ)
    reconstructedShape = [bands, lines, samples];
    console.log('Reconstructed shape:', reconstructedShape);
  }
  
  try {
    // Determine data layout
    const isSpectralFirst = reconstructedShape[0] === bands;
    
    if (isSpectralFirst) {
      // [bands, lines, samples] format - BSQ layout
      // Use efficient single-pixel slice across all bands (similar to ENVI BIP pixel read)
      console.log(`Reading pixel spectrum for BSQ layout at (${x}, ${y})`);
      
      try {
        // Try to read the pixel column across all bands in one operation
        // This reads: [0:bands, y:y+1, x:x+1] = [bands, 1, 1]
        const pixelColumn = dataset.slice([0, y, x], [bands, 1, 1]);
        
        // Extract spectrum from the pixel column
        for (let band = 0; band < bands; band++) {
          let value = pixelColumn[band];
          
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
        
      } catch (sliceError) {
        console.warn('BSQ pixel column slice failed, falling back to line read:', sliceError.message);
        
        // Fallback: read the entire line for the pixel Y coordinate across all bands
        try {
          const lineSlice = dataset.slice([0, y, 0], [bands, 1, samples]);
          
          // Extract the specific pixel from each band's line
          for (let band = 0; band < bands; band++) {
            let value = lineSlice[band * samples + x];
            
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
          
        } catch (lineError) {
          console.error('BSQ line read also failed:', lineError.message);
          // Return zero spectrum as final fallback
          for (let band = 0; band < bands; band++) {
            const wavelength = wavelengthValues ? wavelengthValues[band] : band + 1;
            spectrum.push({
              band: band + 1,
              wavelength,
              value: 0
            });
          }
        }
      }
      
    } else {
      // [lines, samples, bands] format - BIP/BIL layout
      // Use targeted pixel read (similar to ENVI BIP approach)
      console.log(`Reading pixel spectrum for BIP/BIL layout at (${x}, ${y})`);
      
      try {
        // Read the specific pixel across all bands: [y:y+1, x:x+1, 0:bands]
        const pixelSlice = dataset.slice([y, x, 0], [1, 1, bands]);
        
        // Extract spectrum from pixel data
        for (let band = 0; band < bands; band++) {
          let value = pixelSlice[band];
          
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
        
      } catch (sliceError) {
        console.warn('BIP/BIL pixel slice failed, falling back to line read:', sliceError.message);
        
        // Fallback: read entire line and extract the pixel
        try {
          const lineSlice = dataset.slice([y, 0, 0], [1, samples, bands]);
          
          // Extract the specific pixel from the line
          for (let band = 0; band < bands; band++) {
            let value = lineSlice[x * bands + band];
            
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
          
        } catch (lineError) {
          console.error('BIP/BIL line read also failed:', lineError.message);
          // Return zero spectrum as final fallback
          for (let band = 0; band < bands; band++) {
            const wavelength = wavelengthValues ? wavelengthValues[band] : band + 1;
            spectrum.push({
              band: band + 1,
              wavelength,
              value: 0
            });
          }
        }
      }
    }
    
    return spectrum;
    
  } catch (error) {
    console.error('Error reading HDF5 pixel spectrum:', error);
    throw error;
  }
}