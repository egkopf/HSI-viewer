import npyjs from 'npyjs';

/**
 * Parse NPY file header only to extract metadata without loading full data
 */
async function parseNpyHeader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        const buffer = e.target.result;
        const view = new Uint8Array(buffer);
        
        // Check magic number: \x93NUMPY
        const magic = Array.from(view.slice(0, 6))
          .map(x => String.fromCharCode(x))
          .join('');
        
        if (magic !== '\x93NUMPY') {
          throw new Error('Invalid NPY file: incorrect magic number');
        }
        
        // Read version (bytes 6-7)
        const majorVersion = view[6];
        const minorVersion = view[7];
        console.log(`NPY version: ${majorVersion}.${minorVersion}`);
        
        // Read header length (bytes 8-9, little-endian uint16)
        const headerLen = view[8] | (view[9] << 8);
        console.log(`Header length: ${headerLen} bytes`);
        
        // Check if we need to read more data for the header
        if (10 + headerLen > view.length) {
          throw new Error(`Header extends beyond read data. Need ${10 + headerLen} bytes, have ${view.length}`);
        }
        
        // Read header dictionary (ASCII string)
        const headerBytes = view.slice(10, 10 + headerLen);
        const headerString = Array.from(headerBytes)
          .map(x => String.fromCharCode(x))
          .join('')
          .trim();
        
        console.log('Raw header string:', headerString);
        
        // Parse the Python dictionary literal
        // Handle Python format: {'shape': (100, 200, 50), 'fortran_order': False, 'descr': '<f4'}
        const shapeMatch = headerString.match(/['"]?shape['"]?\s*:\s*\(([^)]*)\)/);
        const descrMatch = headerString.match(/['"]?descr['"]?\s*:\s*['"]([^'"]+)['"]/);
        const fortranMatch = headerString.match(/['"]?fortran_order['"]?\s*:\s*(True|False)/);
        
        if (!shapeMatch || !descrMatch) {
          throw new Error(`Could not parse NPY header dictionary: ${headerString}`);
        }
        
        // Parse shape tuple - handle both (100, 200, 50) and (100,) formats
        const shapeStr = shapeMatch[1].trim();
        let shape;
        if (shapeStr === '') {
          shape = []; // Empty shape for scalar
        } else {
          shape = shapeStr.split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => parseInt(s, 10))
            .filter(n => !isNaN(n));
        }
        
        const headerDict = {
          shape: shape,
          descr: descrMatch[1],
          fortran_order: fortranMatch ? fortranMatch[1] === 'True' : false
        };
        
        console.log('Parsed header dictionary:', headerDict);
        
        resolve({
          shape: headerDict.shape,
          dtype: headerDict.descr,
          fortran_order: headerDict.fortran_order,
          version: `${majorVersion}.${minorVersion}`,
          headerLength: headerLen,
          dataOffset: 10 + headerLen
        });
        
      } catch (error) {
        console.error('Error parsing NPY header:', error);
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    // Read first 2KB which should be enough for most NPY headers
    // Headers are typically much smaller, but this ensures we get the full header
    const headerSlice = file.slice(0, Math.min(2048, file.size));
    reader.readAsArrayBuffer(headerSlice);
  });
}

/**
 * Parse NPY file structure to create a tree-like structure compatible with existing file parsers
 * Now uses header-only parsing for extremely fast analysis of large files!
 */
export async function parseNpyStructure(file) {
  const startTime = performance.now();
  
  try {
    const fileSizeMB = file.size / 1024 / 1024;
    console.log(`🚀 Fast NPY header parsing for ${fileSizeMB.toFixed(1)}MB file`);
    
    // Parse only the header - much faster for large files!
    const headerInfo = await parseNpyHeader(file);
    const { shape, dtype } = headerInfo;
    
    console.log('📊 NPY header parsed successfully in', (performance.now() - startTime).toFixed(2) + 'ms');
    console.log('Header info:', headerInfo);
    
    // Validate that we have the required data
    if (!shape || !Array.isArray(shape) || shape.length === 0) {
      throw new Error(`Invalid NPY file structure. Expected shape array, got: ${typeof shape} - ${JSON.stringify(shape)}`);
    }
    
    if (!dtype) {
      throw new Error(`Invalid NPY file structure. Missing data type information.`);
    }
    
    const dataSize = shape.reduce((a, b) => a * b, 1);
    
    console.log('NPY file details:', {
      shape,
      dtype,
      dataSize: dataSize.toLocaleString()
    });
    
    // Create a structure that mimics the format expected by the UI
    // For hyperspectral data, we expect 3D arrays with shape [height, width, bands] or similar
    const structure = {
      name: file.name,
      type: 'root',
      path: '/',
      children: [],
      parsingTime: performance.now() - startTime,
      efficiency: 'Header-only parsing - blazing fast!',
      isHeaderOnly: true,
      npyMetadata: {
        shape,
        dtype,
        dataSize,
        ...headerInfo
      }
    };
    
    // Create virtual datasets based on the array structure
    if (shape.length === 3) {
      // Assume hyperspectral format: [height, width, bands] or [bands, height, width]
      const [dim1, dim2, dim3] = shape;
      
      // Try to determine which dimension represents bands (spectral channels)
      // Usually the smallest dimension is bands for hyperspectral data
      let bandsIndex = 0;
      let minDim = dim1;
      if (dim2 < minDim) {
        bandsIndex = 1;
        minDim = dim2;
      }
      if (dim3 < minDim) {
        bandsIndex = 2;
      }
      
      // Create hyperspectral data dataset
      const hyperDataset = {
        name: 'hyperspectral_data',
        type: 'dataset',
        path: '/hyperspectral_data',
        shape: shape,
        dtype: dtype,
        isReflectanceCandidate: true,
        description: `Hyperspectral data array (${shape.join(' × ')})`
      };
      
      // Create wavelength dataset (virtual - will be generated)
      const wavelengthDataset = {
        name: 'wavelengths',
        type: 'dataset', 
        path: '/wavelengths',
        shape: [shape[bandsIndex]],
        dtype: 'float64',
        isWavelengthCandidate: true,
        description: `Wavelength values (${shape[bandsIndex]} bands)`,
        isVirtual: true // This indicates it needs to be generated
      };
      
      structure.children = [hyperDataset, wavelengthDataset];
      
    } else if (shape.length === 1) {
      // 1D array - could be wavelengths or single spectrum
      const dataset = {
        name: 'data_array',
        type: 'dataset',
        path: '/data_array',
        shape: shape,
        dtype: dtype,
        isWavelengthCandidate: shape[0] > 10, // Assume wavelengths if many values
        description: `1D data array (${shape[0]} values)`
      };
      
      structure.children = [dataset];
      
    } else if (shape.length === 2) {
      // 2D array - could be single band image or spectra collection
      const dataset = {
        name: 'data_matrix',
        type: 'dataset',
        path: '/data_matrix', 
        shape: shape,
        dtype: dtype,
        isReflectanceCandidate: true,
        description: `2D data matrix (${shape.join(' × ')})`
      };
      
      structure.children = [dataset];
      
    } else {
      // Other dimensions - create generic dataset
      const dataset = {
        name: 'data_array',
        type: 'dataset',
        path: '/data_array',
        shape: shape,
        dtype: dtype,
        description: `${shape.length}D data array (${shape.join(' × ')})`
      };
      
      structure.children = [dataset];
    }
    
    return structure;
    
  } catch (error) {
    console.error('Error parsing NPY file:', error);
    throw new Error(`Failed to parse NPY file: ${error.message}`);
  }
}

/**
 * Helper function to read specific bytes from a NPY file
 */
async function readNpyFileBytes(file, start, length) {
  const slice = file.slice(start, start + length);
  return await slice.arrayBuffer();
}

/**
 * Helper function to create typed arrays from NPY data based on dtype
 */
function createNpyTypedArray(buffer, dtype) {
  const view = new DataView(buffer);
  const isLittleEndian = dtype.startsWith('<') || (!dtype.startsWith('>') && !dtype.startsWith('|'));
  
  // Remove endianness prefix and get base type
  const baseType = dtype.replace(/^[<>|]/, '');
  
  switch (baseType) {
    case 'u1': return new Uint8Array(buffer);
    case 'i1': return new Int8Array(buffer);
    case 'u2': return new Uint16Array(buffer);
    case 'i2': return new Int16Array(buffer);
    case 'u4': return new Uint32Array(buffer);
    case 'i4': return new Int32Array(buffer);
    case 'f4': return new Float32Array(buffer);
    case 'f8': return new Float64Array(buffer);
    default:
      console.warn(`Unknown NPY dtype: ${dtype}, defaulting to Uint16Array`);
      return new Uint16Array(buffer);
  }
}

/**
 * Get the byte size for a given NPY dtype
 */
function getNpyDtypeSize(dtype) {
  const baseType = dtype.replace(/^[<>|]/, '');
  const sizeMap = {
    'u1': 1, 'i1': 1,  // 8-bit
    'u2': 2, 'i2': 2,  // 16-bit
    'u4': 4, 'i4': 4, 'f4': 4,  // 32-bit
    'u8': 8, 'i8': 8, 'f8': 8   // 64-bit
  };
  return sizeMap[baseType] || 2; // Default to 2 bytes
}

/**
 * Load specific bands from NPY hyperspectral data without loading the entire file
 * This is similar to how ENVI selective band reading works
 * @exported
 */
export async function loadNpySpecificBands(file, npyMetadata, bandNumbers) {
  const { shape, dtype, dataOffset } = npyMetadata;
  const [dim1, dim2, dim3] = shape;
  
  console.log(`🎯 NPY Selective Band Loading: ${bandNumbers.length} bands from ${(file.size / 1024 / 1024).toFixed(1)}MB file`);
  
  // Determine data layout - find which dimension is likely bands
  let bandsIndex = 0;
  let heightIndex = 1;
  let widthIndex = 2;
  
  // Find smallest dimension (likely bands for hyperspectral)
  if (dim2 < dim1 && dim2 < dim3) {
    bandsIndex = 1;
    heightIndex = 0;
    widthIndex = 2;
  } else if (dim3 < dim1 && dim3 < dim2) {
    bandsIndex = 2;
    heightIndex = 0;
    widthIndex = 1;
  }
  
  const bands = shape[bandsIndex];
  const height = shape[heightIndex];
  const width = shape[widthIndex];
  const bytesPerElement = getNpyDtypeSize(dtype);
  
  console.log(`📊 Detected layout: ${bands} bands, ${height}×${width} spatial`);
  console.log(`🔍 Loading bands: ${bandNumbers.join(', ')}`);
  
  // Validate band numbers
  const validBandNumbers = bandNumbers.map(band =>
    Math.max(1, Math.min(bands, Math.floor(band) || 1))
  );
  
  const bandData = new Array(validBandNumbers.length);
  
  // Determine the most likely data layout for NPY hyperspectral data
  // Most common layouts: [height, width, bands] or [bands, height, width]
  
  if (bandsIndex === 2) {
    // Layout: [height, width, bands] - Band Interleaved by Pixel (BIP)
    console.log('📐 Using [height, width, bands] layout (BIP-like)');
    
    // For BIP layout, we need to read data line by line and extract specific bands
    const pixelsPerLine = width;
    const bandsPerPixel = bands;
    const bytesPerLine = pixelsPerLine * bandsPerPixel * bytesPerElement;
    
    // Pre-allocate band arrays
    for (let i = 0; i < validBandNumbers.length; i++) {
      bandData[i] = new Array(height);
      for (let line = 0; line < height; line++) {
        bandData[i][line] = createNpyTypedArray(new ArrayBuffer(width * bytesPerElement), dtype);
      }
    }
    
    // Read line by line and extract bands
    for (let line = 0; line < height; line++) {
      const lineStartByte = dataOffset + (line * bytesPerLine);
      const lineBuffer = await readNpyFileBytes(file, lineStartByte, bytesPerLine);
      const lineData = createNpyTypedArray(lineBuffer, dtype);
      
      // Extract specific bands from this line
      for (let pixel = 0; pixel < width; pixel++) {
        const pixelBase = pixel * bandsPerPixel;
        
        for (let i = 0; i < validBandNumbers.length; i++) {
          const bandNumber = validBandNumbers[i];
          const bandIndex = bandNumber - 1;
          bandData[i][line][pixel] = lineData[pixelBase + bandIndex];
        }
      }
      
      // Yield to browser occasionally to prevent blocking
      if (line % 100 === 0 && line > 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
  } else if (bandsIndex === 0) {
    // Layout: [bands, height, width] - Band Sequential (BSQ-like)
    console.log('📐 Using [bands, height, width] layout (BSQ-like)');
    
    const totalPixelsPerBand = height * width;
    const bandSizeBytes = totalPixelsPerBand * bytesPerElement;
    
    // Pre-allocate band arrays
    for (let i = 0; i < validBandNumbers.length; i++) {
      bandData[i] = new Array(height);
    }
    
    // Read bands in parallel for maximum efficiency
    const readPromises = validBandNumbers.map(async (bandNumber, i) => {
      const bandIndex = bandNumber - 1;
      const bandStartByte = dataOffset + (bandIndex * bandSizeBytes);
      
      console.log(`📖 Reading band ${bandNumber} from byte ${bandStartByte.toLocaleString()}`);
      
      // Read entire band in one operation
      const bandBuffer = await readNpyFileBytes(file, bandStartByte, bandSizeBytes);
      const rawBandData = createNpyTypedArray(bandBuffer, dtype);
      
      // Organize into 2D array [height][width]
      for (let line = 0; line < height; line++) {
        const lineStart = line * width;
        bandData[i][line] = rawBandData.slice(lineStart, lineStart + width);
      }
      
      console.log(`✅ Band ${bandNumber} loaded successfully`);
    });
    
    await Promise.all(readPromises);
    
  } else {
    // Layout: [height, bands, width] - Band Interleaved by Line (BIL-like)
    console.log('📐 Using [height, bands, width] layout (BIL-like)');
    
    const bandsPerLine = bands;
    const pixelsPerBand = width;
    const bytesPerBandLine = pixelsPerBand * bytesPerElement;
    const bytesPerLine = bandsPerLine * bytesPerBandLine;
    
    // Pre-allocate band arrays
    for (let i = 0; i < validBandNumbers.length; i++) {
      bandData[i] = new Array(height);
      for (let line = 0; line < height; line++) {
        bandData[i][line] = createNpyTypedArray(new ArrayBuffer(width * bytesPerElement), dtype);
      }
    }
    
    // Read line by line
    for (let line = 0; line < height; line++) {
      const lineStartByte = dataOffset + (line * bytesPerLine);
      
      // Read only the specific bands we need from this line
      for (let i = 0; i < validBandNumbers.length; i++) {
        const bandNumber = validBandNumbers[i];
        const bandIndex = bandNumber - 1;
        const bandLineStartByte = lineStartByte + (bandIndex * bytesPerBandLine);
        
        const bandLineBuffer = await readNpyFileBytes(file, bandLineStartByte, bytesPerBandLine);
        const bandLineData = createNpyTypedArray(bandLineBuffer, dtype);
        
        bandData[i][line] = bandLineData;
      }
      
      // Yield to browser occasionally
      if (line % 50 === 0 && line > 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
  
  console.log(`🎉 Selective band loading complete: ${validBandNumbers.length} bands loaded`);
  return bandData;
}

/**
 * Load data from NPY file for a specific dataset path
 * Now supports both full loading and selective band loading
 */
export async function loadNpyVariable(file, datasetPath, options = {}) {
  try {
    const fileSizeMB = file.size / 1024 / 1024;
    console.log(`Loading NPY variable from ${fileSizeMB.toFixed(1)}MB file`);
    
    // For wavelength datasets, generate synthetic values
    if (datasetPath === '/wavelengths') {
      // Get header info to determine number of bands
      const headerInfo = await parseNpyHeader(file);
      const { shape } = headerInfo;
      
      if (shape.length === 3) {
        // Find the smallest dimension (likely to be bands)
        let bandsIndex = 0;
        let minDim = shape[0];
        if (shape[1] < minDim) {
          bandsIndex = 1;
          minDim = shape[1];
        }
        if (shape[2] < minDim) {
          bandsIndex = 2;
        }
        
        const numBands = shape[bandsIndex];
        
        // Generate basic wavelength values
        const wavelengths = new Float64Array(numBands);
        for (let i = 0; i < numBands; i++) {
          wavelengths[i] = 400 + (i * (2100 / numBands));
        }
        
        console.warn('Generated synthetic wavelength values. For accurate analysis, provide actual wavelength data.');
        
        return {
          data: wavelengths,
          shape: [numBands],
          dtype: 'float64',
          attributes: {
            description: 'Generated wavelength values (nm)',
            note: 'These are synthetic values - replace with actual wavelength data for accurate analysis'
          }
        };
      } else {
        throw new Error('Cannot generate wavelengths for non-3D hyperspectral data');
      }
    }
    
    // For hyperspectral data, check if we should use selective loading
    if (options.selectiveBands && Array.isArray(options.selectiveBands)) {
      console.log('🎯 Using selective band loading for NPY file');
      
      // Get header info for selective loading
      const headerInfo = await parseNpyHeader(file);
      const bandData = await loadNpySpecificBands(file, headerInfo, options.selectiveBands);
      
      return {
        data: bandData,
        shape: headerInfo.shape,
        dtype: headerInfo.dtype,
        attributes: {
          description: `NPY selective bands: ${options.selectiveBands.join(', ')}`,
          shape: headerInfo.shape,
          dtype: headerInfo.dtype,
          bandsLoaded: options.selectiveBands
        }
      };
    }
    
    // Fallback to full file loading for small files or when selective loading not requested
    if (fileSizeMB > 500) {
      console.warn(`⚠️  Loading full data from large NPY file (${fileSizeMB.toFixed(1)}MB). Consider using selective band loading.`);
    }
    
    // Create npyjs instance for full loading
    const npyReader = new npyjs();
    
    const result = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          if (fileSizeMB > 100) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          console.log('Starting NPY full data loading...');
          const npyArray = await npyReader.load(e.target.result);
          console.log('NPY full data loading completed');
          resolve(npyArray);
        } catch (error) {
          console.error('NPY data loading failed:', error);
          reject(error);
        }
      };
      reader.onerror = (e) => {
        console.error('FileReader error:', e);
        reject(new Error('Failed to read NPY file'));
      };
      reader.readAsArrayBuffer(file);
    });
    
    const { data, shape, dtype } = result;
    
    console.log(`Loaded NPY dataset: ${datasetPath}`);
    console.log('Data shape:', shape, 'dtype:', dtype);
    
    return {
      data: data,
      shape: shape,
      dtype: dtype,
      attributes: {
        description: `NPY data array`,
        shape: shape,
        dtype: dtype
      }
    };
    
  } catch (error) {
    console.error('Error loading NPY variable:', error);
    throw new Error(`Failed to load NPY data: ${error.message}`);
  }
}

/**
 * Extract full spectrum for a specific pixel from NPY hyperspectral data
 * This loads the full spectrum on-demand for pixel analysis
 */
export async function extractNpyPixelSpectrum(file, npyMetadata, x, y, wavelengthData) {
  const { shape, dtype, dataOffset } = npyMetadata;
  
  // Determine data layout
  let bandsIndex = 0;
  let heightIndex = 1;
  let widthIndex = 2;
  
  // Find smallest dimension (likely bands for hyperspectral)
  if (shape[1] < shape[0] && shape[1] < shape[2]) {
    bandsIndex = 1;
    heightIndex = 0;
    widthIndex = 2;
  } else if (shape[2] < shape[0] && shape[2] < shape[1]) {
    bandsIndex = 2;
    heightIndex = 0;
    widthIndex = 1;
  }
  
  const bands = shape[bandsIndex];
  const height = shape[heightIndex];
  const width = shape[widthIndex];
  const bytesPerElement = getNpyDtypeSize(dtype);
  
  console.log(`🎯 Extracting NPY pixel spectrum at (${x}, ${y}) - ${bands} bands`);
  
  // Bounds check
  if (x < 0 || x >= width || y < 0 || y >= height) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds (${width}×${height})`);
  }
  
  const spectrum = [];
  
  if (bandsIndex === 2) {
    // Layout: [height, width, bands] - BIP-like
    const pixelStartByte = dataOffset + ((y * width + x) * bands * bytesPerElement);
    const pixelSizeBytes = bands * bytesPerElement;
    
    console.log(`📖 Reading BIP pixel data from byte ${pixelStartByte.toLocaleString()}`);
    
    const pixelBuffer = await readNpyFileBytes(file, pixelStartByte, pixelSizeBytes);
    const pixelData = createNpyTypedArray(pixelBuffer, dtype);
    
    for (let band = 0; band < bands; band++) {
      const value = pixelData[band];
      const wavelength = wavelengthData?.values?.[band] || 400 + (band * (2100 / bands));
      
      spectrum.push({
        band: band + 1,
        wavelength,
        value
      });
    }
    
  } else if (bandsIndex === 0) {
    // Layout: [bands, height, width] - BSQ-like
    console.log(`📖 Reading BSQ pixel data for ${bands} bands`);
    
    const totalPixelsPerBand = height * width;
    const pixelOffsetInBand = y * width + x;
    
    // Read each band's value for this pixel
    for (let band = 0; band < bands; band++) {
      const bandStartByte = dataOffset + (band * totalPixelsPerBand * bytesPerElement);
      const pixelByte = bandStartByte + (pixelOffsetInBand * bytesPerElement);
      
      const valueBuffer = await readNpyFileBytes(file, pixelByte, bytesPerElement);
      const valueArray = createNpyTypedArray(valueBuffer, dtype);
      const value = valueArray[0];
      
      const wavelength = wavelengthData?.values?.[band] || 400 + (band * (2100 / bands));
      
      spectrum.push({
        band: band + 1,
        wavelength,
        value
      });
    }
    
  } else {
    // Layout: [height, bands, width] - BIL-like
    console.log(`📖 Reading BIL pixel data from line ${y}`);
    
    const lineStartByte = dataOffset + (y * bands * width * bytesPerElement);
    const lineSizeBytes = bands * width * bytesPerElement;
    
    // Read the entire line
    const lineBuffer = await readNpyFileBytes(file, lineStartByte, lineSizeBytes);
    const lineData = createNpyTypedArray(lineBuffer, dtype);
    
    for (let band = 0; band < bands; band++) {
      const bandOffset = band * width + x;
      const value = lineData[bandOffset];
      const wavelength = wavelengthData?.values?.[band] || 400 + (band * (2100 / bands));
      
      spectrum.push({
        band: band + 1,
        wavelength,
        value
      });
    }
  }
  
  // Debug: Show value range for debugging y-axis scaling issues
  if (spectrum.length > 0) {
    const values = spectrum.map(s => s.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    console.log(`✅ Extracted spectrum with ${spectrum.length} bands`);
    console.log(`📊 Value range: ${minVal.toFixed(2)} to ${maxVal.toFixed(2)}`);
    console.log(`🔍 Sample values: [${values.slice(0, 5).map(v => v.toFixed(2)).join(', ')}...]`);
  }
  
  return spectrum;
}

/**
 * Validate NPY file for hyperspectral data compatibility
 */
export function validateNpyForHyperspectral(npyMetadata) {
  const { shape, dtype } = npyMetadata;
  
  // Check if it's a valid multidimensional array
  if (shape.length < 2) {
    return {
      valid: false,
      message: 'NPY file must contain at least 2D data for hyperspectral processing'
    };
  }
  
  // Check data type compatibility
  const supportedTypes = ['uint8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'float64'];
  if (!supportedTypes.some(type => dtype.includes(type))) {
    return {
      valid: false,
      message: `Unsupported data type: ${dtype}. Supported types: ${supportedTypes.join(', ')}`
    };
  }
  
  // Check data size (warn for very large arrays)
  const dataSize = shape.reduce((a, b) => a * b, 1);
  if (dataSize > 100_000_000) { // 100M elements
    return {
      valid: true,
      warning: `Large array detected (${dataSize.toLocaleString()} elements). Processing may be slow.`
    };
  }
  
  return {
    valid: true,
    message: 'NPY file appears compatible with hyperspectral data processing'
  };
}