// Enhanced parseGeoTIFF.js with conservative wavelength detection
import { selectDefaultRGBBands } from './bandSelection.js';

export async function parseGeoTIFF(tiffFile) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  const samples = image.getWidth();
  const lines = image.getHeight();
  const bands = image.getSamplesPerPixel();
  
  const sampleFormat = image.getSampleFormat();
  const bitsPerSample = image.getBitsPerSample();
  const dataType = getENVIDataType(sampleFormat[0], bitsPerSample[0]);
  
  console.log(`=== WAVELENGTH DETECTION FOR ${tiffFile.name} ===`);
  console.log(`Bands: ${bands}, Format: ${sampleFormat}, Bits: ${bitsPerSample}`);
  
  // Conservative wavelength extraction - only real embedded data
  const wavelengthResult = await extractEmbeddedWavelengthData(image, tiff, bands, tiffFile.name);
  
  // Select default RGB bands based on detection results
  const defaultBands = wavelengthResult.hasRealWavelengths 
    ? selectBandsByWavelength(wavelengthResult.wavelengths)
    : selectGeoTIFFDefaultBands(bands);
  
  const metadata = {
    samples,
    lines,
    bands,
    dataType,
    interleave: 'bip',
    byteOrder: 0,
    isBigEndian: false,
    defaultBands,
    wavelengthValues: wavelengthResult.wavelengths,
    hasRealWavelengths: wavelengthResult.hasRealWavelengths,
    wavelengthSource: wavelengthResult.source,
    fileType: 'geotiff',
    tiffImage: image,
    geoTransform: await getGeoTransformSafely(image),
    projection: await getProjectionSafely(image)
  };
  
  return metadata;
}

// Conservative wavelength detection - only real embedded metadata
async function extractEmbeddedWavelengthData(image, tiff, bands, filename) {
  console.log(`\n--- Conservative wavelength detection for ${filename} ---`);
  
  // Method 1: GDAL metadata search for real wavelength fields
  const result1 = await searchGDALWavelengths(image);
  if (result1 && result1.wavelengths) {
    console.log(`✓ SUCCESS: Found wavelengths in GDAL metadata`);
    return result1;
  }
  
  // Method 2: TIFF tag search for embedded wavelength arrays
  const result2 = await searchTIFFTagWavelengths(image);
  if (result2 && result2.wavelengths) {
    console.log(`✓ SUCCESS: Found wavelengths in TIFF tags`);
    return result2;
  }
  
  // Method 3: Image description parsing
  const result3 = await parseImageDescriptionWavelengths(image);
  if (result3 && result3.wavelengths) {
    console.log(`✓ SUCCESS: Found wavelengths in image description`);
    return result3;
  }
  
  console.log(`⚠ No embedded wavelength metadata found`);
  return {
    wavelengths: null,
    hasRealWavelengths: false,
    source: 'none - no embedded wavelength data detected'
  };
}

