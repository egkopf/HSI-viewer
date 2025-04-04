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

  // Parse numeric values
  return {
    ...metadata,
    samples: parseInt(metadata.samples, 10),
    lines: parseInt(metadata.lines, 10),
    bands: parseInt(metadata.bands, 10),
  };
}

export async function parseRGBPreview(bsqFile, metadata, rgbBands) {
  const { samples, lines } = metadata;
  const buffer = await bsqFile.arrayBuffer();
  const bytesPerSample = 2;
  const totalPixels = samples * lines;

  // single Uint16Array view of the entire buffer
  const rawData = new Uint16Array(buffer);

  // array for just these 3 bands (R, G, B)
  const previewData = new Array(3);

  // load each of the three RGB bands we need
  for (let i = 0; i < 3; i++) {
    const bandNumber = rgbBands[i]; // This is the 1-based band number from metadata
    const bandIndex = i;  // This is the index in preview array (0, 1, or 2)

    // Calculate the starting offset for this band (converting from 1-based to 0-based)
    const bandOffset = (bandNumber - 1) * totalPixels;

    // Initialize the 2D array for this band
    const bandData = new Array(lines);

    // Process each line in the band
    for (let line = 0; line < lines; line++) {
      // Create typed array for this line
      const lineData = new Uint16Array(samples);

      // Calculate the starting offset for this line
      const lineOffset = bandOffset + (line * samples);

      // Copy an entire line of data at once
      lineData.set(rawData.subarray(lineOffset, lineOffset + samples));

      // Store the line
      bandData[line] = lineData;
    }

    // Store the band in the preview data
    previewData[bandIndex] = bandData;
  }

  return previewData;
}
export async function parseFullBSQ(bsqFile, metadata, onProgress) {
  const { samples, lines, bands } = metadata;
  const buffer = await bsqFile.arrayBuffer();
  const bytesPerSample = 2;
  const totalPixels = samples * lines;

  // Create a single Uint16Array view of the entire buffer
  const rawData = new Uint16Array(buffer);

  // Pre-allocate the entire data structure
  const data = new Array(bands);

  // Process one band at a time to avoid memory issues
  for (let band = 0; band < bands; band++) {
    // Create a 2D array for this band using a single allocation per line
    const bandData = new Array(lines);

    // Calculate the starting offset for this band
    const bandOffset = band * totalPixels;

    // Process each line in the band
    for (let line = 0; line < lines; line++) {
      // Create typed array for this line
      const lineData = new Uint16Array(samples);

      // Calculate starting offset for this line
      const lineOffset = bandOffset + (line * samples);

      // Copy a line of data all at once using set()
      lineData.set(rawData.subarray(lineOffset, lineOffset + samples));

      // Store the line
      bandData[line] = lineData;
    }

    // Store the band
    data[band] = bandData;

    // Report progress, not functional right now
    if (onProgress) {
      onProgress((band + 1) / bands * 100);
    }
  }

  return data;
}