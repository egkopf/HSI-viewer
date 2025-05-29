import { selectDefaultRGBBands } from './bandSelection.js';

export async function parseGeoTIFF(tiffFile) {
  // Dynamic import to handle module loading issues
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  // Extract basic dimensions
  const samples = image.getWidth();
  const lines = image.getHeight();
  const bands = image.getSamplesPerPixel();
  
  // Get data type info
  const sampleFormat = image.getSampleFormat();
  const bitsPerSample = image.getBitsPerSample();
  const dataType = getENVIDataType(sampleFormat[0], bitsPerSample[0]);
  
  // Try to extract wavelength information
  const wavelengthValues = await extractWavelengthData(image, bands);
  
  console.log(`GeoTIFF bands: ${bands}, wavelengths available: ${wavelengthValues?.length || 0}`);
  if (wavelengthValues && wavelengthValues.length > 0) {
    console.log(`Wavelength range: ${wavelengthValues[0]} - ${wavelengthValues[wavelengthValues.length-1]}`);
  }
  
  // Select default RGB bands - use simple 1,2,3 for GeoTIFF
  const defaultBands = selectGeoTIFFDefaultBands(bands);
  
  const metadata = {
    samples,
    lines,
    bands,
    dataType,
    interleave: 'bip', // GeoTIFF is typically band-interleaved by pixel
    byteOrder: 0, // Little endian (handled by geotiff.js)
    isBigEndian: false,
    defaultBands,
    wavelengthValues,
    fileType: 'geotiff',
    // GeoTIFF specific - try to get these safely
    tiffImage: image, // Keep reference for data reading
    geoTransform: await getGeoTransformSafely(image),
    projection: await getProjectionSafely(image)
  };
  
  console.log(`GeoTIFF: ${samples}×${lines} pixels, ${bands} bands`);
  console.log('Wavelength range:', wavelengthValues?.length > 0 
    ? `${wavelengthValues[0]} - ${wavelengthValues[wavelengthValues.length-1]}`
    : 'Not available');
  
  return metadata;
}

export async function parseGeoTIFFBands(tiffFile, metadata, bandNumbers) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  
  // Always get the first (full resolution) image, not overview/pyramid levels
  const image = await tiff.getImage(0); // Explicitly get index 0
  
  const { samples, lines } = metadata;
  const validBandNumbers = bandNumbers.map(band =>
    Math.max(1, Math.min(metadata.bands, Math.floor(band) || 1))
  );
  
  console.log(`Reading GeoTIFF bands: ${validBandNumbers.join(', ')}`);
  console.log(`Image dimensions: ${image.getWidth()}x${image.getHeight()}`);
  console.log(`Expected dimensions: ${samples}x${lines}`);
  
  // Read the full image at full resolution
  const rasters = await image.readRasters({
    samples: validBandNumbers.map(b => b - 1),
    interleave: false, // Get separate arrays for each band
    // Force full image read - no windowing or tiling
    width: image.getWidth(),
    height: image.getHeight()
  });
  
  // Verify we got the expected data size
  console.log(`Raster data length: ${rasters[0]?.length}, expected: ${samples * lines}`);
  
  // Convert to [band][line][sample] format to match ENVI structure
  const bandData = new Array(validBandNumbers.length);
  
  for (let bandIdx = 0; bandIdx < validBandNumbers.length; bandIdx++) {
    bandData[bandIdx] = new Array(lines);
    const bandRaster = rasters[bandIdx];
    
    // Convert 1D raster to 2D [line][sample] arrays
    for (let line = 0; line < lines; line++) {
      const lineStart = line * samples;
      bandData[bandIdx][line] = bandRaster.subarray(lineStart, lineStart + samples);
    }
  }
  
  return bandData;
}

export async function extractGeoTIFFPixelSpectrum(tiffFile, metadata, x, y) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  const { samples, lines, bands, wavelengthValues } = metadata;
  
  // Bounds check
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }
  
  // Read single pixel across all bands
  const pixelData = await image.readRasters({
    window: [x, y, x + 1, y + 1], // Single pixel window
    width: 1,
    height: 1
  });
  
  // Build spectrum array
  const spectrum = [];
  for (let band = 0; band < bands; band++) {
    const value = pixelData[band][0]; // Single pixel value
    const wavelength = wavelengthValues?.[band] || band + 1;
    
    spectrum.push({
      band: band + 1,
      wavelength,
      value: value > 55535 ? 0 : value // Clip extreme values
    });
  }
  
  return spectrum;
}