// Method 1: Search GDAL metadata for known wavelength fields
async function searchGDALWavelengths(image) {
  console.log(`\n1. GDAL METADATA SEARCH:`);
  
  try {
    const gdalMeta = image.getGDALMetadata?.() || {};
    console.log(`GDAL metadata keys:`, Object.keys(gdalMeta));
    
    // Known wavelength field names from various sources
    const wavelengthFields = [
      'wavelength', 'wavelengths', 'WAVELENGTH', 'WAVELENGTHS',
      'band_wavelength', 'spectral_wavelength', 'center_wavelength',
      'central_wavelength', 'Band_Wavelength', 'BAND_WAVELENGTH',
      'wl', 'WL', 'lambda', 'LAMBDA'
    ];
    
    for (const field of wavelengthFields) {
      if (gdalMeta[field]) {
        console.log(`Found wavelength field ${field}:`, gdalMeta[field]);
        const wavelengths = parseWavelengthString(gdalMeta[field]);
        if (wavelengths.length > 0 && validateWavelengths(wavelengths)) {
          return { 
            wavelengths, 
            hasRealWavelengths: true,
            source: `GDAL metadata field: ${field}` 
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`GDAL metadata search failed:`, error.message);
    return null;
  }
}

// Method 2: Search TIFF tags for wavelength arrays
async function searchTIFFTagWavelengths(image) {
  console.log(`\n2. TIFF TAG WAVELENGTH SEARCH:`);
  
  try {
    const fileDirectory = image.getFileDirectory();
    console.log(`Searching ${Object.keys(fileDirectory).length} TIFF tags`);
    
    for (const [tagKey, tagValue] of Object.entries(fileDirectory)) {
      // Look for numeric arrays that could be wavelengths
      if (Array.isArray(tagValue)) {
        const isNumericArray = tagValue.every(v => typeof v === 'number');
        if (isNumericArray && tagValue.length >= 3 && tagValue.length <= 1000) {
          // Check if values are in realistic wavelength range
          const inWavelengthRange = tagValue.every(v => v >= 100 && v <= 50000);
          if (inWavelengthRange && validateWavelengths(tagValue)) {
            console.log(`*** FOUND wavelength array in tag ${tagKey}:`, tagValue.slice(0, 5), '...');
            return { 
              wavelengths: tagValue, 
              hasRealWavelengths: true,
              source: `TIFF tag ${tagKey}` 
            };
          }
        }
      }
      // Look for string representations of wavelength arrays
      else if (typeof tagValue === 'string' && tagValue.includes(',')) {
        const wavelengths = parseWavelengthString(tagValue);
        if (wavelengths.length >= 3 && validateWavelengths(wavelengths)) {
          console.log(`*** FOUND wavelength string in tag ${tagKey}`);
          return { 
            wavelengths, 
            hasRealWavelengths: true,
            source: `TIFF tag ${tagKey}` 
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`TIFF tag search failed:`, error.message);
    return null;
  }
}

// Method 3: Parse image description for wavelength data
async function parseImageDescriptionWavelengths(image) {
  console.log(`\n3. IMAGE DESCRIPTION SEARCH:`);
  
  try {
    const imageDesc = image.getImageDescription?.() || '';
    if (!imageDesc || imageDesc.length === 0) {
      console.log(`No image description found`);
      return null;
    }
    
    console.log(`Image description length: ${imageDesc.length} characters`);
    
    // Look for wavelength patterns in the description
    const wavelengthPatterns = [
      /wavelength[s]?\s*[:=]\s*\[([\d\s,.-]+)\]/gi,
      /wavelength[s]?\s*[:=]\s*\{([\d\s,.-]+)\}/gi,
      /wavelength[s]?\s*[:=]\s*([\d\s,.-]+)/gi,
      /bands?\s*[:=]\s*\[([\d\s,.-]+)\]/gi
    ];
    
    for (const pattern of wavelengthPatterns) {
      const matches = imageDesc.match(pattern);
      if (matches) {
        for (const match of matches) {
          console.log(`Found potential wavelength pattern: ${match}`);
          const wavelengths = parseWavelengthString(match);
          if (wavelengths.length >= 3 && validateWavelengths(wavelengths)) {
            return { 
              wavelengths, 
              hasRealWavelengths: true,
              source: 'Image description' 
            };
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`Image description search failed:`, error.message);
    return null;
  }
}

// Enhanced wavelength string parser
function parseWavelengthString(wavelengthStr) {
  if (typeof wavelengthStr !== 'string') return [];
  
  console.log(`Parsing wavelength string: "${wavelengthStr.substring(0, 100)}..."`);
  
  // Remove common delimiters and brackets
  let cleaned = wavelengthStr.replace(/[{}[\]()]/g, '').trim();
  
  // Try different separators
  const separators = [',', ' ', '\t', ';', '|', '\n', '\r'];
  
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep)
        .map(w => w.trim())
        .map(w => parseFloat(w))
        .filter(w => !isNaN(w) && w > 0 && w >= 100 && w <= 50000);
      
      if (parts.length >= 3) {
        console.log(`Successfully parsed ${parts.length} wavelengths with separator '${sep}'`);
        return parts;
      }
    }
  }
  
  // Try regex patterns for numbers
  const numberMatches = cleaned.match(/\d+\.?\d*/g);
  if (numberMatches && numberMatches.length >= 3) {
    const wavelengths = numberMatches
      .map(m => parseFloat(m))
      .filter(w => !isNaN(w) && w >= 100 && w <= 50000);
    
    if (wavelengths.length >= 3) {
      console.log(`Regex extraction found ${wavelengths.length} wavelengths`);
      return wavelengths;
    }
  }
  
  return [];
}

// Strict validation function for real wavelength data
function validateWavelengths(wavelengths) {
  if (!Array.isArray(wavelengths) || wavelengths.length === 0) return false;
  
  console.log(`Validating ${wavelengths.length} wavelengths`);
  
  // Check all values are numbers in reasonable range
  const allValid = wavelengths.every(w => 
    typeof w === 'number' && 
    !isNaN(w) && 
    w >= 100 && 
    w <= 50000
  );
  
  if (!allValid) {
    console.log(`Validation failed: invalid values`);
    return false;
  }
  
  // Check for reasonable spectral progression (mostly increasing)
  let increasingCount = 0;
  for (let i = 1; i < wavelengths.length; i++) {
    if (wavelengths[i] >= wavelengths[i-1]) increasingCount++;
  }
  
  const progressionRatio = increasingCount / (wavelengths.length - 1);
  console.log(`Progression ratio: ${progressionRatio.toFixed(2)} (need > 0.6)`);
  
  // Require reasonable spectral ordering
  if (progressionRatio < 0.6) {
    console.log(`Validation failed: poor spectral progression`);
    return false;
  }
  
  // Check for realistic spectral range spread
  const minWl = Math.min(...wavelengths);
  const maxWl = Math.max(...wavelengths);
  const range = maxWl - minWl;
  const expectedMinRange = wavelengths.length > 10 ? 50 : 20; // Broader range for more bands
  
  if (range < expectedMinRange) {
    console.log(`Validation failed: spectral range too narrow (${range})`);
    return false;
  }
  
  console.log(`✓ Wavelength validation passed`);
  return true;
}

// Smart band selection using real wavelengths
function selectBandsByWavelength(wavelengths) {
  console.log(`Selecting RGB bands from ${wavelengths.length} wavelengths`);
  
  const targets = wavelengths[0] > 10 
    ? { red: 650, green: 550, blue: 450 }    // nanometers
    : { red: 0.65, green: 0.55, blue: 0.45 }; // micrometers
  
  const redBand = findClosestBand(wavelengths, targets.red);
  const greenBand = findClosestBand(wavelengths, targets.green);
  const blueBand = findClosestBand(wavelengths, targets.blue);
  
  console.log(`Selected RGB: R=${redBand}(${wavelengths[redBand-1]?.toFixed(1)}), G=${greenBand}(${wavelengths[greenBand-1]?.toFixed(1)}), B=${blueBand}(${wavelengths[blueBand-1]?.toFixed(1)})`);
  
  return [redBand, greenBand, blueBand];
}

function findClosestBand(wavelengths, target) {
  let closestIndex = 0;
  let minDifference = Math.abs(wavelengths[0] - target);
  
  for (let i = 1; i < wavelengths.length; i++) {
    const difference = Math.abs(wavelengths[i] - target);
    if (difference < minDifference) {
      minDifference = difference;
      closestIndex = i;
    }
  }
  
  return closestIndex + 1;
}

// Helper functions
function getENVIDataType(sampleFormat, bitsPerSample) {
  if (sampleFormat === 1) {
    return bitsPerSample === 16 ? 12 : 1;
  } else if (sampleFormat === 2) {
    return bitsPerSample === 16 ? 2 : 1;
  } else if (sampleFormat === 3) {
    return bitsPerSample === 32 ? 4 : 5;
  }
  return 12;
}

async function getGeoTransformSafely(image) {
  try {
    return image.getGeoTransform?.() || image.getModelTransformation?.() || null;
  } catch (error) {
    return null;
  }
}

async function getProjectionSafely(image) {
  try {
    return image.getGeoKeys?.() || image.getProjection?.() || null;
  } catch (error) {
    return null;
  }
}

function selectGeoTIFFDefaultBands(totalBands) {
  if (totalBands >= 3) {
    return [1, 2, 3];
  } else if (totalBands === 2) {
    return [1, 2, 1];
  } else {
    return [1, 1, 1];
  }
}

// Export functions remain the same
export async function parseGeoTIFFBands(tiffFile, metadata, bandNumbers) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage(0);
  
  const { samples, lines } = metadata;
  const validBandNumbers = bandNumbers.map(band =>
    Math.max(1, Math.min(metadata.bands, Math.floor(band) || 1))
  );
  
  const rasters = await image.readRasters({
    samples: validBandNumbers.map(b => b - 1),
    interleave: false,
    width: image.getWidth(),
    height: image.getHeight()
  });
  
  const bandData = new Array(validBandNumbers.length);
  
  for (let bandIdx = 0; bandIdx < validBandNumbers.length; bandIdx++) {
    bandData[bandIdx] = new Array(lines);
    const bandRaster = rasters[bandIdx];
    
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
  
  const { samples, lines, bands, wavelengthValues, hasRealWavelengths } = metadata;
  
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }
  
  const pixelData = await image.readRasters({
    window: [x, y, x + 1, y + 1],
    width: 1,
    height: 1
  });
  
  const spectrum = [];
  for (let band = 0; band < bands; band++) {
    const value = pixelData[band][0];
    
    const wavelength = hasRealWavelengths && wavelengthValues 
      ? wavelengthValues[band] 
      : band + 1;
    
    spectrum.push({
      band: band + 1,
      wavelength,
      value: value > 55535 ? 0 : value
    });
  }
  
  return spectrum;
}