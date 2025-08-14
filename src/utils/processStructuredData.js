import { selectDefaultRGBBands } from './bandSelection.js';

// Process structured data (from NetCDF or HDF5 file structure selection)
// into a format compatible with the existing pipeline
export function processStructuredData(wavelengthData, reflectanceData, metadata, options = {}) {
  // Create band data in the format expected by existing components
  const bandData = [];
  
  // Extract dimensions from metadata
  const { samples, lines, bands } = metadata;
  
  // Process reflectance data based on its shape
  if (metadata.originalShape.length === 3) {
    // Handle different data layouts
    const shape = metadata.originalShape;
    
    // Handle different data types for NPY vs other formats
    let data;
    let isSelectiveBandData = false;
    
    // Check if this is selective band data from NPY files
    if (reflectanceData.isSelectiveLoading && Array.isArray(reflectanceData.data)) {
      console.log('🎯 Processing selective band data from NPY file');
      isSelectiveBandData = true;
      data = reflectanceData.data; // This is already band-organized data
    } else if (reflectanceData.data instanceof ArrayBuffer) {
      // For NPY files, the data might already be typed array or ArrayBuffer
      data = new Uint16Array(reflectanceData.data);
    } else if (ArrayBuffer.isView(reflectanceData.data)) {
      // Already a typed array, use as-is or convert as needed
      if (reflectanceData.data instanceof Uint16Array) {
        data = reflectanceData.data;
      } else {
        // Convert other typed arrays to Uint16Array
        data = new Uint16Array(reflectanceData.data);
      }
    } else {
      // Fallback for other formats
      data = new Uint16Array(reflectanceData.data);
    }
    
    console.log('🔍 Structured Data Layout Detection:');
    console.log('  Original shape:', shape);
    console.log('  Expected dimensions - bands:', bands, 'lines:', lines, 'samples:', samples);
    
    // Determine layout based on which dimension matches wavelength count
    let isSpectralFirst = false;
    let layoutDetectionMethod = 'unknown';
    
    // Manual override option
    if (options.forceDataLayout) {
      isSpectralFirst = options.forceDataLayout === 'spectral-first';
      layoutDetectionMethod = 'manual override';
      console.log('  🎛️  Manual layout override:', options.forceDataLayout);
    } else {
      // Improved automatic detection logic
      if (shape[0] === bands && shape[1] === lines && shape[2] === samples) {
        isSpectralFirst = true; // [bands, lines, samples]
        layoutDetectionMethod = 'perfect match: [bands, lines, samples]';
      } else if (shape[0] === lines && shape[1] === samples && shape[2] === bands) {
        isSpectralFirst = false; // [lines, samples, bands]
        layoutDetectionMethod = 'perfect match: [lines, samples, bands]';
      } else if (shape[0] === bands) {
        isSpectralFirst = true; // [bands, ?, ?]
        layoutDetectionMethod = 'fallback: first dimension matches bands';
      } else if (shape[2] === bands) {
        isSpectralFirst = false; // [?, ?, bands]
        layoutDetectionMethod = 'fallback: third dimension matches bands';
      } else if (shape[1] === bands) {
        // Middle dimension is bands - need to check other dimensions
        if (shape[0] === lines && shape[2] === samples) {
          isSpectralFirst = false; // [lines, bands, samples] - treat as interleaved variant
          layoutDetectionMethod = 'variant: [lines, bands, samples]';
          console.warn('  ⚠️  Unusual layout detected: [lines, bands, samples] - treating as interleaved');
        } else {
          // Fallback to spectral first
          isSpectralFirst = true;
          layoutDetectionMethod = 'fallback: middle dimension matches bands (assuming spectral-first)';
        }
      } else {
        // No dimension matches bands exactly - use heuristics
        const totalExpected = bands * lines * samples;
        const totalActual = shape[0] * shape[1] * shape[2];
        
        if (totalExpected === totalActual) {
          // Same total elements, guess based on typical hyperspectral conventions
          if (shape[0] > Math.max(shape[1], shape[2])) {
            isSpectralFirst = true;
            layoutDetectionMethod = 'heuristic: largest dimension first (assuming spectral-first)';
          } else {
            isSpectralFirst = false;
            layoutDetectionMethod = 'heuristic: smallest dimension last (assuming interleaved)';
          }
        } else {
          console.error('  ❌ Shape mismatch: expected total elements =', totalExpected, 'actual =', totalActual);
          isSpectralFirst = false; // Default to interleaved
          layoutDetectionMethod = 'error fallback: defaulting to interleaved';
        }
      }
    }
    
    console.log('  📐 Detected layout:', isSpectralFirst ? '[bands, lines, samples]' : '[lines, samples, bands]');
    console.log('  🎯 Detection method:', layoutDetectionMethod);
    
    // Store detected layout in metadata for future reference
    metadata.detectedDataLayout = isSpectralFirst ? 'spectral-first' : 'interleaved';
    metadata.layoutDetectionMethod = layoutDetectionMethod;
    
    // Handle band processing differently for selective vs full data
    let defaultBands;
    let bandData = [];
    
    if (isSelectiveBandData) {
      // For selective band data, use the already-loaded bands
      console.log('🎯 Using pre-loaded selective bands');
      defaultBands = reflectanceData.loadedBands || [1, 2, 3];
      bandData = data; // Data is already organized as band arrays
      
      console.log('  🌈 Selective Band Information:');
      for (let i = 0; i < defaultBands.length; i++) {
        const bandNumber = defaultBands[i];
        const wavelength = wavelengthData.values[bandNumber - 1];
        console.log(`    Band ${bandNumber}: wavelength ${wavelength}nm`);
      }
      
    } else {
      // For full data, get default RGB bands and process normally
      defaultBands = selectDefaultRGBBands({
        bands,
        wavelengthValues: wavelengthData.values
      });
      
      console.log('  🌈 RGB Band Selection:');
      console.log('    Red band:', defaultBands[0], '- wavelength:', wavelengthData.values[defaultBands[0] - 1]);
      console.log('    Green band:', defaultBands[1], '- wavelength:', wavelengthData.values[defaultBands[1] - 1]);
      console.log('    Blue band:', defaultBands[2], '- wavelength:', wavelengthData.values[defaultBands[2] - 1]);
      
      // Load the default RGB bands
      for (let i = 0; i < defaultBands.length; i++) {
      const bandNumber = defaultBands[i];
      const bandIndex = bandNumber - 1; // Convert to 0-based
      
      // Initialize band data structure
      const bandArray = new Array(lines);
      for (let line = 0; line < lines; line++) {
        bandArray[line] = new Uint16Array(samples);
      }
      
      // SYSTEMATIC SPATIAL OFFSET INVESTIGATION
      // We confirmed reversed indexing gives correct bands, but still have 10-pixel spatial offsets
      // This suggests the spatial indexing formula itself might be wrong
      
      console.log(`  🔧 INVESTIGATING SPATIAL INDEXING for band ${bandNumber}`);
      
      // Original bandIndex calculation
      const originalBandIndex = bandIndex;
      
      // We know reversed band indexing gives correct spectral data
      const reversedBandIndex = (bands - 1) - bandIndex;
      
      console.log(`    Band ${bandNumber}: original index ${originalBandIndex} -> reversed index ${reversedBandIndex}`);
      
      // HYPOTHESIS: The spatial offset might be due to band index differences
      // Let's test if using original bandIndex for spatial calculations fixes alignment
      const spectralIndex = reversedBandIndex;  // For getting correct band data
      const spatialIndex = originalBandIndex;   // For spatial positioning - TEST THEORY
      
      console.log(`    🤔 TESTING MIXED INDEXING: spectral=${spectralIndex}, spatial=${spatialIndex}`);
      
      // Fill band data based on layout with additional validation
      let pixelsProcessed = 0;
      let validPixels = 0;
      
      console.log(`  🔧 Loading band ${bandNumber} (index ${bandIndex}) from ${isSpectralFirst ? 'spectral-first' : 'interleaved'} data...`);
      
      // Use correct band index (reversed for better alignment)
      const testBandIndex = (bands - 1) - bandIndex;
      
      if (isSpectralFirst) {
        // [bands, lines, samples] layout
        console.log(`  📊 Using spectral-first indexing with TEST reversed band index: ${testBandIndex}`);
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            const index = testBandIndex * lines * samples + line * samples + sample;
            if (index < data.length) {
              bandArray[line][sample] = data[index];
              if (data[index] > 0) validPixels++;
            } else {
              console.warn(`  ⚠️  Index out of bounds: ${index} >= ${data.length} for band ${bandNumber}, line ${line}, sample ${sample}`);
              bandArray[line][sample] = 0;
            }
            pixelsProcessed++;
          }
        }
      } else {
        // [lines, samples, bands] layout  
        console.log(`  📊 TESTING SPATIAL FIX: Using spectral index ${spectralIndex} with spatial correction`);
        
        // THEORY: Use spectralIndex for data, but apply spatial offset based on band pattern
        // The 10-pixel offset pattern suggests bands have systematic spatial displacement
        const bandSpatialOffset = (spectralIndex - spatialIndex); // Difference between indices
        console.log(`    Band ${bandNumber} spatial offset from index difference: ${bandSpatialOffset}`);
        
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            // STANDARD INDEX CALCULATION
            const standardIndex = line * samples * bands + sample * bands + spectralIndex;
            
            // EXPERIMENTAL: Apply band-dependent spatial offset correction
            // Based on the pattern: blue(band 6) left, green(band 16) center, red(band 26) right
            // This suggests each band might have a systematic sample offset
            let correctedSample = sample;
            
            // Apply experimental spatial correction at data loading level
            if (bandNumber === 6) { // Blue band - appears too far left, so shift right
              correctedSample = Math.min(samples - 1, sample + 10);
            } else if (bandNumber === 26) { // Red band - appears too far right, so shift left  
              correctedSample = Math.max(0, sample - 10);
            }
            // Green band (16) - no correction needed (center reference)
            
            const correctedIndex = line * samples * bands + correctedSample * bands + spectralIndex;
            const index = correctedIndex < data.length ? correctedIndex : standardIndex;
            
            if (index < data.length) {
              bandArray[line][sample] = data[index];
              if (data[index] > 0) validPixels++;
              
              // Debug spatial correction
              if (line < 2 && sample < 3 && correctedSample !== sample) {
                console.log(`    🔧 Band ${bandNumber} spatial correction: sample ${sample} -> ${correctedSample}`);
              }
            } else {
              console.warn(`  ⚠️  Index out of bounds: ${index} >= ${data.length} for band ${bandNumber}, line ${line}, sample ${sample}`);
              bandArray[line][sample] = 0;
            }
            pixelsProcessed++;
          }
        }
      }
      
      const validPixelPercent = (validPixels / pixelsProcessed * 100).toFixed(1);
      console.log(`  📈 Band ${bandNumber}: ${validPixels}/${pixelsProcessed} pixels (${validPixelPercent}%) have non-zero values`);
      
      // Warn if very few valid pixels (might indicate wrong layout)
      if (validPixels < pixelsProcessed * 0.1) {
        console.warn(`  ⚠️  Band ${bandNumber} has very few valid pixels (${validPixelPercent}%) - layout might be incorrect`);
      }
      
      // Debug: Sample a few pixels and check if they match what we'd expect with spatial correction
      console.log(`  🔍 First few pixels of loaded band ${bandNumber} (checking against spatial offset pattern):`);
      for (let y = 0; y < Math.min(3, lines); y++) {
        for (let x = 0; x < Math.min(3, samples); x++) {
          const loadedValue = bandArray[y][x];
          console.log(`    Pixel (${x}, ${y}): ${loadedValue}`);
          
          // For band 6 (blue), check if the value at x matches what we'd see at x+15 after correction
          if (bandNumber === 6 && x === 0 && y === 0) {
            const spatiallyExpectedX = Math.min(samples - 1, x + 15);
            console.log(`      🔍 This should match what we see at position (${spatiallyExpectedX}, ${y}) in the corrected display`);
          }
        }
      }
      
      bandData.push(bandArray);
      }
    }
    
    // Update metadata with default bands  
    metadata.defaultBands = defaultBands;
    metadata.loadedBands = defaultBands;
    metadata.isSelectiveLoading = isSelectiveBandData;
    
    return {
      bandData,
      metadata: {
        ...metadata,
        wavelengthValues: wavelengthData.values,
        hasRealWavelengths: true,
        wavelengthSource: 'structured file selection'
      }
    };
  } else {
    throw new Error(`Unsupported reflectance data shape: ${metadata.originalShape}`);
  }
}

