import GeoTIFF from 'geotiff';
import { selectDefaultRGBBands } from './bandSelection.js';

export async function parseGeoTIFF(tiffFile) {
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
  
  // Select default RGB bands
  const defaultBands = selectDefaultRGBBands({
    bands,
    wavelengthValues
  });
  
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
    // GeoTIFF specific
    tiffImage: image, // Keep reference for data reading
    geoTransform: image.getGeoTransform(),
    projection: image.getGeoKeys()
  };
  
  console.log(`GeoTIFF: ${samples}×${lines} pixels, ${bands} bands`);
  console.log('Wavelength range:', wavelengthValues?.length > 0 
    ? `${wavelengthValues[0]} - ${wavelengthValues[wavelengthValues.length-1]}`
    : 'Not available');
  
  return metadata;
}

export async function parseGeoTIFFBands(tiffFile, metadata, bandNumbers) {
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  const { samples, lines } = metadata;
  const validBandNumbers = bandNumbers.map(band =>
    Math.max(1, Math.min(metadata.bands, Math.floor(band) || 1))
  );
  
  console.log(`Reading GeoTIFF bands: ${validBandNumbers.join(', ')}`);
  
  // Read specific bands (convert to 0-based indexing)
  const rasters = await image.readRasters({
    samples: validBandNumbers.map(b => b - 1),
    interleave: false // Get separate arrays for each band
  });
  
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