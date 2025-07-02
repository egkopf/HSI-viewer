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

  // Memory-optimized BIP processing with smaller chunks and yielding

else {
  // BIP format - Band Interleaved by Pixel (MEMORY OPTIMIZED)
  console.log(`🚀 BIP processing: ${samples}×${lines}, ${bands} bands → extracting ${validBandNumbers.length} bands`);
  
  const startTime = performance.now();
  const bytesPerPixel = 2;
  const bandsPerPixel = bands;
  const pixelsPerLine = samples;
  const totalPixels = samples * lines;
  
  // OPTIMIZATION 1: Much smaller chunks to reduce memory pressure
  const maxChunkMB = 64; // Reduced from 322MB to 64MB max
  const bytesPerLine = pixelsPerLine * bandsPerPixel * bytesPerPixel;
  const linesPerMB = Math.floor((1024 * 1024) / bytesPerLine);
  const chunkSize = Math.min(maxChunkMB * linesPerMB, lines, 256); // Cap at 256 lines
  
  // Pre-allocate all arrays
  for (let i = 0; i < validBandNumbers.length; i++) {
    bandData[i] = new Array(lines);
    for (let line = 0; line < lines; line++) {
      bandData[i][line] = new Uint16Array(samples);
    }
  }

  const bandIndices = validBandNumbers.map(b => b - 1);
  const totalChunks = Math.ceil(lines / chunkSize);
  const lineArrays = new Array(validBandNumbers.length);
  let pixelsProcessed = 0;

  // OPTIMIZATION 2: Async processing with yielding to prevent blocking
  const processChunk = async (chunkIndex, lineStart) => {
    const lineEnd = Math.min(lineStart + chunkSize, lines);
    const linesInChunk = lineEnd - lineStart;
    
    const chunkStartByte = lineStart * pixelsPerLine * bandsPerPixel * bytesPerPixel;
    const chunkSizeBytes = linesInChunk * pixelsPerLine * bandsPerPixel * bytesPerPixel;

    const chunkBuffer = await readFileBytes(dataFile, chunkStartByte, chunkSizeBytes);
    const rawChunkData = createEndianAwareTypedArray(chunkBuffer, isBigEndian, metadata.dataType);

    // Process lines with periodic yielding
    for (let lineOffset = 0; lineOffset < linesInChunk; lineOffset++) {
      const actualLine = lineStart + lineOffset;
      const lineBaseIndex = lineOffset * pixelsPerLine * bandsPerPixel;
      
      // Update line arrays once per line
      for (let i = 0; i < validBandNumbers.length; i++) {
        lineArrays[i] = bandData[i][actualLine];
      }
      
      // Process all pixels in this line
      for (let sample = 0; sample < pixelsPerLine; sample++) {
        const pixelBaseIndex = lineBaseIndex + (sample * bandsPerPixel);
        
        switch (validBandNumbers.length) {
          case 1:
            lineArrays[0][sample] = rawChunkData[pixelBaseIndex + bandIndices[0]];
            break;
          case 3:
            lineArrays[0][sample] = rawChunkData[pixelBaseIndex + bandIndices[0]];
            lineArrays[1][sample] = rawChunkData[pixelBaseIndex + bandIndices[1]];
            lineArrays[2][sample] = rawChunkData[pixelBaseIndex + bandIndices[2]];
            break;
          default:
            for (let i = 0; i < validBandNumbers.length; i++) {
              lineArrays[i][sample] = rawChunkData[pixelBaseIndex + bandIndices[i]];
            }
        }
      }
      
      pixelsProcessed += pixelsPerLine;
      
      // OPTIMIZATION 3: Yield to browser every 50 lines to prevent blocking
      if (lineOffset % 50 === 0 && lineOffset > 0) {
        await new Promise(resolve => setTimeout(resolve, 0)); // Yield to browser
      }
      
      // Progress every 500 lines only
      if ((actualLine + 1) % 500 === 0 || actualLine === lines - 1) {
        const percentComplete = Math.round(((actualLine + 1) / lines) * 100);
        const elapsed = (performance.now() - startTime) / 1000;
        const pixelsPerSecond = Math.round(pixelsProcessed / elapsed);
        const eta = elapsed * (lines / (actualLine + 1)) - elapsed;
        
        console.log(`${percentComplete}% | ${pixelsPerSecond.toLocaleString()} px/s | ETA: ${eta.toFixed(1)}s`);
      }
    }

    // OPTIMIZATION 4: Force garbage collection hint after each chunk
    if (window.gc) {
      window.gc(); // Only works in development with --enable-precise-memory-info
    }
  };

  // Process all chunks
  for (let chunkIndex = 0, lineStart = 0; lineStart < lines; chunkIndex++, lineStart += chunkSize) {
    await processChunk(chunkIndex, lineStart);
    
    // OPTIMIZATION 5: Small delay between chunks to let browser breathe
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  const totalTime = (performance.now() - startTime) / 1000;
  const finalRate = Math.round(pixelsProcessed / totalTime);
  console.log(`✅ BIP complete: ${totalTime.toFixed(2)}s | ${finalRate.toLocaleString()} px/s`);
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