import { selectDefaultRGBBands } from './bandSelection.js';
import { formatMetadataSummary, getCompactSummary } from './consoleInfo.js';
import { isValidPixelValue } from './dataValidation.js';

// Enhanced parseHDRFile function with better field extraction
export async function parseHDRFile(hdrFile) {
  const text = await hdrFile.text();
  const metadata = {};

  // First pass: extract simple key-value pairs
  let currentKey = null;
  let currentValue = '';
  let inMultilineValue = false;

  text.split('\n').forEach((line) => {
    const trimmedLine = line.trim();

    if (trimmedLine.includes('=') && !inMultilineValue) {
      const [key, value] = trimmedLine.split('=');
      currentKey = key.trim();
      currentValue = value.trim();

      if (currentValue.includes('{') && !currentValue.includes('}')) {
        inMultilineValue = true;
      } else {
        metadata[currentKey] = currentValue;
        currentKey = null;
        currentValue = '';
      }
    } else if (inMultilineValue && currentKey) {
      currentValue += ' ' + trimmedLine;
      if (trimmedLine.includes('}')) {
        metadata[currentKey] = currentValue;
        inMultilineValue = false;
        currentKey = null;
        currentValue = '';
      }
    }
  });

  // Parse wavelength data
  if (metadata.wavelength) {
    try {
      const wavelengthStr = metadata.wavelength.replace(/[{}]/g, '');
      const parsedWavelengths = wavelengthStr.split(',')
        .map(w => parseFloat(w.trim()))
        .filter(w => !isNaN(w));

      const expectedBands = parseInt(metadata.bands, 10);
      if (parsedWavelengths.length === expectedBands) {
        metadata.wavelengthValues = parsedWavelengths;
      } else {
        metadata.wavelengthValues = [];
      }
    } catch (error) {
      console.error('Error parsing wavelength data:', error);
      metadata.wavelengthValues = [];
    }
  }

  // Parse FWHM data
  if (metadata.fwhm) {
    try {
      const fwhmStr = metadata.fwhm.replace(/[{}]/g, '');
      const parsedFwhm = fwhmStr.split(',')
        .map(f => parseFloat(f.trim()))
        .filter(f => !isNaN(f));
      metadata.fwhmValues = parsedFwhm;
    } catch (error) {
      console.error('Error parsing FWHM data:', error);
      metadata.fwhmValues = [];
    }
  }

  // Parse default bands
  if (metadata["default bands"]) {
    try {
      const bandsStr = metadata["default bands"].replace(/[{}]/g, '');
      const parsedBands = bandsStr.split(',')
        .map(b => parseInt(b.trim(), 10))
        .filter(b => !isNaN(b));
      metadata.parsedDefaultBands = parsedBands;
    } catch (error) {
      console.error('Error parsing default bands:', error);
    }
  }

  // Parse map info for geographic data
  if (metadata["map info"]) {
    try {
      const mapStr = metadata["map info"].replace(/[{}]/g, '');
      const mapParts = mapStr.split(',').map(s => s.trim());
      if (mapParts.length >= 7) {
        metadata.mapInfo = {
          projection: mapParts[0],
          referencePixelX: parseFloat(mapParts[1]),
          referencePixelY: parseFloat(mapParts[2]),
          referenceCoordX: parseFloat(mapParts[3]),
          referenceCoordY: parseFloat(mapParts[4]),
          pixelSizeX: parseFloat(mapParts[5]),
          pixelSizeY: parseFloat(mapParts[6]),
          zone: mapParts[7] || null,
          hemisphere: mapParts[8] || null,
          datum: mapParts[9] || null,
          units: mapParts[10] || null
        };
      }
    } catch (error) {
      console.error('Error parsing map info:', error);
    }
  }

  const interleave = metadata.interleave ? metadata.interleave.toLowerCase() : 'bsq';
  
  // Use parsed default bands if available, otherwise use intelligent selection
  const defaultBands = metadata.parsedDefaultBands || selectDefaultRGBBands({
    bands: metadata.bands,
    wavelengthValues: metadata.wavelengthValues
  });
  
  const byteOrder = parseInt(metadata["byte order"], 10);
  const isBigEndian = byteOrder === 1;

  // Parse numeric values with enhanced error checking
  const finalMetadata = {
    ...metadata,
    samples: parseInt(metadata.samples, 10),
    lines: parseInt(metadata.lines, 10),
    bands: parseInt(metadata.bands, 10),
    dataType: parseInt(metadata["data type"], 10),
    interleave: interleave,
    byteOrder: isNaN(byteOrder) ? 0 : byteOrder,
    isBigEndian: isBigEndian,
    defaultBands: defaultBands,
    
    // Enhanced fields
    dataIgnoreValue: parseFloat(metadata["data ignore value"]) || null,
    reflectanceScaleFactor: parseFloat(metadata["reflectance scale factor"]) || null,
    headerOffset: parseInt(metadata["header offset"], 10) || 0,
    
    // Geographic info
    pixelSizeMeters: metadata.mapInfo?.pixelSizeX || null,
    coordinateSystem: metadata.mapInfo?.projection || null
  };

  console.log(formatMetadataSummary(finalMetadata));
  return finalMetadata;
}

