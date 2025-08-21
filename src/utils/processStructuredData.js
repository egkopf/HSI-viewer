import { selectDefaultRGBBands } from './bandSelection.js';

// Process structured data (from NetCDF or HDF5 file structure selection)
// into a format compatible with the existing pipeline
export function processStructuredData(wavelengthData, reflectanceData, metadata) {
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
    if (reflectanceData.data instanceof ArrayBuffer) {
      // For NPY files, the data might already be typed array or ArrayBuffer
      data = new Uint16Array(reflectanceData.data);
    } else if (ArrayBuffer.isView(reflectanceData.data)) {
      // Already a typed array, use as-is or convert as needed
      if (reflectanceData.data instanceof Uint16Array) {
        data = reflectanceData.data;
      } else {
        // For NPY files with float data, we need to convert properly
        console.log('🔄 Converting NPY data type:', reflectanceData.data.constructor.name, 'to Uint16Array');
        
        // Get a few sample values to understand the data range
        const sampleSize = Math.min(100, reflectanceData.data.length);
        let minVal = Number.MAX_VALUE;
        let maxVal = Number.MIN_VALUE;
        for (let i = 0; i < sampleSize; i++) {
          const val = reflectanceData.data[i];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
        console.log(`  📊 Sample data range: ${minVal} to ${maxVal}`);
        
        // Convert with proper scaling
        data = new Uint16Array(reflectanceData.data.length);
        if (maxVal > 0) {
          // For values < 1, scale to use full 16-bit range
          let scale;
          if (maxVal <= 1.0) {
            // Scale small values (0-1 range) to 16-bit range
            scale = 65535;
            console.log(`  🔧 Scaling small values (0-${maxVal.toFixed(3)}) to 16-bit range with scale: ${scale}`);
          } else if (maxVal > 65535) {
            // Scale large values down to 16-bit range
            scale = 65535 / maxVal;
            console.log(`  🔧 Scaling large values down with scale factor: ${scale}`);
          } else {
            // Values already in reasonable range
            scale = 1;
            console.log(`  🔧 Values in good range, scale factor: ${scale}`);
          }
          
          for (let i = 0; i < reflectanceData.data.length; i++) {
            data[i] = Math.round(reflectanceData.data[i] * scale);
          }
        } else {
          // Direct conversion for small values
          for (let i = 0; i < reflectanceData.data.length; i++) {
            data[i] = Math.round(Math.abs(reflectanceData.data[i]) * 65535);
          }
        }
        
        // Verify conversion worked
        let nonZeroCount = 0;
        for (let i = 0; i < Math.min(1000, data.length); i++) {
          if (data[i] > 0) nonZeroCount++;
        }
        console.log(`  ✅ Conversion verification: ${nonZeroCount}/1000 sample values are non-zero`);
      }
    } else {
      // Fallback for other formats
      data = new Uint16Array(reflectanceData.data);
    }
    
    console.log('🔍 NPY Data Layout Detection:');
    console.log('  Original shape:', shape);
    console.log('  Expected dimensions - bands:', bands, 'lines:', lines, 'samples:', samples);
    console.log('  Raw reflectanceData.data type:', reflectanceData.data.constructor.name);
    console.log('  Converted data type:', data.constructor.name);
    console.log('  Data length:', data.length);
    
    // Determine layout based on which dimension matches wavelength count
    let isSpectralFirst = false;
    let layoutDetectionMethod = 'unknown';
    
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
      // Middle dimension is bands - unusual but possible
      isSpectralFirst = false; // Treat as [lines, bands, samples] -> [lines, samples, bands]
      layoutDetectionMethod = 'fallback: middle dimension matches bands';
    } else {
      // No dimension matches exactly - use heuristics
      const totalExpected = bands * lines * samples;
      if (data.length === totalExpected) {
        // Data size matches, guess based on common patterns
        if (shape.length === 3) {
          isSpectralFirst = shape[0] > shape[2]; // Larger first dimension suggests spectral-first
          layoutDetectionMethod = 'heuristic: larger first dimension suggests spectral-first';
        }
      } else {
        console.warn('⚠️ Data size mismatch! Expected:', totalExpected, 'Got:', data.length);
        isSpectralFirst = false; // Default fallback
        layoutDetectionMethod = 'fallback: data size mismatch, using default';
      }
    }
    
    console.log('  📐 Detected layout:', isSpectralFirst ? '[bands, lines, samples]' : '[lines, samples, bands]');
    console.log('  🎯 Detection method:', layoutDetectionMethod);
    
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
      
      console.log(`  🔧 Loading band ${bandNumber} (index ${bandIndex}) from ${isSpectralFirst ? 'spectral-first' : 'interleaved'} data...`);
      
      // Initialize band data structure
      const bandArray = new Array(lines);
      for (let line = 0; line < lines; line++) {
        bandArray[line] = new Uint16Array(samples);
      }
      
      // Fill band data based on layout
      let pixelsProcessed = 0;
      let validPixels = 0;
      
      if (isSpectralFirst) {
        // [bands, lines, samples] layout
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            const index = bandIndex * lines * samples + line * samples + sample;
            if (index < data.length) {
              bandArray[line][sample] = data[index];
              if (data[index] > 0) validPixels++;
            }
            pixelsProcessed++;
          }
        }
      } else {
        // [lines, samples, bands] layout
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            const index = line * samples * bands + sample * bands + bandIndex;
            if (index < data.length) {
              bandArray[line][sample] = data[index];
              if (data[index] > 0) validPixels++;
            }
            pixelsProcessed++;
          }
        }
      }
      
      console.log(`    ✅ Band ${bandNumber} loaded: ${validPixels}/${pixelsProcessed} valid pixels`);
      
      // Sample a few pixels to verify data
      if (lines > 10 && samples > 10) {
        const sampleVal1 = bandArray[5][5];
        const sampleVal2 = bandArray[lines-5][samples-5];
        console.log(`    📊 Sample values: center-ish=${sampleVal1}, corner-ish=${sampleVal2}`);
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
export function loadStructuredBands(reflectanceData, metadata, bandNumbers) {
  const { samples, lines, bands } = metadata;
  const shape = metadata.originalShape;
  const data = new Uint16Array(reflectanceData.data);
  
  // Determine layout
  let isSpectralFirst = false;
  if (shape[0] === bands) {
    isSpectralFirst = true; // [bands, lines, samples]
  } else if (shape[2] === bands) {
    isSpectralFirst = false; // [lines, samples, bands]
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
export function extractStructuredPixelSpectrum(reflectanceData, metadata, wavelengthData, x, y) {
  const { samples, lines, bands } = metadata;
  const shape = metadata.originalShape;
  const data = new Uint16Array(reflectanceData.data);
  
  // Bounds check
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }
  
  // Determine layout
  let isSpectralFirst = false;
  if (shape[0] === bands) {
    isSpectralFirst = true; // [bands, lines, samples]
  } else if (shape[2] === bands) {
    isSpectralFirst = false; // [lines, samples, bands]
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