export async function parseHDRFile(hdrFile) {
  const text = await hdrFile.text();
  const metadata = {};

  // First pass: extract simple key-value pairs
  let currentKey = null;
  let currentValue = '';
  let inMultilineValue = false;

  text.split('\n').forEach((line) => {
    const trimmedLine = line.trim();

    // Check if this line starts a key-value pair
    if (trimmedLine.includes('=') && !inMultilineValue) {
      const [key, value] = trimmedLine.split('=');
      currentKey = key.trim();
      currentValue = value.trim();

      // Check if this value continues on multiple lines (has opening brace but no closing brace)
      if (currentValue.includes('{') && !currentValue.includes('}')) {
        inMultilineValue = true;
      } else {
        // Store complete key-value pair
        metadata[currentKey] = currentValue;
        currentKey = null;
        currentValue = '';
      }
    }
    // Continue collecting a multi-line value
    else if (inMultilineValue && currentKey) {
      currentValue += ' ' + trimmedLine;

      // Check if this line completes the multi-line value
      if (trimmedLine.includes('}')) {
        metadata[currentKey] = currentValue;
        inMultilineValue = false;
        currentKey = null;
        currentValue = '';
      }
    }
  });

  // Second pass: parse special values like wavelength
  if (metadata.wavelength) {
    try {
      // Extract wavelength values from the multi-line format
      const wavelengthStr = metadata.wavelength.replace(/[{}]/g, '');
      const parsedWavelengths = wavelengthStr.split(',')
        .map(w => parseFloat(w.trim()))
        .filter(w => !isNaN(w));

      // Verify we have the expected number of wavelength values
      const expectedBands = parseInt(metadata.bands, 10);
      if (parsedWavelengths.length === expectedBands) {
        metadata.wavelengthValues = parsedWavelengths;
        console.log(`Successfully parsed ${parsedWavelengths.length} wavelength values:`,
          parsedWavelengths[0], '...', parsedWavelengths[parsedWavelengths.length - 1]);
      } else {
        console.error(`Expected ${expectedBands} wavelength values but got ${parsedWavelengths.length}`);
        metadata.wavelengthValues = [];
      }
    } catch (error) {
      console.error('Error parsing wavelength data:', error);
      metadata.wavelengthValues = [];
    }
  }

  // Parse interleave format from metadata
  const interleave = metadata.interleave ? metadata.interleave.toLowerCase() : 'bsq';

  // Set default bands if not specified (many hyperspectral datasets don't include default bands)
  let defaultBands = [];
  if (metadata["default bands"]) {
    try {
      defaultBands = metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number);
    } catch (error) {
      console.error('Error parsing default bands:', error);
      defaultBands = [];
    }
  }

  if (!defaultBands.length || defaultBands.some(isNaN)) {
    // Set sensible defaults based on typical RGB visualization for hyperspectral data
    const bands = parseInt(metadata.bands, 10) || 224;
    if (bands >= 224) { // AVIRIS-like sensor
      defaultBands = [29, 19, 9]; // Approximately red, green, blue for AVIRIS
    } else if (bands >= 100) {
      defaultBands = [bands * 0.7, bands * 0.45, bands * 0.2].map(Math.floor); // 70%, 45%, 20% through bands
    } else {
      defaultBands = [Math.floor(bands * 0.7), Math.floor(bands * 0.5), Math.floor(bands * 0.3)];
    }
    console.log('No default bands specified, using:', defaultBands);
  }

  // Make sure default bands are valid 1-based indices
  defaultBands = defaultBands.map(band => Math.max(1, Math.min(parseInt(metadata.bands, 10), band || 1)));

  // Parse byte order (default to 0 if not specified)
  const byteOrder = parseInt(metadata["byte order"], 10);
  const isBigEndian = byteOrder === 1;

  // Parse numeric values
  return {
    ...metadata,
    samples: parseInt(metadata.samples, 10),
    lines: parseInt(metadata.lines, 10),
    bands: parseInt(metadata.bands, 10),
    interleave: interleave, // Store the interleave format (bsq, bil, bip)
    byteOrder: isNaN(byteOrder) ? 0 : byteOrder, // Store the byte order (0=little endian, 1=big endian)
    isBigEndian: isBigEndian, // Convenience boolean flag
    defaultBands: defaultBands // Store processed default bands
  };
}