// Helper function to read specific bytes from a file
async function readFileBytes(file, start, length) {
  const slice = file.slice(start, start + length);
  return await slice.arrayBuffer();
}

// Helper function to handle endianness when creating typed arrays
function createEndianAwareTypedArray(buffer, isBigEndian, dataType = 12) {
  let typedArray;
  
  // Create the appropriate typed array based on data type
  if (dataType === 2) {
    // 16-bit signed integer
    typedArray = new Int16Array(buffer);
  } else if (dataType === 12) {
    // 16-bit unsigned integer  
    typedArray = new Uint16Array(buffer);
  } else {
    console.warn(`Unsupported data type: ${dataType}, defaulting to Uint16Array`);
    typedArray = new Uint16Array(buffer);
  }
  
  // Handle byte swapping for big-endian data
  if (isBigEndian) {
    const u8 = new Uint8Array(buffer);
    const swappedBuffer = new ArrayBuffer(buffer.byteLength);
    const swappedU8 = new Uint8Array(swappedBuffer);

    // Swap bytes for each 16-bit value
    for (let i = 0; i < u8.length; i += 2) {
      if (i + 1 < u8.length) {
        swappedU8[i] = u8[i + 1];
        swappedU8[i + 1] = u8[i];
      } else {
        swappedU8[i] = u8[i];
      }
    }

    // Create typed array from swapped buffer
    if (dataType === 2) {
      return new Int16Array(swappedBuffer);
    } else {
      return new Uint16Array(swappedBuffer);
    }
  }

  return typedArray;
}
// Calculate byte offset for a specific band/line/sample
function calculateOffset(band, line, sample, metadata) {
  const { samples, lines, bands, interleave } = metadata;
  const bandIndex = band - 1; // Convert to 0-based indexing
  const totalPixels = samples * lines;

  switch (interleave.toLowerCase()) {
    case 'bil': // Band Interleaved by Line
      return ((line * samples * bands) + (bandIndex * samples) + sample) * 2; // *2 for 16-bit
    case 'bip': // Band Interleaved by Pixel
      return ((line * samples * bands) + (sample * bands) + bandIndex) * 2;
    case 'bsq': // Band Sequential (default)
    default:
      return ((bandIndex * totalPixels) + (line * samples) + sample) * 2;
  }
}