// Helper functions
function getENVIDataType(sampleFormat, bitsPerSample) {
  // Convert TIFF sample format to ENVI data type
  if (sampleFormat === 1) { // Unsigned integer
    return bitsPerSample === 16 ? 12 : 1; // Uint16 or Uint8
  } else if (sampleFormat === 2) { // Signed integer
    return bitsPerSample === 16 ? 2 : 1; // Int16 or Int8
  } else if (sampleFormat === 3) { // Float
    return bitsPerSample === 32 ? 4 : 5; // Float32 or Float64
  }
  return 12; // Default to Uint16
}

async function extractWavelengthData(image, bands) {
  try {
    // Try GDAL metadata first
    const gdalMeta = image.getGDALMetadata();
    if (gdalMeta?.wavelength) {
      return parseWavelengthString(gdalMeta.wavelength);
    }
    
    // Try custom TIFF tags (common in hyperspectral data)
    const fileDirectory = image.getFileDirectory();
    
    // Check for wavelength in various tag locations
    const wavelengthTag = fileDirectory.Wavelength || 
                         fileDirectory[50000] || // Common custom tag
                         fileDirectory[50010];   // Another common tag
    
    if (wavelengthTag) {
      return Array.isArray(wavelengthTag) ? wavelengthTag : [wavelengthTag];
    }
    
    // Generate default wavelengths based on band count
    return generateDefaultWavelengths(bands);
    
  } catch (error) {
    console.warn('Could not extract wavelength data:', error);
    return generateDefaultWavelengths(bands);
  }
}

function parseWavelengthString(wavelengthStr) {
  if (typeof wavelengthStr === 'string') {
    return wavelengthStr.split(',')
      .map(w => parseFloat(w.trim()))
      .filter(w => !isNaN(w));
  }
  return [];
}

function generateDefaultWavelengths(bands) {
  // Generate reasonable wavelength range for visualization
  const wavelengths = [];
  const startWl = 400; // 400nm
  const endWl = 2500;  // 2500nm
  const step = (endWl - startWl) / (bands - 1);
  
  for (let i = 0; i < bands; i++) {
    wavelengths.push(startWl + (i * step));
  }
  
  return wavelengths;
}

// Safe wrapper functions for GeoTIFF methods
async function getGeoTransformSafely(image) {
  try {
    if (typeof image.getGeoTransform === 'function') {
      return image.getGeoTransform();
    }
    // Try alternative method names
    if (typeof image.getModelTransformation === 'function') {
      return image.getModelTransformation();
    }
    return null;
  } catch (error) {
    console.warn('Could not get geo transform:', error);
    return null;
  }
}

async function getProjectionSafely(image) {
  try {
    if (typeof image.getGeoKeys === 'function') {
      return image.getGeoKeys();
    }
    // Try alternative method
    if (typeof image.getProjection === 'function') {
      return image.getProjection();
    }
    return null;
  } catch (error) {
    console.warn('Could not get projection info:', error);
    return null;
  }
}

// GeoTIFF-specific band selection (simple sequential)
function selectGeoTIFFDefaultBands(totalBands) {
  if (totalBands >= 3) {
    // For RGB: use bands 1, 2, 3 (natural order)
    console.log(`GeoTIFF: Selected RGB bands 1, 2, 3 (of ${totalBands} total)`);
    return [1, 2, 3];
  } else if (totalBands === 2) {
    // For 2-band: use 1, 2, 1 
    console.log(`GeoTIFF: Selected RGB bands 1, 2, 1 (of ${totalBands} total)`);
    return [1, 2, 1];
  } else {
    // Single band: use 1, 1, 1
    console.log(`GeoTIFF: Selected RGB bands 1, 1, 1 (of ${totalBands} total)`);
    return [1, 1, 1];
  }
}