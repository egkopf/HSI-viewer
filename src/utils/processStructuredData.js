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
    const data = new Uint16Array(reflectanceData.data);
    
    // Determine layout based on which dimension matches wavelength count
    let isSpectralFirst = false;
    if (shape[0] === bands) {
      isSpectralFirst = true; // [bands, lines, samples]
    } else if (shape[2] === bands) {
      isSpectralFirst = false; // [lines, samples, bands]
    }
    
    // Get default RGB bands for initial display
    const defaultBands = selectDefaultRGBBands({
      bands,
      wavelengthValues: wavelengthData.values
    });
    
    // Load the default RGB bands
    for (let i = 0; i < defaultBands.length; i++) {
      const bandNumber = defaultBands[i];
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