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
    const data = new Uint16Array(reflectanceData.data);
    
    console.log('🔍 MATLAB Data Layout Detection:');
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
    
    // Get default RGB bands for initial display
    const defaultBands = selectDefaultRGBBands({
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
      
      // ROOT CAUSE INVESTIGATION: The spatial offsets revealed a pattern!
      // Red (band 26): needs -5 offset  
      // Green (band 16): needs +5 offset
      // Blue (band 6): needs +15 offset
      // This suggests our indexing formula might be BACKWARDS or have wrong stride!
      
      const centerY = Math.floor(lines / 2);
      const centerX = Math.floor(samples / 2);
      let centerIndex, rawCenterValue;
      
      if (isSpectralFirst) {
        centerIndex = bandIndex * lines * samples + centerY * samples + centerX;
      } else {
        centerIndex = centerY * samples * bands + centerX * bands + bandIndex;
      }
      
      rawCenterValue = centerIndex < data.length ? data[centerIndex] : 'OUT_OF_BOUNDS';
      console.log(`    🎯 Center pixel (${centerX}, ${centerY}) raw value: ${rawCenterValue} (index ${centerIndex})`);
      
      // THEORY TEST: What if our indexing formula is wrong?
      // Let's try different indexing formulas and see which gives the spatially correct data
      console.log(`    🤔 INDEXING THEORY TESTS for band ${bandNumber}:`);
      
      // Current formula: line * samples * bands + sample * bands + bandIndex
      const currentFormula = centerY * samples * bands + centerX * bands + bandIndex;
      const currentValue = data[currentFormula];
      
      // Alternative 1: Maybe bands and samples are swapped?
      const alt1Formula = centerY * bands * samples + centerX * samples + bandIndex;
      const alt1Value = alt1Formula < data.length ? data[alt1Formula] : 'OOB';
      
      // Alternative 2: Maybe it's actually spectral-first but detected wrong?
      const alt2Formula = bandIndex * lines * samples + centerY * samples + centerX;
      const alt2Value = alt2Formula < data.length ? data[alt2Formula] : 'OOB';
      
      // Alternative 3: Different band stride?
      const alt3Formula = centerY * samples * bands + centerX * bands + (bands - 1 - bandIndex); // Reverse band order
      const alt3Value = alt3Formula < data.length ? data[alt3Formula] : 'OOB';
      
      console.log(`    Current: ${currentValue} | Alt1 (swap dims): ${alt1Value} | Alt2 (spectral-first): ${alt2Value} | Alt3 (reverse bands): ${alt3Value}`);
      
      // Check if any alternative formula gives us the value we'd expect at the spatially corrected location
      if (bandNumber === 6) { // Blue band - needs +15 spatial offset to align
        const expectedX = Math.min(samples - 1, centerX + 15);
        // Removed problematic reference to currentBandData
        // Removed console.log that referenced undefined expectedValue
        
        // Check if any formula gives us this expected value at the original location
        // Removed comparisons that used undefined expectedValue
      }
      
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
    
    // Update metadata with default bands
    metadata.defaultBands = defaultBands;
    metadata.loadedBands = defaultBands;
    
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
export function extractStructuredPixelSpectrum(reflectanceData, metadata, wavelengthData, x, y, options = {}) {
  const { samples, lines, bands } = metadata;
  const shape = metadata.originalShape;
  const data = new Uint16Array(reflectanceData.data);
  
  // Bounds check
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }
  
  console.log(`🎯 Extracting spectrum for pixel (${x}, ${y})`);
  console.log('  Using layout:', metadata.detectedDataLayout || 'unknown');
  
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