// Helper function to handle endianness when creating typed arrays
function createEndianAwareTypedArray(buffer, isBigEndian) {
  if (isBigEndian) {
    // For big-endian (byte order=1), we need to swap bytes
    const u8 = new Uint8Array(buffer);
    const swappedBuffer = new ArrayBuffer(buffer.byteLength);
    const swappedU8 = new Uint8Array(swappedBuffer);

    // Swap bytes for each 16-bit value
    for (let i = 0; i < u8.length; i += 2) {
      if (i + 1 < u8.length) {
        swappedU8[i] = u8[i + 1];
        swappedU8[i + 1] = u8[i];
      } else {
        swappedU8[i] = u8[i]; // Handle odd byte at the end if it exists
      }
    }

    return new Uint16Array(swappedBuffer);
  } else {
    // For little-endian (byte order=0), we can use the buffer directly
    return new Uint16Array(buffer);
  }
}

export async function parseRGBPreview(dataFile, metadata, rgbBands) {
  const { samples, lines, bands, interleave, isBigEndian } = metadata;
  const buffer = await dataFile.arrayBuffer();
  const totalPixels = samples * lines;

  // Make sure rgbBands are valid and 1-based
  const validRgbBands = rgbBands.map(band => {
    // Ensure band is an integer between 1 and the total number of bands
    const validBand = Math.max(1, Math.min(bands, Math.floor(band) || 1));
    return validBand;
  });

  console.log('Using RGB bands:', validRgbBands);
  console.log('Byte order:', metadata.byteOrder, 'isBigEndian:', isBigEndian);

  // Create Uint16Array with proper endianness handling
  const rawData = createEndianAwareTypedArray(buffer, isBigEndian);

  // array for just these 3 bands (R, G, B)
  const previewData = new Array(3);

  // Function to get the correct offset based on interleave format
  const getOffset = (band, line, sample) => {
    const bandIndex = band - 1; // Convert to 0-based indexing

    switch (interleave.toLowerCase()) {
      case 'bil': // Band Interleaved by Line
        return (line * samples * bands) + (bandIndex * samples) + sample;
      case 'bip': // Band Interleaved by Pixel
        return (line * samples * bands) + (sample * bands) + bandIndex;
      case 'bsq': // Band Sequential (default)
      default:
        return (bandIndex * totalPixels) + (line * samples) + sample;
    }
  };

  // Load each of the three RGB bands we need
  for (let i = 0; i < 3; i++) {
    const bandNumber = validRgbBands[i]; // This is the 1-based band number
    const bandIndex = i;  // This is the index in preview array (0, 1, or 2)

    // Initialize the 2D array for this band
    const bandData = new Array(lines);

    // Process each line in the band
    for (let line = 0; line < lines; line++) {
      // Create typed array for this line
      const lineData = new Uint16Array(samples);

      // Use optimized method based on interleave format
      if (interleave.toLowerCase() === 'bsq') {
        // For BSQ, we can optimize by reading entire lines at once
        const bandOffset = (bandNumber - 1) * totalPixels;
        const lineOffset = bandOffset + (line * samples);
        lineData.set(rawData.subarray(lineOffset, lineOffset + samples));
      }
      else if (interleave.toLowerCase() === 'bil') {
        // For BIL, we can read entire band segments within each line
        const lineOffset = (line * samples * bands) + ((bandNumber - 1) * samples);
        lineData.set(rawData.subarray(lineOffset, lineOffset + samples));
      }
      else if (interleave.toLowerCase() === 'bip') {
        // For BIP, we need to extract each sample individually
        for (let sample = 0; sample < samples; sample++) {
          const pixelOffset = (line * samples * bands) + (sample * bands);
          const bandOffset = pixelOffset + (bandNumber - 1); // -1 to convert to 0-based index
          lineData[sample] = rawData[bandOffset];
        }
      }
      else {
        // Fallback for other formats
        for (let sample = 0; sample < samples; sample++) {
          const offset = getOffset(bandNumber, line, sample);
          lineData[sample] = rawData[offset];
        }
      }

      // Store the line
      bandData[line] = lineData;
    }

    // Store the band in the preview data
    previewData[bandIndex] = bandData;
  }

  return previewData;
}