// Load specific bands from structured data
export function loadStructuredBands(reflectanceData, metadata, bandNumbers, options = {}) {
  const { samples, lines, bands } = metadata;
  const shape = metadata.originalShape;
  const data = new Uint16Array(reflectanceData.data);
  
  console.log('🔄 Loading specific bands:', bandNumbers);
  console.log('  Using previously detected layout:', metadata.detectedDataLayout || 'unknown');
  
  // Use previously detected layout or re-detect
  let isSpectralFirst = false;
  if (options.forceDataLayout) {
    isSpectralFirst = options.forceDataLayout === 'spectral-first';
  } else if (metadata.detectedDataLayout) {
    isSpectralFirst = metadata.detectedDataLayout === 'spectral-first';
  } else {
    // Fallback to original detection logic
    if (shape[0] === bands) {
      isSpectralFirst = true; // [bands, lines, samples]
    } else if (shape[2] === bands) {
      isSpectralFirst = false; // [lines, samples, bands]
    }
  }
  
  const bandData = [];
  
  // Load requested bands
  for (let i = 0; i < bandNumbers.length; i++) {
    const bandNumber = bandNumbers[i];
    const bandIndex = bandNumber - 1; // Convert to 0-based
    
    // Initialize band data structure
    const bandArray = new Array(lines);
    for (let line = 0; line < lines; line++) {
      bandArray[line] = new Uint16Array(samples);
    }
    
    // Fill band data based on layout
    if (isSpectralFirst) {
      // [bands, lines, samples] layout
      for (let line = 0; line < lines; line++) {
        for (let sample = 0; sample < samples; sample++) {
          const index = bandIndex * lines * samples + line * samples + sample;
          bandArray[line][sample] = data[index];
        }
      }
    } else {
      // [lines, samples, bands] layout
      for (let line = 0; line < lines; line++) {
        for (let sample = 0; sample < samples; sample++) {
          const index = line * samples * bands + sample * bands + bandIndex;
          bandArray[line][sample] = data[index];
        }
      }
    }
    
    bandData.push(bandArray);
  }
  
  return bandData;
}