// Load only specific bands from the hyperspectral data file using streaming reads
export async function parseSpecificBands(dataFile, metadata, bandNumbers) {
  const { samples, lines, bands, interleave, isBigEndian } = metadata;

  // Validate band numbers
  const validBandNumbers = bandNumbers.map(band =>
    Math.max(1, Math.min(bands, Math.floor(band) || 1))
  );

  // Array of arrays for the requested bands
  const bandData = new Array(validBandNumbers.length);

  // For BSQ format, we can read entire bands efficiently
if (interleave.toLowerCase() === 'bsq') {
  const totalPixels = samples * lines;
  const bytesPerPixel = 2; // 16-bit
  const bandSizeBytes = totalPixels * bytesPerPixel;
  
  // Pre-allocate all band arrays
  for (let i = 0; i < validBandNumbers.length; i++) {
    bandData[i] = new Array(lines);
  }

  // Read all bands in parallel for maximum speed
  const readPromises = validBandNumbers.map(async (bandNumber, i) => {
    const bandIndex = bandNumber - 1;
    const bandStartByte = bandIndex * bandSizeBytes;

    try {
      // Read entire band in one operation
      const bandBuffer = await readFileBytes(dataFile, bandStartByte, bandSizeBytes);
      const rawBandData = createEndianAwareTypedArray(bandBuffer, isBigEndian, metadata.dataType);

      // Fast line assignment using subarray views (zero-copy)
      for (let line = 0; line < lines; line++) {
        const lineStart = line * samples;
        bandData[i][line] = rawBandData.subarray(lineStart, lineStart + samples);
      }
    } catch (error) {
      console.error(`Error reading band ${bandNumber}:`, error);
      throw error;
    }
  });

  // Wait for all bands to finish reading in parallel
  await Promise.all(readPromises);
}
  // For BIL format, read by lines
  else if (interleave.toLowerCase() === 'bil') {
    // Initialize all band arrays
    for (let i = 0; i < validBandNumbers.length; i++) {
      bandData[i] = new Array(lines);
    }

    // Read data line by line
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < validBandNumbers.length; i++) {
        const bandNumber = validBandNumbers[i];
        const bandIndex = bandNumber - 1;

        // Calculate position for this band in this line
        const lineStartByte = line * samples * bands * 2;
        const bandStartByte = lineStartByte + (bandIndex * samples * 2);
        const bandLineSizeBytes = samples * 2;

        // Read this band's data for this line
        const lineBuffer = await readFileBytes(dataFile, bandStartByte, bandLineSizeBytes);
        const rawLineData = createEndianAwareTypedArray(lineBuffer, isBigEndian);

        bandData[i][line] = rawLineData;
      }
    }
  }
  // For BIP format, we need to read by pixels (optimized with chunked reads)
  else {
  // BIP format - Band Interleaved by Pixel
  const bytesPerPixel = 2;
  const bandsPerPixel = bands;
  const pixelsPerLine = samples;
  
  // Pre-allocate all arrays
  for (let i = 0; i < validBandNumbers.length; i++) {
    bandData[i] = new Array(lines);
    for (let line = 0; line < lines; line++) {
      bandData[i][line] = new Uint16Array(samples);
    }
  }

  const bandIndices = validBandNumbers.map(b => b - 1);
  const numRequestedBands = validBandNumbers.length;
  
  // Larger chunks for better I/O efficiency
  const chunkSize = Math.min(128, lines);

  for (let lineStart = 0; lineStart < lines; lineStart += chunkSize) {
    const lineEnd = Math.min(lineStart + chunkSize, lines);
    const linesInChunk = lineEnd - lineStart;
    
    const chunkStartByte = lineStart * pixelsPerLine * bandsPerPixel * bytesPerPixel;
    const chunkSizeBytes = linesInChunk * pixelsPerLine * bandsPerPixel * bytesPerPixel;

    try {
      const chunkBuffer = await readFileBytes(dataFile, chunkStartByte, chunkSizeBytes);
      const rawChunkData = createEndianAwareTypedArray(chunkBuffer, isBigEndian, metadata.dataType);

      // Process each line in the chunk with optimized nested loops
      for (let lineOffset = 0; lineOffset < linesInChunk; lineOffset++) {
        const actualLine = lineStart + lineOffset;
        const lineBaseIndex = lineOffset * pixelsPerLine * bandsPerPixel;
        
        // Pre-fetch line arrays to avoid repeated lookups
        const lineArrays = bandData.map(band => band[actualLine]);
        
        // Process pixels in batches to improve cache locality
        const batchSize = 64;
        for (let sampleStart = 0; sampleStart < pixelsPerLine; sampleStart += batchSize) {
          const sampleEnd = Math.min(sampleStart + batchSize, pixelsPerLine);
          
          for (let sample = sampleStart; sample < sampleEnd; sample++) {
            const pixelBaseIndex = lineBaseIndex + (sample * bandsPerPixel);
            
            // Unroll the inner band loop for better performance
            if (numRequestedBands === 3) {
              // Most common case - RGB
              lineArrays[0][sample] = rawChunkData[pixelBaseIndex + bandIndices[0]];
              lineArrays[1][sample] = rawChunkData[pixelBaseIndex + bandIndices[1]];
              lineArrays[2][sample] = rawChunkData[pixelBaseIndex + bandIndices[2]];
            } else if (numRequestedBands === 1) {
              // Single band case
              lineArrays[0][sample] = rawChunkData[pixelBaseIndex + bandIndices[0]];
            } else {
              // General case for other numbers of bands
              for (let i = 0; i < numRequestedBands; i++) {
                lineArrays[i][sample] = rawChunkData[pixelBaseIndex + bandIndices[i]];
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error reading line chunk ${lineStart}-${lineEnd}:`, error);
      throw error;
    }

    // Progress feedback (less frequent)
    if (lineEnd % (chunkSize * 4) === 0 || lineEnd === lines) {
      console.log(`BIP processing: ${Math.round((lineEnd / lines) * 100)}%`);
    }
  }
  }

  return bandData;
}

// Extract spectral profile for a single pixel using targeted read
export async function extractPixelSpectrum(dataFile, metadata, x, y) {
  const { samples, lines, bands, interleave, isBigEndian } = metadata;

  // Bounds check
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }

  const spectrum = [];
  const wavelengthData = metadata.wavelengthValues || [];

  // For BIP format, all bands for the pixel are contiguous
  if (interleave.toLowerCase() === 'bip') {
    const pixelStartByte = (y * samples * bands + x * bands) * 2;
    const pixelSizeBytes = bands * 2;

    const pixelBuffer = await readFileBytes(dataFile, pixelStartByte, pixelSizeBytes);
const rawPixelData = createEndianAwareTypedArray(pixelBuffer, isBigEndian, metadata.dataType);

    for (let band = 0; band < bands; band++) {
      let value = rawPixelData[band];

      if (!isValidPixelValue(value, metadata)) {
        value = 0;
      }

      const wavelength = wavelengthData[band] || band + 1;

      spectrum.push({
        band: band + 1,
        wavelength,
        value
      });
    }
  }
  // For BSQ and BIL, we need to read each band separately
  else {
    const totalPixels = samples * lines;

    for (let band = 1; band <= bands; band++) {
      let offset;

      if (interleave.toLowerCase() === 'bsq') {
        offset = ((band - 1) * totalPixels + y * samples + x) * 2;
      } else { // BIL
        offset = (y * samples * bands + (band - 1) * samples + x) * 2;
      }

      // Read just 2 bytes for this one value
      const valueBuffer = await readFileBytes(dataFile, offset, 2);
      const rawValue = createEndianAwareTypedArray(valueBuffer, isBigEndian, metadata.dataType);
      let value = rawValue[0];

      if (!isValidPixelValue(value, metadata)) {
        value = 0;
      }

      const wavelength = wavelengthData[band - 1] || band;

      spectrum.push({
        band,
        wavelength,
        value
      });
    }
  }

  return spectrum;
}