export async function parseFullData(dataFile, metadata, onProgress) {
  const { samples, lines, bands, interleave, isBigEndian } = metadata;
  const buffer = await dataFile.arrayBuffer();
  const totalPixels = samples * lines;

  // Create a Uint16Array view with proper endianness handling
  const rawData = createEndianAwareTypedArray(buffer, isBigEndian);

  // Pre-allocate the entire data structure
  const data = new Array(bands);

  // For BIP format, we need a specialized approach
  if (interleave.toLowerCase() === 'bip') {
    console.log('Using optimized BIP processing...');

    // Initialize all band arrays
    for (let band = 0; band < bands; band++) {
      data[band] = new Array(lines);
      for (let line = 0; line < lines; line++) {
        data[band][line] = new Uint16Array(samples);
      }
    }

    // Process all pixels
    let processedCount = 0;
    const totalCount = lines * samples;
    const progressSteps = Math.max(10, Math.floor(lines / 100)); // Report progress every ~1%

    for (let line = 0; line < lines; line++) {
      for (let sample = 0; sample < samples; sample++) {
        // Calculate the starting position of this pixel's band values
        const pixelOffset = (line * samples * bands) + (sample * bands);

        // Extract all bands for this pixel at once
        for (let band = 0; band < bands; band++) {
          data[band][line][sample] = rawData[pixelOffset + band];
        }

        processedCount++;
      }

      // Report progress periodically
      if (onProgress && line % progressSteps === 0) {
        onProgress((line / lines) * 100);
      }
    }

    if (onProgress) onProgress(100);
    return data;
  }

  // For BSQ and BIL formats, process one band at a time
  for (let band = 0; band < bands; band++) {
    // Create a 2D array for this band using a single allocation per line
    const bandData = new Array(lines);

    if (interleave.toLowerCase() === 'bsq') {
      // For BSQ, we can optimize by reading entire lines at once
      const bandOffset = band * totalPixels;

      for (let line = 0; line < lines; line++) {
        const lineData = new Uint16Array(samples);
        const lineOffset = bandOffset + (line * samples);
        lineData.set(rawData.subarray(lineOffset, lineOffset + samples));
        bandData[line] = lineData;
      }
    } else if (interleave.toLowerCase() === 'bil') {
      // For BIL, optimize by reading entire band segments within each line
      for (let line = 0; line < lines; line++) {
        const lineData = new Uint16Array(samples);
        const lineOffset = (line * samples * bands) + (band * samples);
        lineData.set(rawData.subarray(lineOffset, lineOffset + samples));
        bandData[line] = lineData;
      }
    } else {
      // Generic fallback implementation
      for (let line = 0; line < lines; line++) {
        const lineData = new Uint16Array(samples);

        for (let sample = 0; sample < samples; sample++) {
          const offset = (line * samples * bands) + (sample * bands) + band;
          lineData[sample] = rawData[offset];
        }

        bandData[line] = lineData;
      }
    }

    // Store the band
    data[band] = bandData;

    // Report progress
    if (onProgress) {
      onProgress((band + 1) / bands * 100);
    }
  }

  return data;
}

// Legacy function name to maintain backward compatibility
export async function parseFullBSQ(dataFile, metadata, onProgress) {
  console.log('Using parseFullData function with interleave format:', metadata.interleave || 'bsq');
  return parseFullData(dataFile, metadata, onProgress);
}