// Extract spectral profile from structured data
export async function extractStructuredPixelSpectrum(reflectanceData, metadata, wavelengthData, x, y, options = {}) {
  const { samples, lines, bands } = metadata;
  
  // Check if this is NPY data with selective loading
  if (metadata.isSelectiveLoading && metadata.npyMetadata && options.dataFile) {
    console.log('🎯 Using NPY on-demand pixel spectrum extraction');
    
    // Import NPY extraction function
    const { extractNpyPixelSpectrum } = await import('./parseNPY.js');
    
    try {
      // Extract spectrum directly from file using selective reading
      return await extractNpyPixelSpectrum(
        options.dataFile, 
        metadata.npyMetadata, 
        x, 
        y, 
        wavelengthData
      );
    } catch (error) {
      console.error('NPY pixel spectrum extraction failed:', error);
      throw error;
    }
  }
  
  // For non-NPY data or non-selective loading, use the original method
  const shape = metadata.originalShape;
  
  // Bounds check
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }
  
  console.log(`🎯 Extracting spectrum for pixel (${x}, ${y})`);
  console.log('  Using layout:', metadata.detectedDataLayout || 'unknown');
  
  // Check if we have selective band data that can't provide full spectrum
  if (reflectanceData.isSelectiveLoading && Array.isArray(reflectanceData.data)) {
    console.warn('⚠️  Cannot extract full spectrum from selective band data. Only RGB bands available.');
    
    // Create a limited spectrum from the available RGB bands
    const spectrum = [];
    const loadedBands = metadata.loadedBands || [1, 2, 3];
    
    for (let i = 0; i < loadedBands.length; i++) {
      const bandNumber = loadedBands[i];
      const bandData = reflectanceData.data[i];
      
      if (bandData && bandData[y] && bandData[y][x] !== undefined) {
        const value = bandData[y][x];
        const wavelength = wavelengthData.values ? wavelengthData.values[bandNumber - 1] : bandNumber;
        
        spectrum.push({
          band: bandNumber,
          wavelength,
          value
        });
      }
    }
    
    if (spectrum.length === 0) {
      throw new Error(`Pixel (${x}, ${y}) has no valid spectral data - try clicking on a different pixel or use full spectrum loading`);
    }
    
    console.log(`📊 Limited spectrum extracted: ${spectrum.length} bands from selective loading`);
    return spectrum;
  }
  
  // Original full data extraction method
  const data = new Uint16Array(reflectanceData.data);
  
  // Use previously detected layout or re-detect
  let isSpectralFirst = false;
  if (options.forceDataLayout) {
    isSpectralFirst = options.forceDataLayout === 'spectral-first';
  } else if (metadata.detectedDataLayout) {
    isSpectralFirst = metadata.detectedDataLayout === 'spectral-first';
  } else {
    // Fallback to original detection logic
    if (shape[0] === bands) {
      isSpectralFirst = true; // [bands, lines, samples]
    } else if (shape[2] === bands) {
      isSpectralFirst = false; // [lines, samples, bands]
    }
  }
  
  const spectrum = [];
  
  // Extract pixel spectrum
  for (let band = 0; band < bands; band++) {
    let value;
    
    if (isSpectralFirst) {
      // [bands, lines, samples] layout
      const index = band * lines * samples + y * samples + x;
      value = data[index];
    } else {
      // [lines, samples, bands] layout
      const index = y * samples * bands + x * bands + band;
      value = data[index];
    }
    
    const wavelength = wavelengthData.values ? wavelengthData.values[band] : band + 1;
    
    spectrum.push({
      band: band + 1,
      wavelength,
      value
    });
  }
  
  return spectrum;
}